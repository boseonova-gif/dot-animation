import {
  buildPebbles,
  drawPebbleFrame,
} from "./pebbleProcessor";
import { normalizePalette, type ProcessedFrame, type StylizerSettings } from "./types";

const PREVIEW_MAX_PROCESS_WIDTH = 960;
const EXPORT_MAX_PROCESS_WIDTH = 1920;

function getProcessDimensions(
  sourceWidth: number,
  sourceHeight: number,
  maxProcessWidth: number,
) {
  if (sourceWidth <= maxProcessWidth) {
    return { width: sourceWidth, height: sourceHeight };
  }

  const width = maxProcessWidth;
  const height = Math.max(1, Math.round((sourceHeight / sourceWidth) * width));
  return { width, height };
}

let workCanvas: HTMLCanvasElement | null = null;

function getWorkCanvas(width: number, height: number) {
  if (!workCanvas) {
    workCanvas = document.createElement("canvas");
  }
  if (workCanvas.width !== width || workCanvas.height !== height) {
    workCanvas.width = width;
    workCanvas.height = height;
  }
  return workCanvas;
}

export function processVideoFrame(
  sourceCanvas: HTMLCanvasElement,
  settings: StylizerSettings,
  assignmentPalette: string[],
  colorDistributionSeed = 0,
  options?: { maxProcessWidth?: number },
): ProcessedFrame {
  const sourceWidth = sourceCanvas.width;
  const sourceHeight = sourceCanvas.height;

  if (sourceWidth === 0 || sourceHeight === 0) {
    return {
      width: 0,
      height: 0,
      sourceWidth: 0,
      sourceHeight: 0,
      pebbles: [],
    };
  }

  const maxProcessWidth = options?.maxProcessWidth ?? PREVIEW_MAX_PROCESS_WIDTH;
  const { width, height } = getProcessDimensions(sourceWidth, sourceHeight, maxProcessWidth);
  const canvas = getWorkCanvas(width, height);
  const workContext = canvas.getContext("2d", { willReadFrequently: true });

  if (!workContext) {
    return {
      width: 0,
      height: 0,
      sourceWidth,
      sourceHeight,
      pebbles: [],
    };
  }

  workContext.imageSmoothingEnabled = true;
  workContext.imageSmoothingQuality = "high";
  workContext.drawImage(sourceCanvas, 0, 0, width, height);

  const rawImage = workContext.getImageData(0, 0, width, height);
  const pebbles = buildPebbles(
    rawImage,
    normalizePalette(assignmentPalette),
    settings.shapeDetail,
    settings.dotSize,
    settings.dotDensity,
    settings.backgroundColor,
    settings.colorArea,
    colorDistributionSeed,
  );

  return {
    width,
    height,
    sourceWidth,
    sourceHeight,
    pebbles,
  };
}

export function renderProcessedFrame(
  targetCanvas: HTMLCanvasElement,
  frame: ProcessedFrame,
  settings: StylizerSettings,
  options?: { pixelRatio?: number },
) {
  const context = targetCanvas.getContext("2d");
  if (!context || frame.width === 0 || frame.height === 0) return;

  const palette = normalizePalette(settings.colors);
  const pixelRatio =
    options?.pixelRatio ??
    (typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 3) : 1);

  const bufferWidth = Math.round(frame.sourceWidth * pixelRatio);
  const bufferHeight = Math.round(frame.sourceHeight * pixelRatio);

  if (targetCanvas.width !== bufferWidth || targetCanvas.height !== bufferHeight) {
    targetCanvas.width = bufferWidth;
    targetCanvas.height = bufferHeight;
  }

  const scaleX = frame.sourceWidth / frame.width;
  const scaleY = frame.sourceHeight / frame.height;

  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  context.save();
  context.scale(scaleX, scaleY);
  drawPebbleFrame(
    context,
    frame.width,
    frame.height,
    frame.pebbles,
    palette,
    settings.dotSize,
    settings.backgroundColor,
  );
  context.restore();
}

export { EXPORT_MAX_PROCESS_WIDTH, PREVIEW_MAX_PROCESS_WIDTH };
