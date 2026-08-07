import type { GeminiLiveClient } from "@/lib/gemini-live/client";
import { float32ToPcm16Base64, createStreamingResampler } from "./pcm";

export const MIC_SAMPLE_RATE = 16_000;

const MIC_NOISE_FLOOR_INITIAL = 0.008;
const MIC_NOISE_GATE_MIN_RMS = 0.028;
const MIC_NOISE_GATE_MULTIPLIER = 3.2;
const MIC_NOISE_GATE_HOLD_CHUNKS = 8;
const MIC_VOLUME_SCALE = 5.5;

type AudioStreamerOptions = {
  onVolume?: (volume: number) => void;
  /** Extend mic hold after speech drops (512-sample chunks at 16 kHz ≈ 32 ms each). */
  noiseGateHoldChunks?: number;
  /**
   * Override the minimum RMS the gate treats as silence. Higher values reject
   * more low-level background noise but require louder speech to open the
   * gate.
   */
  noiseGateMinRms?: number;
  /** Fired when live microphone capture ends or becomes unavailable. */
  onCaptureLost?: (reason: string) => void;
};

export function bindMicrophoneCaptureLifecycle(
  mediaStream: MediaStream,
  onCaptureLost: (reason: string) => void,
): void {
  for (const track of mediaStream.getAudioTracks()) {
    track.onended = () => {
      onCaptureLost("Microphone capture ended.");
    };
    track.onmute = () => {
      if (!isMicrophoneCaptureAlive(mediaStream)) {
        onCaptureLost("Microphone became unavailable.");
      }
    };
  }
}

export function isMicrophoneCaptureAlive(
  mediaStream: MediaStream | null | undefined,
): boolean {
  const tracks = mediaStream?.getAudioTracks() ?? [];
  return tracks.some((track) => track.readyState === "live" && track.enabled);
}

export async function requestMicrophoneAccess(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      "Microphone access is not available in this browser. Use HTTPS or localhost.",
    );
  }

  let mediaStream: MediaStream;
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: MIC_SAMPLE_RATE,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      throw new Error(
        "Microphone permission denied. Allow microphone access and try again.",
      );
    }
    throw err;
  }

  if (!isMicrophoneCaptureAlive(mediaStream)) {
    mediaStream.getTracks().forEach((track) => track.stop());
    throw new Error(
      "No microphone audio available. Connect a microphone and try again.",
    );
  }

  return mediaStream;
}

export class AudioStreamer {
  private audioContext: AudioContext | null = null;
  private audioWorklet: AudioWorkletNode | null = null;
  private mediaStream: MediaStream | null = null;
  private isStreaming = false;
  private readonly inputNoiseGate: ReturnType<typeof createInputNoiseGate>;
  private inputResampler: ((chunk: Float32Array) => Float32Array) | null =
    null;
  private readonly sampleRate = MIC_SAMPLE_RATE;
  private captureLostNotified = false;

  constructor(
    private readonly client: GeminiLiveClient,
    private readonly options: AudioStreamerOptions = {},
  ) {
    this.inputNoiseGate = createInputNoiseGate(
      options.noiseGateHoldChunks,
      options.noiseGateMinRms,
    );
  }

  async start(existingStream?: MediaStream): Promise<void> {
    const mediaStream = existingStream ?? (await requestMicrophoneAccess());
    if (!isMicrophoneCaptureAlive(mediaStream)) {
      if (!existingStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
      }
      throw new Error(
        "No microphone audio available. Connect a microphone and try again.",
      );
    }

    this.captureLostNotified = false;
    this.mediaStream = mediaStream;
    this.attachCaptureLifecycleHandlers(mediaStream);
    this.audioContext = new AudioContext({ sampleRate: this.sampleRate });
    const captureRate = this.audioContext.sampleRate;
    this.inputResampler =
      captureRate === this.sampleRate
        ? null
        : createStreamingResampler(captureRate, this.sampleRate);
    await this.audioContext.audioWorklet.addModule(
      "/audio-processors/capture.worklet.js",
    );

    this.audioWorklet = new AudioWorkletNode(
      this.audioContext,
      "audio-capture-processor",
    );
    this.audioWorklet.port.onmessage = (event) => {
      if (!this.isStreaming || !this.client.isConnected) {
        return;
      }
      if (event.data?.type !== "audio") {
        return;
      }
      const raw = event.data.data as Float32Array;
      const inputData = this.inputResampler ? this.inputResampler(raw) : raw;
      if (inputData.length === 0) {
        return;
      }
      const gatedInput = this.inputNoiseGate(inputData);
      this.options.onVolume?.(gatedInput.volume);
      const base64Audio = float32ToPcm16Base64(gatedInput.samples);
      this.client.sendAudioMessage(base64Audio);
    };

    const source = this.audioContext.createMediaStreamSource(this.mediaStream);
    source.connect(this.audioWorklet);
    this.isStreaming = true;
  }

  stop() {
    this.isStreaming = false;
    this.captureLostNotified = false;
    this.inputResampler = null;
    this.audioWorklet?.disconnect();
    this.audioWorklet?.port.close();
    this.audioWorklet = null;
    void this.audioContext?.close();
    this.audioContext = null;
    this.mediaStream?.getTracks().forEach((track) => track.stop());
    this.mediaStream = null;
  }

  /** Resume capture after the browser suspends audio while the page is backgrounded. */
  async resumeAfterBackground(): Promise<void> {
    if (!this.isStreaming) {
      return;
    }

    if (!isMicrophoneCaptureAlive(this.mediaStream)) {
      this.notifyCaptureLost("Microphone capture ended.");
      return;
    }

    if (this.audioContext?.state === "suspended") {
      await this.audioContext.resume();
    }
  }

  private attachCaptureLifecycleHandlers(mediaStream: MediaStream) {
    bindMicrophoneCaptureLifecycle(mediaStream, (reason) => {
      this.notifyCaptureLost(reason);
    });
  }

  private notifyCaptureLost(reason: string) {
    if (!this.isStreaming || this.captureLostNotified) {
      return;
    }
    this.captureLostNotified = true;
    this.options.onCaptureLost?.(reason);
  }
}

export function calculateRms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) {
    sum += sample * sample;
  }
  return Math.sqrt(sum / samples.length);
}

export function createInputNoiseGate(
  holdChunks = MIC_NOISE_GATE_HOLD_CHUNKS,
  minRms = MIC_NOISE_GATE_MIN_RMS,
) {
  let noiseFloor = MIC_NOISE_FLOOR_INITIAL;
  let remainingHoldChunks = 0;

  return (
    samples: Float32Array,
  ): { samples: Float32Array; volume: number; isSpeech: boolean } => {
    const rms = calculateRms(samples);
    const threshold = Math.max(minRms, noiseFloor * MIC_NOISE_GATE_MULTIPLIER);
    const isSpeech = rms >= threshold;

    if (isSpeech) {
      remainingHoldChunks = holdChunks;
    } else if (remainingHoldChunks > 0) {
      remainingHoldChunks -= 1;
    } else {
      noiseFloor = noiseFloor * 0.97 + Math.min(rms, minRms) * 0.03;
    }

    const gateOpen = isSpeech || remainingHoldChunks > 0;
    if (!gateOpen) {
      return {
        samples: new Float32Array(samples.length),
        volume: 0,
        isSpeech: false,
      };
    }

    const visualVolume = Math.min(
      1,
      Math.max(0, (rms - threshold * 0.55) * MIC_VOLUME_SCALE),
    );
    return {
      samples,
      volume: visualVolume,
      isSpeech: true,
    };
  };
}
