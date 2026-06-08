import { Component, ElementRef, ViewChild, HostListener, AfterViewInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { NgClass } from '@angular/common';
import { FormGroup, FormControl, ReactiveFormsModule } from '@angular/forms';
import { MicVAD } from '@ricky0123/vad-web';
import { environment } from '../environments/environment';

interface ConsoleLog {
  id: number;
  time: string;
  message: string;
  typeClass: string;
}

interface ChatMessage {
  id: number;
  sender: 'user' | 'assistant';
  text: string;
  time: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [NgClass, ReactiveFormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements AfterViewInit, OnDestroy {
  // Config Form (Reactive Form)
  configForm = new FormGroup({
    model: new FormControl('models/gemini-2.0-flash-exp'),
    voice: new FormControl('Aoede'),
    systemInstruction: new FormControl("You are Lyre AI, a brilliant, friendly, and helpful real-time AI assistant. Respond conversationally, keep your responses concise, and adapt dynamically to the user's tone."),
    business: new FormControl('Customer Success'),
  });

  constructor(private cdr: ChangeDetectorRef) { }

  // UI states
  isConnected = false;
  isConnecting = false;
  isMuted = false;
  isMicIdle = true;
  isSpeakerIdle = true;
  statusText = 'Disconnected';
  statusClass = 'status-offline';
  logs: ConsoleLog[] = [];
  chatMessages: ChatMessage[] = [];

  private logId = 0;
  private chatMessageId = 0;

  // Visualizer Canvas, Logs container & Chat container
  @ViewChild('birdEyeCanvas') birdEyeCanvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('consoleLogs') consoleLogsRef!: ElementRef<HTMLDivElement>;
  @ViewChild('chatHistoryBody') chatHistoryBodyRef!: ElementRef<HTMLDivElement>;

  // Web Audio Contexts & Streams
  private inputAudioContext: AudioContext | null = null;
  private outputAudioContext: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private playbackAnalyser: AnalyserNode | null = null;
  private activeSources = new Set<AudioBufferSourceNode>();
  private nextPlayTime = 0;
  private myvad: MicVAD | null = null;
  private audioPlaybackQueue: string[] = [];
  private isPlayingAudio = false;

  // WebSocket Connection
  private socket: WebSocket | null = null;

  // Canvas Animation Frame ID
  private birdEyeAnimationId: number | null = null;

  ngAfterViewInit() {
    this.log('Dashboard initialized. Awaiting connection...', 'info');
    this.resizeCanvases();
    this.startBirdEyeDrawing();
  }

  ngOnDestroy() {
    this.cleanup();
  }

  @HostListener('window:resize')
  onResize() {
    this.resizeCanvases();
  }

  private resizeCanvases() {
    if (this.birdEyeCanvasRef?.nativeElement) {
      const canvas = this.birdEyeCanvasRef.nativeElement;
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (rect) {
        canvas.width = rect.width;
        canvas.height = rect.height;
      }
    }
  }

  // System Logging helper
  private log(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const typeClass = `log-${type}`;
    this.logs.push({
      id: ++this.logId,
      time: timestamp,
      message,
      typeClass,
    });

    // Auto-scroll console body to the bottom
    setTimeout(() => {
      if (this.consoleLogsRef?.nativeElement) {
        const container = this.consoleLogsRef.nativeElement;
        container.scrollTop = container.scrollHeight;
      }
    }, 50);
  }

  clearLogs() {
    this.logs = [];
    this.chatMessages = [];
    this.log('Logs and chat history cleared.', 'info');
  }

  addChatMessage(sender: 'user' | 'assistant', text: string) {
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    this.chatMessages.push({
      id: ++this.chatMessageId,
      sender,
      text,
      time: timestamp,
    });

    // Auto-scroll chat body to the bottom
    setTimeout(() => {
      if (this.chatHistoryBodyRef?.nativeElement) {
        const container = this.chatHistoryBodyRef.nativeElement;
        container.scrollTop = container.scrollHeight;
      }
    }, 50);
  }

  // Establish real-time session
  async connect() {
    const model = this.configForm.value.model || 'models/gemini-2.0-flash-exp';
    const voice = this.configForm.value.voice || 'Aoede';
    const instruction = this.configForm.value.systemInstruction || '';
    const business = this.configForm.value.business || 'Customer Success';

    try {
      this.log('Connecting to Lyre AI WebSocket gateway...', 'info');
      this.updateStatus('connecting', 'Connecting...');
      this.isConnecting = true;
      this.configForm.disable();

      // Connect using the URL defined in the active environment file
      const wsUrl = environment.wsUrl;

      this.socket = new WebSocket(wsUrl);

      this.socket.onopen = async () => {
        this.log('WebSocket channel open. Starting setup...', 'success');
        this.updateStatus('online', 'Connected');
        this.isConnected = true;
        this.isConnecting = false;
        this.cdr.detectChanges();

        // 1. Send configuration message to set model/voice
        const setupMsg = {
          setup: {
            model: model,
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: voice,
                  },
                },
              },
            },
            systemInstruction: {
              parts: [
                {
                  text: instruction,
                },
              ],
            },
            business: business,
          },
        };

        this.socket?.send(JSON.stringify(setupMsg));
        console.log('Setup message sent', setupMsg);
        this.log(`Sent setup configuration (Model: ${model}, Voice: ${voice})`, 'info');

        // 2. Setup audio nodes
        await this.initAudioInput();
        await this.initAudioOutput();

        this.log('Real-time voice stream initialized. You can start speaking now!', 'success');
        this.cdr.detectChanges();
      };

      this.socket.onmessage = async (event) => {
        try {
          const message = JSON.parse(event.data);

          if (message.error) {
            this.log(`Server Error: ${message.error}`, 'error');
            this.cdr.detectChanges();
            return;
          }

          // Handle User's transcribed query from the backend
          if (message.userContent && message.userContent.text) {
            this.addChatMessage('user', message.userContent.text);
            this.cdr.detectChanges();
          }

          if (message.serverContent) {
            const content = message.serverContent;

            // Handle Barge-in (Interruption)
            if (content.interrupted) {
              this.log('User interrupted assistant. Silencing audio queue immediately.', 'warning');
              this.stopPlaybackQueue();
              this.cdr.detectChanges();
              return;
            }

            // Handle Audio output data
            if (content.modelTurn && content.modelTurn.parts) {
              for (const part of content.modelTurn.parts) {
                if (part.inlineData && part.inlineData.data) {
                  this.audioPlaybackQueue.push(part.inlineData.data);
                  this.processPlaybackQueue();
                }
                if (part.text) {
                  this.log(`Assistant text transcript: "${part.text}"`, 'info');
                  this.addChatMessage('assistant', part.text);
                }
              }
              this.cdr.detectChanges();
            }
          }
        } catch (err) {
          console.error('Failed to parse websocket message:', err);
        }
      };

      this.socket.onclose = () => {
        this.log('WebSocket connection closed.', 'warning');
        this.cleanup();
        this.cdr.detectChanges();
      };

      this.socket.onerror = (err) => {
        this.log('WebSocket error occurred.', 'error');
        console.error(err);
        this.cdr.detectChanges();
      };

    } catch (err: any) {
      this.log(`Connection failed: ${err.message}`, 'error');
      this.cleanup();
      this.cdr.detectChanges();
    }
  }

  disconnect() {
    this.log('Disconnecting from assistant...', 'info');
    if (this.socket) {
      this.socket.close();
    }
  }

  toggleMute() {
    this.isMuted = !this.isMuted;

    // Disable/enable actual audio tracks at the stream source so the visualizer flatlines
    if (this.micStream) {
      this.micStream.getAudioTracks().forEach((track) => {
        track.enabled = !this.isMuted;
      });
    }

    if (this.isMuted) {
      this.log('Microphone muted.', 'warning');
      this.isMicIdle = true;
    } else {
      this.log('Microphone active.', 'success');
    }
  }

  private updateStatus(state: 'offline' | 'connecting' | 'online', text: string) {
    this.statusText = text;
    this.statusClass = `status-${state}`;
  }

  // Initialize Mic Input (16kHz PCM recording)
  private async initAudioInput() {
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
      },
    });

    this.inputAudioContext = new AudioContext({ sampleRate: 16000 });

    // Register the AudioWorklet from public folder asset
    await this.inputAudioContext.audioWorklet.addModule('audio-processor.js');

    const source = this.inputAudioContext.createMediaStreamSource(this.micStream);
    this.workletNode = new AudioWorkletNode(this.inputAudioContext, 'audio-processor');

    this.micAnalyser = this.inputAudioContext.createAnalyser();
    this.micAnalyser.fftSize = 256;
    source.connect(this.micAnalyser);

    this.workletNode.port.onmessage = (event) => {
      if (this.isMuted || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
        return;
      }

      const arrayBuffer = event.data; // Int16Array PCM buffer
      const base64Audio = this.arrayBufferToBase64(arrayBuffer);

      // Send to NestJS gateway proxy
      const audioChunkMessage = {
        realtimeInput: {
          audio: {
            mimeType: 'audio/pcm;rate=16000',
            data: base64Audio,
          },
        },
      };
      this.socket.send(JSON.stringify(audioChunkMessage));
      if (this.hasAudioSignal(this.micAnalyser)) {
        this.isMicIdle = false;
      } else {
        this.isMicIdle = true;
      }
    };

    source.connect(this.workletNode);

    // Mute node output loopback
    const silenceNode = this.inputAudioContext.createGain();
    silenceNode.gain.setValueAtTime(0, this.inputAudioContext.currentTime);
    this.workletNode.connect(silenceNode);
    silenceNode.connect(this.inputAudioContext.destination);

    this.log('Microphone input initialized (16kHz mono).', 'info');

    // Drawing is handled by startBirdEyeDrawing animation loop
  }

  // Initialize Speaker Output (24kHz playback context)
  private async initAudioOutput() {
    this.outputAudioContext = new AudioContext();

    this.playbackAnalyser = this.outputAudioContext.createAnalyser();
    this.playbackAnalyser.fftSize = 256;
    this.playbackAnalyser.connect(this.outputAudioContext.destination);

    this.nextPlayTime = this.outputAudioContext.currentTime;

    this.log('Speaker output initialized.', 'info');

    // Drawing is handled by startBirdEyeDrawing animation loop
  }

  private async processPlaybackQueue() {
    if (this.isPlayingAudio || this.audioPlaybackQueue.length === 0) {
      return;
    }

    this.isPlayingAudio = true;
    const base64Data = this.audioPlaybackQueue.shift()!;

    try {
      await this.playAudioChunkPromise(base64Data);
    } catch (err) {
      console.error('Error playing chunk:', err);
    } finally {
      this.isPlayingAudio = false;
      this.processPlaybackQueue();
    }
  }

  private playAudioChunkPromise(base64Data: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.outputAudioContext) {
        reject(new Error('No output audio context'));
        return;
      }

      if (this.outputAudioContext.state === 'suspended') {
        this.outputAudioContext.resume();
      }

      const arrayBuffer = this.base64ToArrayBuffer(base64Data);
      const fallbackBuffer = arrayBuffer.slice(0);

      this.outputAudioContext.decodeAudioData(arrayBuffer)
        .then((buffer) => {
          if (!this.outputAudioContext) {
            reject(new Error('Audio context closed during decode'));
            return;
          }
          const source = this.outputAudioContext.createBufferSource();
          source.buffer = buffer;
          source.connect(this.playbackAnalyser!);

          source.start(0);
          this.activeSources.add(source);
          this.isSpeakerIdle = false;
          this.cdr.detectChanges();

          source.onended = () => {
            this.activeSources.delete(source);
            if (this.activeSources.size === 0) {
              this.isSpeakerIdle = true;
              this.cdr.detectChanges();
            }
            resolve();
          };
        })
        .catch((err) => {
          console.warn('Failed to decode using decodeAudioData, attempting fallback as raw PCM...', err);
          try {
            if (!this.outputAudioContext) {
              reject(new Error('Audio context closed'));
              return;
            }
            const int16Array = new Int16Array(fallbackBuffer);
            const float32Array = new Float32Array(int16Array.length);

            for (let i = 0; i < int16Array.length; i++) {
              float32Array[i] = int16Array[i] / 32768.0;
            }

            const buffer = this.outputAudioContext.createBuffer(1, float32Array.length, 24000);
            buffer.copyToChannel(float32Array, 0);

            const source = this.outputAudioContext.createBufferSource();
            source.buffer = buffer;
            source.connect(this.playbackAnalyser!);

            source.start(0);
            this.activeSources.add(source);
            this.isSpeakerIdle = false;
            this.cdr.detectChanges();

            source.onended = () => {
              this.activeSources.delete(source);
              if (this.activeSources.size === 0) {
                this.isSpeakerIdle = true;
                this.cdr.detectChanges();
              }
              resolve();
            };
          } catch (fallbackErr) {
            reject(fallbackErr);
          }
        });
    });
  }

  private stopPlaybackQueue() {
    this.audioPlaybackQueue = [];
    this.isPlayingAudio = false;
    this.activeSources.forEach((source) => {
      try {
        source.stop();
      } catch (e) { }
    });
    this.activeSources.clear();
    this.isSpeakerIdle = true;
  }

  private cleanup() {
    this.updateStatus('offline', 'Disconnected');
    this.isConnected = false;
    this.isConnecting = false;
    this.configForm.enable();

    // Stop VAD
    if (this.myvad) {
      try {
        this.myvad.destroy();
      } catch (e) { }
      this.myvad = null;
    }

    // Stop streams
    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => track.stop());
      this.micStream = null;
    }

    // Close contexts
    if (this.inputAudioContext) {
      this.inputAudioContext.close();
      this.inputAudioContext = null;
    }
    if (this.outputAudioContext) {
      this.outputAudioContext.close();
      this.outputAudioContext = null;
    }

    this.stopPlaybackQueue();

    // Cancel animations
    if (this.birdEyeAnimationId !== null) {
      cancelAnimationFrame(this.birdEyeAnimationId);
      this.birdEyeAnimationId = null;
    }

    this.workletNode = null;
    this.micAnalyser = null;
    this.playbackAnalyser = null;
    this.socket = null;
    this.isMuted = false;
    this.isMicIdle = true;
    this.isSpeakerIdle = true;
    this.chatMessages = [];
    this.cdr.detectChanges();
  }

  // Base64 helpers
  private arrayBufferToBase64(buffer: ArrayBuffer | SharedArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  private hasAudioSignal(analyser: AnalyserNode | null): boolean {
    if (!analyser) return false;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(dataArray);

    let maxVal = 128;
    for (let i = 0; i < dataArray.length; i++) {
      if (dataArray[i] > maxVal) maxVal = dataArray[i];
    }
    return (maxVal - 128) > 4; // Threshold to define activity
  }

  // Combined dynamic dual bird-eye style circular visualizer
  private startBirdEyeDrawing() {
    if (!this.birdEyeCanvasRef?.nativeElement) return;
    const canvas = this.birdEyeCanvasRef.nativeElement;
    const ctx = canvas.getContext('2d')!;

    let angleOffset = 0;

    const draw = () => {
      this.birdEyeAnimationId = requestAnimationFrame(draw);

      const width = canvas.width;
      const height = canvas.height;
      const centerX = width / 2;
      const centerY = height / 2;

      // Clean screen with deep Termux black
      ctx.fillStyle = '#050505';
      ctx.fillRect(0, 0, width, height);

      // Faint terminal grid pattern (vibe element)
      ctx.strokeStyle = 'rgba(255, 204, 0, 0.03)';
      ctx.lineWidth = 1;
      const gridSize = 25;
      for (let x = 0; x < width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Base radius calculation for dual eyes (widened more)
      const baseRadius = Math.min(width, height) * 0.18;
      const eyeOuterRadius = baseRadius * 1.37; // Maximum radius of ticks boundary
      const eyeSpacing = eyeOuterRadius + 25;    // Symmetrical spacing ensuring exactly 50px gap between outer rings
      const eyeOffsetY = 0;                      // Centered vertically since mouth is removed

      // Extract Mic Audio Data if active
      let micActive = false;
      const micBufferLength = this.micAnalyser ? this.micAnalyser.frequencyBinCount : 128;
      const micDataArray = new Uint8Array(micBufferLength);
      if (this.micAnalyser && !this.isMicIdle && !this.isMuted) {
        this.micAnalyser.getByteTimeDomainData(micDataArray);
        micActive = true;
      }

      // Extract Speaker Audio Data if active
      let speakerActive = false;
      const speakerBufferLength = this.playbackAnalyser ? this.playbackAnalyser.frequencyBinCount : 128;
      const speakerDataArray = new Uint8Array(speakerBufferLength);
      if (this.playbackAnalyser && !this.isSpeakerIdle) {
        this.playbackAnalyser.getByteTimeDomainData(speakerDataArray);
        speakerActive = true;
      }

      // 1. Calculate Speech Eyelid ScaleY (Blinking - Widen more)
      let scaleY = 1.0;
      if (micActive) {
        // Talking/speaking flutter: stays wider (minimum 0.55 instead of 0.25)
        scaleY = 0.55 + Math.abs(Math.sin(Date.now() * 0.025)) * 0.45;
      } else {
        // Natural blinks (once every 4 seconds, lasting 150ms)
        const cycleTime = Date.now() % 4000;
        if (cycleTime > 3850) {
          const progress = (cycleTime - 3850) / 150; // 0 to 1
          scaleY = Math.abs(Math.sin(progress * Math.PI)); // dip to 0 and back
        }
      }

      // 2. Calculate Pupil orbital Offset (Revolving when assistant is speaking)
      let pupilOffsetX = 0;
      let pupilOffsetY = 0;
      if (speakerActive) {
        const orbitAngle = Date.now() * 0.015;
        const orbitRadius = baseRadius * 0.15;
        pupilOffsetX = Math.cos(orbitAngle) * orbitRadius;
        pupilOffsetY = Math.sin(orbitAngle) * orbitRadius;
      }

      // Rotate speed increases when Lyre AI is speaking (revolving outer rings)
      const rotationSpeed = speakerActive ? 0.045 : 0.003;
      angleOffset += rotationSpeed;

      // 3. Helper to draw a single eye
      const drawSingleEye = (eyeX: number, eyeY: number) => {
        ctx.save();
        ctx.translate(eyeX, eyeY);

        // Apply scaleY (eyelids/blinking)
        ctx.scale(1, scaleY);

        // Eyeball outer ring
        ctx.strokeStyle = speakerActive ? 'rgba(255, 204, 0, 0.4)' : 'rgba(255, 204, 0, 0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, 0, baseRadius * 1.15, 0, Math.PI * 2);
        ctx.stroke();

        // Crosshairs scope
        ctx.strokeStyle = 'rgba(255, 204, 0, 0.04)';
        ctx.beginPath();
        ctx.moveTo(-baseRadius * 1.3, 0);
        ctx.lineTo(baseRadius * 1.3, 0);
        ctx.moveTo(0, -baseRadius * 1.3);
        ctx.lineTo(0, baseRadius * 1.3);
        ctx.stroke();

        // Draw Iris (Mic soundwave ripples around the circle)
        let rmsMic = 0;
        if (micActive) {
          let sum = 0;
          for (let i = 0; i < micBufferLength; i++) {
            const val = (micDataArray[i] - 128) / 128.0;
            sum += val * val;
          }
          rmsMic = Math.sqrt(sum / micBufferLength);
        }

        const irisRadius = baseRadius + (micActive ? rmsMic * 90 : 0);

        ctx.beginPath();
        const numPoints = 90;
        for (let i = 0; i < numPoints; i++) {
          const angle = (i / numPoints) * Math.PI * 2 + angleOffset;
          let offset = 0;
          if (micActive) {
            const dataIdx = Math.floor((i / numPoints) * micBufferLength);
            offset = ((micDataArray[dataIdx] - 128) / 128.0) * 40;
          } else {
            offset = Math.sin(i * 0.15 + Date.now() * 0.003) * 2;
          }

          const r = irisRadius + offset;
          const x = Math.cos(angle) * r;
          const y = Math.sin(angle) * r;

          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = micActive ? '#ffcc00' : 'rgba(255, 204, 0, 0.35)';
        ctx.lineWidth = micActive ? 3.5 : 1.5;
        if (micActive) {
          ctx.shadowColor = '#ffcc00';
          ctx.shadowBlur = 15;
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Draw Pupil (Speaker audio pulses in the center, revolves inside sockets)
        let rmsSpeaker = 0;
        if (speakerActive) {
          let sum = 0;
          for (let i = 0; i < speakerBufferLength; i++) {
            const val = (speakerDataArray[i] - 128) / 128.0;
            sum += val * val;
          }
          rmsSpeaker = Math.sqrt(sum / speakerBufferLength);
        }

        const pupilBaseRadius = baseRadius * 0.45;
        const pupilPulse = speakerActive ? rmsSpeaker * 95 : 0;
        const idlePulse = !speakerActive ? Math.sin(Date.now() / 450) * 2 : 0;
        const pupilRadius = Math.max(10, pupilBaseRadius + pupilPulse + idlePulse);

        // Translate to pupil orbital offset
        ctx.save();
        ctx.translate(pupilOffsetX, pupilOffsetY);

        ctx.beginPath();
        ctx.arc(0, 0, pupilRadius, 0, Math.PI * 2);
        ctx.fillStyle = '#060606';
        ctx.fill();

        ctx.strokeStyle = speakerActive ? '#ffff00' : 'rgba(255, 204, 0, 0.5)';
        ctx.lineWidth = speakerActive ? 4.5 : 2;
        ctx.shadowColor = '#ffcc00';
        ctx.shadowBlur = speakerActive ? 25 : 6;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Core center dot
        ctx.beginPath();
        ctx.arc(0, 0, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#ffcc00';
        ctx.fill();

        ctx.restore(); // Restore to eyeball center

        // Rotating cyber-scope ticks
        ctx.strokeStyle = speakerActive ? 'rgba(255, 255, 0, 0.3)' : 'rgba(255, 204, 0, 0.15)';
        ctx.lineWidth = 2;
        const tickCount = 8;
        const tickSpeedFactor = speakerActive ? 2.5 : 1.0;
        for (let i = 0; i < tickCount; i++) {
          const tickAngle = (i / tickCount) * Math.PI * 2 - angleOffset * tickSpeedFactor;
          const xStart = Math.cos(tickAngle) * (baseRadius * 1.25);
          const yStart = Math.sin(tickAngle) * (baseRadius * 1.25);
          const xEnd = Math.cos(tickAngle) * (baseRadius * 1.35);
          const yEnd = Math.sin(tickAngle) * (baseRadius * 1.35);
          ctx.beginPath();
          ctx.moveTo(xStart, yStart);
          ctx.lineTo(xEnd, yEnd);
          ctx.stroke();
        }

        ctx.restore(); // Restore to canvas origin
      };

      // 4. Draw Left Eye and Right Eye (Centered vertically)
      drawSingleEye(centerX - eyeSpacing, centerY - eyeOffsetY);
      drawSingleEye(centerX + eyeSpacing, centerY - eyeOffsetY);
    };

    draw();
  }

  private float32ToInt16(float32Array: Float32Array): Int16Array {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16Array;
  }
}
