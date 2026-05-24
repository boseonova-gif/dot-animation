import { buildColorIndexPermutation } from "./colorEffects";
import type { Pebble } from "./types";
import {
  ensurePaletteCoverage,
  getColorAreaRadiusMultiplier,
  getColorAssignmentThreshold,
  getColorExpansionRings,
  hexToRgb,
  isBackgroundLike,
  nearestPaletteMatch,
  perceptualColorDistance,
  type Rgb,
} from "./colorUtils";

function getDensityGrid(dotDensity: number) {
  const amount = Math.max(0, Math.min(100, dotDensity)) / 100;
  const minCell = 8;
  const maxCell = 46;
  const cellSize = Math.round(maxCell - amount * (maxCell - minCell));
  const rowStep = cellSize * (0.66 + amount * 0.26);
  return { cellSize, rowStep, amount };
}

function getShapeParams(shapeDetail: number) {
  const amount = Math.max(0, Math.min(100, shapeDetail)) / 100;
  return {
    jitterMin: 0.84 + amount * 0.06,
    jitterRange: 0.14 + amount * 0.14,
    stretchMin: 0.84 + amount * 0.08,
    stretchRange: 0.16 + amount * 0.14,
  };
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

function getGridKey(row: number, col: number) {
  return `${row},${col}`;
}

function expandColorRegions(
  pebbles: Pebble[],
  width: number,
  height: number,
  cellSize: number,
  rowStep: number,
  colorArea: number,
  data: Uint8ClampedArray,
  rgbPalette: Rgb[],
  backgroundColor: string,
  assignmentThreshold: number,
  radiusScale: number,
  connectStrength: number,
): Pebble[] {
  const rings = getColorExpansionRings(colorArea);
  if (rings === 0 || pebbles.length === 0) return pebbles;

  const occupied = new Map<string, Pebble>();
  for (const pebble of pebbles) {
    const col = Math.round((pebble.x - cellSize * 0.5) / cellSize);
    const row = Math.round((pebble.y - cellSize * 0.5) / rowStep);
    occupied.set(getGridKey(row, col), pebble);
  }

  const radiusMult = getColorAreaRadiusMultiplier(colorArea);
  const next = [...pebbles];
  const neighborOffsets = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
    [1, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
  ];

  for (let ring = 0; ring < rings; ring += 1) {
    const added: Pebble[] = [];

    for (const [key, source] of occupied) {
      const [rowText, colText] = key.split(",");
      const row = Number(rowText);
      const col = Number(colText);

      for (const [dr, dc] of neighborOffsets) {
        const nextRow = row + dr;
        const nextCol = col + dc;
        const nextKey = getGridKey(nextRow, nextCol);
        if (occupied.has(nextKey)) continue;

        const rowOffset = nextRow % 2 === 0 ? 0 : cellSize * 0.5;
        const centerX = nextCol * cellSize + rowOffset + cellSize * 0.5;
        const centerY = nextRow * rowStep + cellSize * 0.5;

        if (centerX < 0 || centerY < 0 || centerX > width || centerY > height) continue;

        const sampleX = Math.max(0, Math.min(width - 1, Math.round(centerX - cellSize * 0.5)));
        const sampleY = Math.max(0, Math.min(height - 1, Math.round(centerY - cellSize * 0.5)));
        const sampleW = Math.min(cellSize, width - sampleX);
        const sampleH = Math.min(cellSize, height - sampleY);
        const sampled = sampleCellColor(data, width, height, sampleX, sampleY, sampleW, sampleH);

        if (isBackgroundLike(sampled, backgroundColor)) continue;

        const sourceDistance = perceptualColorDistance(sampled, rgbPalette[source.colorIndex]);
        const relaxedThreshold = assignmentThreshold * (1.35 + colorArea / 100);
        if (sourceDistance > relaxedThreshold) continue;

        const seed = nextRow * 997 + nextCol + ring * 131;
        const sizeJitter = 0.9 + pebbleVariation(seed) * 0.16;
        const expand = 1 + connectStrength * 1.12;
        const baseRadius = cellSize * 0.5 * radiusScale * sizeJitter * expand * radiusMult;
        const stretch = 0.9 + pebbleVariation(seed + 17) * 0.18;

        const pebble = clampPebbleToCanvas(
          {
            x: centerX,
            y: centerY,
            radiusX: baseRadius,
            radiusY: baseRadius * stretch,
            rotation: pebbleVariation(seed + 41) * Math.PI,
            colorIndex: source.colorIndex,
          },
          width,
          height,
        );

        added.push(pebble);
        occupied.set(nextKey, pebble);
      }
    }

    next.push(...added);
  }

  return next;
}

function clampPebbleToCanvas(pebble: Pebble, width: number, height: number): Pebble {
  const rx = pebble.radiusX;
  const ry = pebble.radiusY;
  return {
    ...pebble,
    x: Math.min(width - rx, Math.max(rx, pebble.x)),
    y: Math.min(height - ry, Math.max(ry, pebble.y)),
  };
}

type PebbleCandidate = {
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
  rotation: number;
  sampled: Rgb;
  colorIndex: number;
};

export function buildPebbles(
  imageData: ImageData,
  palette: string[],
  shapeDetail: number,
  dotSize: number,
  dotDensity: number,
  backgroundColor: string,
  colorArea: number,
  colorDistributionSeed = 0,
): Pebble[] {
  const { width, height, data } = imageData;
  const rgbPalette = palette.map(hexToRgb);
  const { cellSize, rowStep, amount: densityAmount } = getDensityGrid(dotDensity);
  const shapeParams = getShapeParams(shapeDetail);
  const radiusScale = getRadiusScale(dotSize);
  const connectStrength = getConnectStrength(dotSize);
  const assignmentThreshold = getColorAssignmentThreshold(colorArea);
  const radiusMult = getColorAreaRadiusMultiplier(colorArea);
  const forceInclude = colorArea >= 88;
  const useRandomDistribution = colorDistributionSeed !== 0;
  const indexPermutation = useRandomDistribution
    ? buildColorIndexPermutation(rgbPalette.length, colorDistributionSeed)
    : null;
  const candidates: PebbleCandidate[] = [];

  const cols = Math.ceil(width / cellSize) + 1;
  const rows = Math.ceil((height + cellSize) / rowStep) + 1;
  const maxRadiusEstimate = cellSize * 0.5 * radiusScale * 1.35 * (1 + connectStrength * 1.12);

  for (let row = 0; row < rows; row += 1) {
    const rowOffset = row % 2 === 0 ? 0 : cellSize * 0.5;
    for (let col = 0; col < cols; col += 1) {
      const centerX = col * cellSize + rowOffset + cellSize * 0.5;
      const centerY = row * rowStep + cellSize * 0.5;

      if (centerX < -maxRadiusEstimate || centerY < -maxRadiusEstimate) continue;
      if (centerX > width + maxRadiusEstimate || centerY > height + maxRadiusEstimate) continue;

      const sampleX = Math.max(0, Math.min(width - 1, Math.round(centerX - cellSize * 0.5)));
      const sampleY = Math.max(0, Math.min(height - 1, Math.round(centerY - cellSize * 0.5)));
      const sampleW = Math.min(cellSize, width - sampleX);
      const sampleH = Math.min(cellSize, height - sampleY);

      const sampled = sampleCellColor(data, width, height, sampleX, sampleY, sampleW, sampleH);
      if (isBackgroundLike(sampled, backgroundColor)) continue;

      const seed = row * 997 + col;

      const skipChance = (1 - densityAmount) * 0.58;
      if (pebbleVariation(seed + 311) < skipChance) continue;

      const sizeJitter =
        shapeParams.jitterMin + pebbleVariation(seed) * shapeParams.jitterRange;
      const expand = 1 + connectStrength * 1.12;
      const baseRadius = cellSize * 0.5 * radiusScale * sizeJitter * expand * radiusMult;
      const stretch =
        shapeParams.stretchMin + pebbleVariation(seed + 17) * shapeParams.stretchRange;

      let colorIndex: number;
      if (useRandomDistribution) {
        const slot = Math.floor(pebbleVariation(seed + colorDistributionSeed) * rgbPalette.length);
        colorIndex = indexPermutation?.[slot] ?? slot;
      } else {
        const match = nearestPaletteMatch(sampled, rgbPalette);
        if (!forceInclude && match.distance > assignmentThreshold) continue;
        colorIndex = match.index;
      }

      candidates.push({
        x: centerX,
        y: centerY,
        radiusX: baseRadius,
        radiusY: baseRadius * stretch,
        rotation: pebbleVariation(seed + 41) * Math.PI,
        sampled,
        colorIndex,
      });
    }
  }

  if (candidates.length === 0) return [];

  const initialIndices = candidates.map((candidate) => candidate.colorIndex);
  const samples = candidates.map((candidate) => candidate.sampled);
  const balancedIndices =
    colorArea >= 30
      ? ensurePaletteCoverage(initialIndices, samples, rgbPalette)
      : initialIndices;

  const basePebbles = candidates.map((candidate, index) =>
    clampPebbleToCanvas(
      {
        x: candidate.x,
        y: candidate.y,
        radiusX: candidate.radiusX,
        radiusY: candidate.radiusY,
        rotation: candidate.rotation,
        colorIndex: balancedIndices[index],
      },
      width,
      height,
    ),
  );

  return expandColorRegions(
    basePebbles,
    width,
    height,
    cellSize,
    rowStep,
    colorArea,
    data,
    rgbPalette,
    backgroundColor,
    assignmentThreshold,
    radiusScale,
    connectStrength,
  );
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

  const orderedIndexes = [...groups.keys()].sort((left, right) => left - right);

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
  backgroundColor: string,
) {
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, width, height);

  const connectStrength = getConnectStrength(dotSize);
  if (connectStrength <= 0.05) {
    drawPebblesByIndex(ctx, pebbles, palette);
    return;
  }

  drawConnectedByIndex(ctx, pebbles, palette);
}
