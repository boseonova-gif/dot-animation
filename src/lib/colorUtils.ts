export type Rgb = { r: number; g: number; b: number };

export function hexToRgb(hex: string): Rgb {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(normalized, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const toHex = (channel: number) =>
    Math.max(0, Math.min(255, Math.round(channel)))
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function colorDistance(a: Rgb, b: Rgb): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
}

type Lab = { L: number; a: number; b: number };

function srgbToLinear(channel: number) {
  const normalized = channel / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function rgbToXyz({ r, g, b }: Rgb) {
  const red = srgbToLinear(r);
  const green = srgbToLinear(g);
  const blue = srgbToLinear(b);

  return {
    x: red * 0.4124564 + green * 0.3575761 + blue * 0.1804375,
    y: red * 0.2126729 + green * 0.7151522 + blue * 0.072175,
    z: red * 0.0193339 + green * 0.119192 + blue * 0.9503041,
  };
}

function xyzToLab(x: number, y: number, z: number): Lab {
  const refX = 0.95047;
  const refY = 1;
  const refZ = 1.08883;

  const fx =
    x / refX > 0.008856 ? (x / refX) ** (1 / 3) : 7.787 * (x / refX) + 16 / 116;
  const fy =
    y / refY > 0.008856 ? (y / refY) ** (1 / 3) : 7.787 * (y / refY) + 16 / 116;
  const fz =
    z / refZ > 0.008856 ? (z / refZ) ** (1 / 3) : 7.787 * (z / refZ) + 16 / 116;

  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

function rgbToLab(rgb: Rgb): Lab {
  const { x, y, z } = rgbToXyz(rgb);
  return xyzToLab(x, y, z);
}

export function perceptualColorDistance(a: Rgb, b: Rgb): number {
  const labA = rgbToLab(a);
  const labB = rgbToLab(b);
  const dL = labA.L - labB.L;
  const da = labA.a - labB.a;
  const db = labA.b - labB.b;
  return dL * dL + da * da + db * db;
}

export function nearestPaletteMatch(pixel: Rgb, palette: Rgb[]): { index: number; distance: number } {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < palette.length; index += 1) {
    const distance = perceptualColorDistance(pixel, palette[index]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return { index: bestIndex, distance: bestDistance };
}

export function nearestPaletteIndex(pixel: Rgb, palette: Rgb[]): number {
  return nearestPaletteMatch(pixel, palette).index;
}

function clampColorArea(colorArea: number) {
  return Math.max(0, Math.min(100, colorArea));
}

/** 0 = almost no colored dots, 100 = very permissive matching. */
export function getColorAssignmentThreshold(colorArea: number): number {
  const amount = clampColorArea(colorArea) / 100;
  const minThreshold = 4;
  const maxThreshold = 75000;
  return minThreshold * (maxThreshold / minThreshold) ** amount;
}

/** Scales dot size to grow/shrink visible color blobs. */
export function getColorAreaRadiusMultiplier(colorArea: number): number {
  const amount = clampColorArea(colorArea) / 100;
  return 0.35 + amount ** 1.15 * 2.65;
}

/** Extra grid rings filled from neighboring colors (0–4). */
export function getColorExpansionRings(colorArea: number): number {
  if (colorArea <= 10) return 0;
  return Math.min(4, Math.round(((clampColorArea(colorArea) - 10) / 90) * 4));
}

/** Fills only unused palette slots so all swatches can appear without rebalancing the frame. */
export function ensurePaletteCoverage(
  initialIndices: number[],
  samples: Rgb[],
  palette: Rgb[],
): number[] {
  if (initialIndices.length === 0 || palette.length === 0) return initialIndices;
  if (initialIndices.length < palette.length) return initialIndices;

  const indices = [...initialIndices];
  const usedSlots = new Set(indices);

  for (let slot = 0; slot < palette.length; slot += 1) {
    if (usedSlots.has(slot)) continue;

    let bestPebble = -1;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let pebbleIndex = 0; pebbleIndex < indices.length; pebbleIndex += 1) {
      const distance = perceptualColorDistance(samples[pebbleIndex], palette[slot]);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestPebble = pebbleIndex;
      }
    }

    if (bestPebble >= 0) {
      indices[bestPebble] = slot;
      usedSlots.add(slot);
    }
  }

  return indices;
}

export function isBackgroundLike(sample: Rgb, backgroundColor: string): boolean {
  const background = hexToRgb(backgroundColor);
  const threshold = 38;
  return perceptualColorDistance(sample, background) <= threshold * threshold;
}

export function extractPaletteFromImageData(
  data: Uint8ClampedArray,
  count: number,
): string[] {
  const samples: Rgb[] = [];
  const step = Math.max(4, Math.floor(data.length / (4 * 800)));

  for (let index = 0; index < data.length; index += step * 4) {
    const alpha = data[index + 3];
    if (alpha < 128) continue;
    samples.push({
      r: data[index],
      g: data[index + 1],
      b: data[index + 2],
    });
  }

  if (samples.length === 0) {
    return [
      "#F5D5CB",
      "#9BB7D4",
      "#7BA4C9",
      "#E8C4B8",
      "#6B93B8",
      "#D4A99A",
      "#4A6F8C",
    ].slice(0, count);
  }

  let centroids = samples
    .filter((_, index) => index % Math.ceil(samples.length / count) === 0)
    .slice(0, count);

  while (centroids.length < count) {
    centroids.push(samples[Math.floor(Math.random() * samples.length)]);
  }

  for (let iteration = 0; iteration < 8; iteration += 1) {
    const buckets: Rgb[][] = Array.from({ length: count }, () => []);

    for (const sample of samples) {
      const nearest = nearestPaletteIndex(sample, centroids);
      buckets[nearest].push(sample);
    }

    centroids = centroids.map((centroid, index) => {
      const bucket = buckets[index];
      if (bucket.length === 0) return centroid;
      const total = bucket.reduce(
        (accumulator, color) => ({
          r: accumulator.r + color.r,
          g: accumulator.g + color.g,
          b: accumulator.b + color.b,
        }),
        { r: 0, g: 0, b: 0 },
      );
      return {
        r: total.r / bucket.length,
        g: total.g / bucket.length,
        b: total.b / bucket.length,
      };
    });
  }

  return centroids
    .map((color) => rgbToHex(color))
    .sort((left, right) => {
      const leftLum =
        hexToRgb(left).r * 0.299 +
        hexToRgb(left).g * 0.587 +
        hexToRgb(left).b * 0.114;
      const rightLum =
        hexToRgb(right).r * 0.299 +
        hexToRgb(right).g * 0.587 +
        hexToRgb(right).b * 0.114;
      return rightLum - leftLum;
    });
}
