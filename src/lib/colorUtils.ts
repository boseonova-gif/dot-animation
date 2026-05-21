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

export function nearestPaletteIndex(pixel: Rgb, palette: Rgb[]): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < palette.length; index += 1) {
    const distance = colorDistance(pixel, palette[index]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return bestIndex;
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
