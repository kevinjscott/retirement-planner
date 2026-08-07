/**
 * Audio Worklet Processor for playing 24 kHz PCM audio.
 */
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.audioQueue = [];
    this.currentOffset = 0;
    this.volumeSampleCount = 0;
    this.volumeSum = 0;
    this.hasNotifiedEnded = false;

    this.port.onmessage = (event) => {
      if (event.data === 'interrupt') {
        this.audioQueue = [];
        this.currentOffset = 0;
        this.volumeSampleCount = 0;
        this.volumeSum = 0;
        this.hasNotifiedEnded = false;
        this.port.postMessage({ type: 'volume', volume: 0 });
      } else if (event.data instanceof Float32Array) {
        this.audioQueue.push(event.data);
        this.hasNotifiedEnded = false;
      }
    };
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (output.length === 0) {
      return true;
    }

    const channel = output[0];
    let outputIndex = 0;

    const hadAudioAtStart = this.audioQueue.length > 0;

    while (outputIndex < channel.length && this.audioQueue.length > 0) {
      const currentBuffer = this.audioQueue[0];

      if (!currentBuffer || currentBuffer.length === 0) {
        this.audioQueue.shift();
        this.currentOffset = 0;
        continue;
      }

      const remainingOutput = channel.length - outputIndex;
      const remainingBuffer = currentBuffer.length - this.currentOffset;
      const copyLength = Math.min(remainingOutput, remainingBuffer);

      for (let index = 0; index < copyLength; index += 1) {
        channel[outputIndex] = currentBuffer[this.currentOffset];
        outputIndex += 1;
        this.currentOffset += 1;
      }

      if (this.currentOffset >= currentBuffer.length) {
        this.audioQueue.shift();
        this.currentOffset = 0;
      }
    }

    while (outputIndex < channel.length) {
      channel[outputIndex] = 0;
      outputIndex += 1;
    }

    for (let index = 0; index < channel.length; index += 1) {
      const sample = channel[index] || 0;
      this.volumeSum += sample * sample;
      this.volumeSampleCount += 1;
    }

    if (this.volumeSampleCount >= 2048) {
      const rms = Math.min(1, Math.sqrt(this.volumeSum / this.volumeSampleCount) * 8);
      this.port.postMessage({ type: 'volume', volume: rms });
      this.volumeSum = 0;
      this.volumeSampleCount = 0;
    }

    // Notify when we've fully drained the playback queue.
    // This prevents tearing down `AudioContext` before the last words finish playing.
    if (hadAudioAtStart && this.audioQueue.length === 0 && !this.hasNotifiedEnded) {
      this.hasNotifiedEnded = true;
      this.port.postMessage({ type: 'ended' });
    }

    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
