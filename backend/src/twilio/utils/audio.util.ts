/**
 * G.711 u-law encoding of a single 16-bit signed PCM sample → 8-bit mulaw byte.
 */
function encodeLinear16ToMulaw(sample: number): number {
  const BIAS = 0x84; // 132

  if (sample > 32767) sample = 32767;
  else if (sample < -32767) sample = -32767;

  const sign = (sample >> 8) & 0x80;
  if (sign) sample = -sample;

  sample += BIAS;

  let exp = 7;
  let mask = 0x4000;
  while (exp > 0 && !(sample & mask)) {
    exp--;
    mask >>= 1;
  }

  const mantissa = (sample >> (exp + 3)) & 0x0f;
  return (~(sign | (exp << 4) | mantissa)) & 0xff;
}

/**
 * Downsample a linear16 buffer by averaging every `factor` consecutive samples.
 * Simple averaging preserves loudness and avoids aliasing for speech.
 */
function downsampleLinear16(input: Buffer, factor: number): Buffer {
  const inputSamples = Math.floor(input.length / 2);
  const outputSamples = Math.floor(inputSamples / factor);
  const output = Buffer.alloc(outputSamples * 2);

  for (let i = 0; i < outputSamples; i++) {
    let sum = 0;
    const end = Math.min((i + 1) * factor, inputSamples);
    for (let j = i * factor; j < end; j++) {
      sum += input.readInt16LE(j * 2);
    }
    output.writeInt16LE(Math.round(sum / factor), i * 2);
  }

  return output;
}

/**
 * Converts TTS output (linear16 PCM at 24 kHz) to Twilio's expected format
 * (G.711 u-law PCM at 8 kHz, 1 byte per sample).
 *
 * Twilio Media Streams payload must be base64-encoded mulaw 8 kHz mono.
 */
export function convertTtsForTwilio(linear16_24k: Buffer): Buffer {
  // 1. Downsample 24 kHz → 8 kHz (factor 3)
  const linear16_8k = downsampleLinear16(linear16_24k, 3);

  // 2. Encode each 16-bit sample to a single mulaw byte
  const mulaw = Buffer.alloc(linear16_8k.length / 2);
  for (let i = 0; i < mulaw.length; i++) {
    mulaw[i] = encodeLinear16ToMulaw(linear16_8k.readInt16LE(i * 2));
  }

  return mulaw;
}
