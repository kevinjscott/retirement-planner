import { base64Pcm16ToFloat32 } from "./pcm";

/** 24 kHz PCM playback via AudioWorklet. Adapted from aitools-pgahq-com. */
export class AudioPlayer {
  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private gainNode: GainNode | null = null;
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;
  private playbackEpoch = 0;
  private readonly sampleRate = 24_000;

  constructor(
    private readonly options: {
      onVolume?: (volume: number, durationMs?: number) => void;
    } = {},
  ) {}

  async init() {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const audioContext = new AudioContext({ sampleRate: this.sampleRate });
      await audioContext.audioWorklet.addModule(
        "/audio-processors/playback.worklet.js",
      );

      const workletNode = new AudioWorkletNode(audioContext, "pcm-processor");
      const gainNode = audioContext.createGain();
      workletNode.port.onmessage = (event: MessageEvent) => {
        const data = event.data as { type?: string; volume?: unknown };
        if (data.type === "volume" && typeof data.volume === "number") {
          // Match aitools: ~90 ms hold window for barge-in / visualizer timing.
          this.options.onVolume?.(data.volume, 90);
        }
      };
      workletNode.connect(gainNode);
      gainNode.connect(audioContext.destination);

      this.audioContext = audioContext;
      this.workletNode = workletNode;
      this.gainNode = gainNode;
      this.isInitialized = true;
    })();

    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  async play(base64Audio: string) {
    const epoch = this.playbackEpoch;
    if (!this.isInitialized) await this.init();
    if (epoch !== this.playbackEpoch) return;
    if (!this.audioContext || !this.workletNode) return;

    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }

    this.workletNode.port.postMessage(base64Pcm16ToFloat32(base64Audio));
  }

  interrupt() {
    this.playbackEpoch += 1;
    this.workletNode?.port.postMessage("interrupt");
  }

  async resumeAfterBackground(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }
    if (this.audioContext?.state === "suspended") {
      await this.audioContext.resume();
    }
  }

  destroy() {
    this.playbackEpoch += 1;
    void this.audioContext?.close();
    this.audioContext = null;
    this.workletNode = null;
    this.gainNode = null;
    this.isInitialized = false;
    this.initPromise = null;
  }
}
