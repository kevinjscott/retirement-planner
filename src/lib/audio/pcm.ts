/**
 * Linear resample for microphone capture when `AudioContext` ignores the
 * requested rate (common: hardware 48000 Hz while we label outgoing PCM as 16 kHz).
 *
 * For one-shot buffers. Streaming capture should use {@link createStreamingResampler}
 * so phase carries across worklet chunks.
 */
export function resampleFloat32Linear(
  input: Float32Array,
  inputSampleRate: number,
  outputSampleRate: number,
): Float32Array {
  if (input.length === 0) {
    return new Float32Array(0);
  }
  if (inputSampleRate === outputSampleRate) {
    return input;
  }

  return createStreamingResampler(inputSampleRate, outputSampleRate)(input);
}

/**
 * Keeps resampler phase and a small input tail across worklet buffers so emitted
 * 16 kHz PCM tracks elapsed capture time (no per-chunk floor drift).
 */
export function createStreamingResampler(inputSampleRate: number, outputSampleRate: number) {
  if (inputSampleRate === outputSampleRate) {
    return (chunk: Float32Array) => chunk;
  }

  const ratio = inputSampleRate / outputSampleRate;
  let buffer = new Float32Array(0);
  let bufferStartGlobal = 0;
  let nextOutputIndex = 0;

  return function resampleChunk(chunk: Float32Array): Float32Array {
    if (chunk.length === 0) {
      return new Float32Array(0);
    }

    const combined = new Float32Array(buffer.length + chunk.length);
    combined.set(buffer, 0);
    combined.set(chunk, buffer.length);

    const outputs: number[] = [];
    while (true) {
      const srcPos = nextOutputIndex * ratio - bufferStartGlobal;
      if (srcPos >= combined.length - 1) {
        break;
      }
      if (srcPos < 0) {
        nextOutputIndex += 1;
        continue;
      }

      const j = Math.floor(srcPos);
      const frac = srcPos - j;
      const s0 = combined[j] ?? 0;
      const s1 = combined[j + 1] ?? s0;
      outputs.push(s0 + (s1 - s0) * frac);
      nextOutputIndex += 1;
    }

    const nextSrcPos = nextOutputIndex * ratio - bufferStartGlobal;
    const trimFrom = Math.max(0, Math.floor(nextSrcPos) - 1);
    buffer = combined.slice(trimFrom);
    bufferStartGlobal += trimFrom;

    return new Float32Array(outputs);
  };
}

export function float32ToPcm16Base64(float32Array: Float32Array): string {
  const int16Array = new Int16Array(float32Array.length);
  for (let index = 0; index < float32Array.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, float32Array[index] ?? 0));
    int16Array[index] = sample * 0x7fff;
  }
  return arrayBufferToBase64(int16Array.buffer);
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index] ?? 0);
  }
  return window.btoa(binary);
}

export function base64Pcm16ToFloat32(base64Audio: string): Float32Array {
  const binaryString = atob(base64Audio);
  const bytes = new Uint8Array(binaryString.length);
  for (let index = 0; index < binaryString.length; index += 1) {
    bytes[index] = binaryString.charCodeAt(index);
  }
  const inputArray = new Int16Array(bytes.buffer);
  const float32Data = new Float32Array(inputArray.length);
  for (let index = 0; index < inputArray.length; index += 1) {
    float32Data[index] = inputArray[index] / 32768;
  }
  return float32Data;
}
