import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import { processVideoFrame, renderProcessedFrame } from "./videoStylizer";
import type { StylizerSettings } from "./types";

export type ExportProgress = {
  current: number;
  total: number;
};

function waitForSeek(video: HTMLVideoElement, time: number) {
  return new Promise<void>((resolve, reject) => {
    const clampedTime = Math.min(Math.max(time, 0), Math.max(video.duration - 0.001, 0));
    const timeout = window.setTimeout(() => {
      video.removeEventListener("seeked", onSeeked);
      reject(new Error("영상 탐색 시간이 초과되었습니다."));
    }, 12000);

    const onSeeked = () => {
      window.clearTimeout(timeout);
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };

    video.addEventListener("seeked", onSeeked);
    video.currentTime = clampedTime;
  });
}

async function getEncoderConfig(width: number, height: number) {
  const candidates = [
    { codec: "avc1.640028", bitrate: 10_000_000 },
    { codec: "avc1.42001E", bitrate: 8_000_000 },
  ];

  for (const candidate of candidates) {
    const config = {
      ...candidate,
      width,
      height,
      framerate: 30,
    };
    const support = await VideoEncoder.isConfigSupported(config);
    if (support.supported) return config;
  }

  return null;
}

export async function exportAnimationMp4(options: {
  video: HTMLVideoElement;
  sourceCanvas: HTMLCanvasElement;
  outputCanvas: HTMLCanvasElement;
  settings: StylizerSettings;
  onProgress?: (progress: ExportProgress) => void;
}): Promise<Blob> {
  const { video, sourceCanvas, outputCanvas, settings, onProgress } = options;

  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") {
    throw new Error("MP4 내보내기는 Chrome 또는 Edge에서 지원됩니다.");
  }

  const fps = 30;
  const duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("영상 길이를 확인할 수 없습니다.");
  }

  const totalFrames = Math.max(1, Math.ceil(duration * fps));
  const savedTime = video.currentTime;
  const wasPaused = video.paused;
  video.pause();

  const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
  if (!sourceContext) {
    throw new Error("소스 캔버스를 초기화할 수 없습니다.");
  }

  sourceCanvas.width = video.videoWidth;
  sourceCanvas.height = video.videoHeight;
  sourceContext.drawImage(video, 0, 0);
  const sampleFrame = processVideoFrame(sourceCanvas, settings);
  const width = sampleFrame.width;
  const height = sampleFrame.height;

  if (width === 0 || height === 0) {
    throw new Error("출력 크기를 계산할 수 없습니다.");
  }

  const encoderConfig = await getEncoderConfig(width, height);
  if (!encoderConfig) {
    throw new Error("H.264 인코더를 사용할 수 없습니다.");
  }

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: {
      codec: "avc",
      width,
      height,
    },
    fastStart: "in-memory",
  });

  let encoderError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      muxer.addVideoChunk(chunk, metadata);
    },
    error: (error) => {
      encoderError = error;
    },
  });

  encoder.configure(encoderConfig);

  try {
    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
      if (encoderError) throw encoderError;

      await waitForSeek(video, frameIndex / fps);

      sourceCanvas.width = video.videoWidth;
      sourceCanvas.height = video.videoHeight;
      sourceContext.drawImage(video, 0, 0);

      const processed = processVideoFrame(sourceCanvas, settings);
      renderProcessedFrame(outputCanvas, processed, settings, { pixelRatio: 1 });

      const timestamp = Math.round((frameIndex * 1_000_000) / fps);
      const frame = new VideoFrame(outputCanvas, { timestamp });
      encoder.encode(frame, { keyFrame: frameIndex % (fps * 2) === 0 });
      frame.close();

      onProgress?.({ current: frameIndex + 1, total: totalFrames });

      if (frameIndex % 4 === 0) {
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        });
      }
    }

    await encoder.flush();
    muxer.finalize();
  } finally {
    encoder.close();
    video.currentTime = savedTime;
    if (!wasPaused) {
      await video.play().catch(() => undefined);
    }
  }

  const buffer = muxer.target.buffer;
  if (!buffer) {
    throw new Error("MP4 파일을 생성하지 못했습니다.");
  }

  return new Blob([buffer], { type: "video/mp4" });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
