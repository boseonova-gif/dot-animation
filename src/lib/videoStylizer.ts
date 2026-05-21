import {
  buildPebbles,
  drawPebbleFrame,
  getMotionBlendRatio,
  lerpPebbles,
} from "./pebbleProcessor";
import { hexToRgb, nearestPaletteIndex } from "./colorUtils";
import { normalizePalette, type ProcessedFrame, type StylizerSettings } from "./types";

const MAX_PROCESS_WIDTH = 1920;

function quantizeImageData(source: ImageData, palette: string[]): ImageData {
  const { width, height, data } = source;
  const rgbPalette = palette.map(hexToRgb);
  const output = new ImageData(width, height);

  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    const nearest = rgbPalette[nearestPaletteIndex(
      {
        r: data[offset],
        g: data[offset + 1],
        b: data[offset + 2],
      },
      rgbPalette,
    )];
    output.data[offset] = nearest.r;
    output.data[offset + 1] = nearest.g;
    output.data[offset + 2] = nearest.b;
    output.data[offset + 3] = 255;
  }

  return output;
}

function getProcessDimensions(sourceWidth: number, sourceHeight: number) {
  if (sourceWidth <= MAX_PROCESS_WIDTH) {
    return { width: sourceWidth, height: sourceHeight };
  }

  const scale = MAX_PROCESS_WIDTH / sourceWidth;
  return {
    width: MAX_PROCESS_WIDTH,
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
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

  const { width, height } = getProcessDimensions(sourceWidth, sourceHeight);
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

  const palette = normalizePalette(settings.colors);
  const rawImage = workContext.getImageData(0, 0, width, height);
  const quantized = quantizeImageData(rawImage, palette);
  const pebbles = buildPebbles(quantized, palette, settings.shapeDetail, settings.dotSize);

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

  const bufferWidth = Math.round(frame.width * pixelRatio);
  const bufferHeight = Math.round(frame.height * pixelRatio);

  if (targetCanvas.width !== bufferWidth || targetCanvas.height !== bufferHeight) {
    targetCanvas.width = bufferWidth;
    targetCanvas.height = bufferHeight;
  }

  targetCanvas.style.aspectRatio = `${frame.sourceWidth} / ${frame.sourceHeight}`;

  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  drawPebbleFrame(
    context,
    frame.width,
    frame.height,
    frame.pebbles,
    palette,
    settings.dotSize,
  );
}

export function blendFrames(
  previous: ProcessedFrame | null,
  current: ProcessedFrame,
  motionDetail: number,
): ProcessedFrame {
  const blendRatio = getMotionBlendRatio(motionDetail);
  if (!previous || blendRatio <= 0 || previous.pebbles.length === 0) {
    return current;
  }

  return {
    ...current,
    pebbles: lerpPebbles(previous.pebbles, current.pebbles, blendRatio),
  };
}
