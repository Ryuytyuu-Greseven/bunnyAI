import { Component, ElementRef, ViewChild, HostListener, AfterViewInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { NgClass } from '@angular/common';
import { FormGroup, FormControl, ReactiveFormsModule } from '@angular/forms';

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
    systemInstruction: new FormControl("You are Aether, a brilliant, friendly, and helpful real-time AI assistant. Respond conversationally, keep your responses concise, and adapt dynamically to the user's tone."),
  });

  constructor(private cdr: ChangeDetectorRef) {}

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

  // Visualizer Canvases, Logs container & Chat container
  @ViewChild('micCanvas') micCanvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('speakerCanvas') speakerCanvasRef!: ElementRef<HTMLCanvasElement>;
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

  // WebSocket Connection
  private socket: WebSocket | null = null;

  // Canvas Animation Frame IDs
  private micAnimationId: number | null = null;
  private speakerAnimationId: number | null = null;

  ngAfterViewInit() {
    this.log('Dashboard initialized. Awaiting connection...', 'info');
    this.resizeCanvases();
  }

  ngOnDestroy() {
    this.cleanup();
  }

  @HostListener('window:resize')
  onResize() {
    this.resizeCanvases();
  }

  private resizeCanvases() {
    if (this.micCanvasRef?.nativeElement) {
      const canvas = this.micCanvasRef.nativeElement;
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (rect) {
        canvas.width = rect.width;
        canvas.height = rect.height;
      }
    }
    if (this.speakerCanvasRef?.nativeElement) {
      const canvas = this.speakerCanvasRef.nativeElement;
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
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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

    try {
      this.log('Connecting to Aether WebSocket gateway...', 'info');
      this.updateStatus('connecting', 'Connecting...');
      this.isConnecting = true;
      this.configForm.disable();

      // Determine backend WS path (support dev port 4200 -> 3000)
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.port === '4200' ? 'localhost:3000' : window.location.host;
      const wsUrl = `${protocol}//${host}/ws`;

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
                  this.playAudioChunk(part.inlineData.data);
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
        autoGainControl: true,
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

    // Render waveform animation loop
    this.startDrawing(this.micAnalyser, this.micCanvasRef.nativeElement, '#8b5cf6', () => this.isMicIdle);
  }

  // Initialize Speaker Output (24kHz playback context)
  private async initAudioOutput() {
    this.outputAudioContext = new AudioContext();

    this.playbackAnalyser = this.outputAudioContext.createAnalyser();
    this.playbackAnalyser.fftSize = 256;
    this.playbackAnalyser.connect(this.outputAudioContext.destination);

    this.nextPlayTime = this.outputAudioContext.currentTime;

    this.log('Speaker output initialized.', 'info');

    // Render waveform animation loop
    this.startDrawing(this.playbackAnalyser, this.speakerCanvasRef.nativeElement, '#06b6d4', () => this.isSpeakerIdle);
  }

  // play audio payload (supports MP3/WAV/PCM)
  private playAudioChunk(base64Data: string) {
    if (!this.outputAudioContext) {
      return;
    }

    if (this.outputAudioContext.state === 'suspended') {
      this.outputAudioContext.resume();
    }

    const arrayBuffer = this.base64ToArrayBuffer(base64Data);
    // Keep a backup of the arrayBuffer bytes in case decodeAudioData fails and detaches the original buffer
    const fallbackBuffer = arrayBuffer.slice(0);

    this.outputAudioContext.decodeAudioData(arrayBuffer)
      .then((buffer) => {
        if (!this.outputAudioContext) return;
        const source = this.outputAudioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(this.playbackAnalyser!);

        const startTime = Math.max(this.outputAudioContext.currentTime, this.nextPlayTime);
        source.start(startTime);
        this.nextPlayTime = startTime + buffer.duration;

        this.activeSources.add(source);
        source.onended = () => {
          this.activeSources.delete(source);
          if (this.activeSources.size === 0) {
            this.isSpeakerIdle = true;
          }
        };

        this.isSpeakerIdle = false;
      })
      .catch((err) => {
        console.warn('Failed to decode using decodeAudioData, attempting fallback as raw PCM...', err);
        // Fallback to raw PCM 24kHz just in case
        try {
          if (!this.outputAudioContext) return;
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

          const startTime = Math.max(this.outputAudioContext.currentTime, this.nextPlayTime);
          source.start(startTime);
          this.nextPlayTime = startTime + buffer.duration;

          this.activeSources.add(source);
          source.onended = () => {
            this.activeSources.delete(source);
            if (this.activeSources.size === 0) {
              this.isSpeakerIdle = true;
            }
          };

          this.isSpeakerIdle = false;
        } catch (fallbackErr) {
          console.error('Audio playback fallback failed:', fallbackErr);
        }
      });
  }

  private stopPlaybackQueue() {
    this.activeSources.forEach((source) => {
      try {
        source.stop();
      } catch (e) { }
    });
    this.activeSources.clear();
    if (this.outputAudioContext) {
      this.nextPlayTime = this.outputAudioContext.currentTime;
    }
    this.isSpeakerIdle = true;
  }

  private cleanup() {
    this.updateStatus('offline', 'Disconnected');
    this.isConnected = false;
    this.isConnecting = false;
    this.configForm.enable();

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
    if (this.micAnimationId !== null) {
      cancelAnimationFrame(this.micAnimationId);
      this.micAnimationId = null;
    }
    if (this.speakerAnimationId !== null) {
      cancelAnimationFrame(this.speakerAnimationId);
      this.speakerAnimationId = null;
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
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
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

  // Draw loop scheduler
  private startDrawing(analyser: AnalyserNode | null, canvas: HTMLCanvasElement, color: string, isIdleFn: () => boolean) {
    const ctx = canvas.getContext('2d')!;
    const bufferLength = analyser ? analyser.frequencyBinCount : 0;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      const frameId = requestAnimationFrame(draw);
      if (color === '#8b5cf6') {
        this.micAnimationId = frameId;
      } else {
        this.speakerAnimationId = frameId;
      }

      const width = canvas.width;
      const height = canvas.height;

      // Deep dark visualizer background
      ctx.fillStyle = 'rgba(10, 10, 20, 0.4)';
      ctx.fillRect(0, 0, width, height);

      if (!analyser || isIdleFn()) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();
        return;
      }

      analyser.getByteTimeDomainData(dataArray);

      ctx.lineWidth = 3;
      ctx.strokeStyle = color;
      ctx.shadowBlur = 10;
      ctx.shadowColor = color;
      ctx.beginPath();

      const sliceWidth = width / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * height) / 2;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }

        x += sliceWidth;
      }

      ctx.lineTo(width, height / 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    };

    draw();
  }
}
