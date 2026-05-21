import type { Pebble } from "./types";
import { hexToRgb, nearestPaletteIndex, type Rgb } from "./colorUtils";

function getCellSize(shapeDetail: number) {
  return Math.max(8, Math.round(30 - shapeDetail * 0.2));
}

function getConnectStrength(dotSize: number) {
  return Math.max(0, Math.min(1, (dotSize - 35) / 65));
}

function getRadiusScale(dotSize: number) {
  const connectStrength = getConnectStrength(dotSize);
  const sizeScale = 0.38 + (dotSize / 100) * 0.72;
  const connectBoost = 1 + connectStrength * 0.25;
  return sizeScale * connectBoost;
}

function sampleCellColor(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  cellW: number,
  cellH: number,
): Rgb {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;

  const endX = Math.min(width, startX + cellW);
  const endY = Math.min(height, startY + cellH);

  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const index = (y * width + x) * 4;
      r += data[index];
      g += data[index + 1];
      b += data[index + 2];
      count += 1;
    }
  }

  if (count === 0) return { r: 0, g: 0, b: 0 };
  return { r: r / count, g: g / count, b: b / count };
}

function pebbleVariation(seed: number) {
  const wave = Math.sin(seed * 12.9898) * 43758.5453;
  return wave - Math.floor(wave);
}

export function buildPebbles(
  imageData: ImageData,
  palette: string[],
  shapeDetail: number,
  dotSize: number,
): Pebble[] {
  const { width, height, data } = imageData;
  const rgbPalette = palette.map(hexToRgb);
  const cellSize = getCellSize(shapeDetail);
  const radiusScale = getRadiusScale(dotSize);
  const connectStrength = getConnectStrength(dotSize);
  const pebbles: Pebble[] = [];

  const cols = Math.ceil(width / cellSize) + 1;
  const rows = Math.ceil(height / cellSize) + 1;

  for (let row = 0; row < rows; row += 1) {
    const rowOffset = row % 2 === 0 ? 0 : cellSize * 0.5;
    for (let col = 0; col < cols; col += 1) {
      const centerX = col * cellSize + rowOffset + cellSize * 0.5;
      const centerY = row * cellSize * 0.86 + cellSize * 0.5;

      if (centerX < -cellSize * 0.3 || centerY < -cellSize * 0.3) continue;
      if (centerX > width + cellSize * 0.3 || centerY > height + cellSize * 0.3) continue;

      const sampleX = Math.max(0, Math.min(width - 1, Math.round(centerX - cellSize * 0.5)));
      const sampleY = Math.max(0, Math.min(height - 1, Math.round(centerY - cellSize * 0.5)));
      const sampleW = Math.min(cellSize, width - sampleX);
      const sampleH = Math.min(cellSize, height - sampleY);

      const sampled = sampleCellColor(data, width, height, sampleX, sampleY, sampleW, sampleH);
      const colorIndex = nearestPaletteIndex(sampled, rgbPalette);
      const seed = row * 997 + col;

      const sizeJitter = 0.88 + pebbleVariation(seed) * 0.2;
      const expand = 1 + connectStrength * 1.12;
      const baseRadius = cellSize * 0.5 * radiusScale * sizeJitter * expand;
      const stretch = 0.9 + pebbleVariation(seed + 17) * 0.18;

      pebbles.push({
        x: centerX,
        y: centerY,
        radiusX: baseRadius,
        radiusY: baseRadius * stretch,
        rotation: pebbleVariation(seed + 41) * Math.PI,
        colorIndex,
      });
    }
  }

  return pebbles;
}

function drawPebblesByIndex(
  ctx: CanvasRenderingContext2D,
  pebbles: Pebble[],
  palette: string[],
) {
  for (const pebble of pebbles) {
    const color = palette[pebble.colorIndex] ?? palette[0];
    ctx.save();
    ctx.translate(pebble.x, pebble.y);
    ctx.rotate(pebble.rotation);
    ctx.beginPath();
    ctx.ellipse(0, 0, pebble.radiusX, pebble.radiusY, 0, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }
}

function drawConnectedByIndex(
  ctx: CanvasRenderingContext2D,
  pebbles: Pebble[],
  palette: string[],
) {
  const groups = new Map<number, Pebble[]>();
  for (const pebble of pebbles) {
    const group = groups.get(pebble.colorIndex) ?? [];
    group.push(pebble);
    groups.set(pebble.colorIndex, group);
  }

  const orderedIndexes = [...groups.keys()].sort((left, right) => {
    if (left === 0) return -1;
    if (right === 0) return 1;
    return left - right;
  });

  for (const colorIndex of orderedIndexes) {
    const group = groups.get(colorIndex);
    if (!group || group.length === 0) continue;

    const color = palette[colorIndex] ?? palette[0];
    ctx.fillStyle = color;

    for (const pebble of group) {
      ctx.save();
      ctx.translate(pebble.x, pebble.y);
      ctx.rotate(pebble.rotation);
      ctx.beginPath();
      ctx.ellipse(0, 0, pebble.radiusX, pebble.radiusY, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

export function drawPebbleFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  pebbles: Pebble[],
  palette: string[],
  dotSize: number,
) {
  const backgroundColor = palette[0] ?? "#F5D5CB";
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, width, height);

  const connectStrength = getConnectStrength(dotSize);
  if (connectStrength <= 0.05) {
    drawPebblesByIndex(ctx, pebbles, palette);
    return;
  }

  drawConnectedByIndex(ctx, pebbles, palette);
}

export function lerpPebbles(
  previous: Pebble[],
  current: Pebble[],
  ratio: number,
): Pebble[] {
  if (previous.length === 0 || ratio <= 0) return current;
  if (previous.length !== current.length) return current;

  return current.map((pebble, index) => {
    const prev = previous[index];
    if (!prev || prev.colorIndex !== pebble.colorIndex) return pebble;

    return {
      colorIndex: pebble.colorIndex,
      x: prev.x * ratio + pebble.x * (1 - ratio),
      y: prev.y * ratio + pebble.y * (1 - ratio),
      radiusX: prev.radiusX * ratio + pebble.radiusX * (1 - ratio),
      radiusY: prev.radiusY * ratio + pebble.radiusY * (1 - ratio),
      rotation: prev.rotation * ratio + pebble.rotation * (1 - ratio),
    };
  });
}

export function getMotionBlendRatio(motionDetail: number) {
  if (motionDetail >= 95) return 0;
  if (motionDetail <= 5) return 0.55;
  return ((100 - motionDetail) / 100) * 0.5;
}
