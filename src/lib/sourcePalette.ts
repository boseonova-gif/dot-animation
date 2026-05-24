import { extractPaletteFromImageData } from "./colorUtils";
import { MAX_COLORS, normalizePalette } from "./types";

export async function captureVideoFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  time = 0,
): Promise<ImageData | null> {
  if (video.videoWidth <= 0 || video.videoHeight <= 0) return null;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  const savedTime = video.currentTime;
  const wasPaused = video.paused;
  const needsSeek = Math.abs(video.currentTime - time) > 0.02;

  if (needsSeek) {
    video.pause();
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        video.removeEventListener("seeked", onSeeked);
        reject(new Error("영상 탐색 시간이 초과되었습니다."));
      }, 8000);

      const onSeeked = () => {
        window.clearTimeout(timeout);
        video.removeEventListener("seeked", onSeeked);
        resolve();
      };

      video.addEventListener("seeked", onSeeked);
      video.currentTime = time;
    });
  }

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  context.drawImage(video, 0, 0);

  const image = context.getImageData(0, 0, canvas.width, canvas.height);

  if (needsSeek) {
    video.currentTime = savedTime;
    if (!wasPaused) {
      await video.play().catch(() => undefined);
    }
  }

  return image;
}

export async function extractSourcePaletteFromVideo(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  time = 0,
): Promise<string[]> {
  const image = await captureVideoFrame(video, canvas, time);
  if (!image) {
    return normalizePalette([]);
  }

  return normalizePalette(extractPaletteFromImageData(image.data, MAX_COLORS));
}
