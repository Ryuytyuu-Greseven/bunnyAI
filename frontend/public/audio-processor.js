// Aether Audio Processor Worklet
// Converts Float32 microphone data to Int16 PCM chunks for Gemini streaming

class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0]; // input channels
    
    // Check if we have active input and at least one channel
    if (input && input[0] && input[0].length > 0) {
      const channelData = input[0]; // Float32Array of samples (typically 128 samples)
      const bufferLength = channelData.length;
      
      // Create Int16Array to store 16-bit linear PCM
      const pcmData = new Int16Array(bufferLength);
      
      for (let i = 0; i < bufferLength; i++) {
        // Clamp float sample to [-1.0, 1.0] range
        const sample = Math.max(-1.0, Math.min(1.0, channelData[i]));
        
        // Convert to 16-bit signed integer [-32768, 32767]
        pcmData[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      }
      
      // Post the raw buffer to the main thread, transferring ownership for zero-copy performance
      this.port.postMessage(pcmData.buffer, [pcmData.buffer]);
    }
    
    return true; // Keep the worklet alive
  }
}

registerProcessor('audio-processor', AudioProcessor);
