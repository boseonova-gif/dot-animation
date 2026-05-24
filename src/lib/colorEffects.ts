import { hexToRgb, rgbToHex } from "./colorUtils";
import { MAX_COLORS } from "./types";

function seededRandom(seed: number) {
  const wave = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return wave - Math.floor(wave);
}

function hslToHex(h: number, s: number, l: number): string {
  const saturation = s / 100;
  const lightness = l / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const intermediate = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  let red = 0;
  let green = 0;
  let blue = 0;

  if (h < 60) [red, green, blue] = [chroma, intermediate, 0];
  else if (h < 120) [red, green, blue] = [intermediate, chroma, 0];
  else if (h < 180) [red, green, blue] = [0, chroma, intermediate];
  else if (h < 240) [red, green, blue] = [0, intermediate, chroma];
  else if (h < 300) [red, green, blue] = [intermediate, 0, chroma];
  else [red, green, blue] = [chroma, 0, intermediate];

  const match = lightness - chroma / 2;
  return rgbToHex({
    r: (red + match) * 255,
    g: (green + match) * 255,
    b: (blue + match) * 255,
  });
}

function luminance(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  return r * 0.299 + g * 0.587 + b * 0.114;
}

export function generateRandomBackgroundColor(seed = Date.now()): string {
  const useDark = seededRandom(seed + 99) > 0.5;
  const hue = seededRandom(seed + 100) * 360;
  const saturation = 5 + seededRandom(seed + 101) * 30;
  const lightness = useDark
    ? 5 + seededRandom(seed + 102) * 14
    : 86 + seededRandom(seed + 102) * 12;
  return hslToHex(hue, saturation, lightness);
}

export function generateFreshPalette(seed = Date.now()): string[] {
  const colors: string[] = [];
  const baseHue = seededRandom(seed) * 360;
  const scheme = Math.floor(seededRandom(seed + 1) * 3);

  for (let index = 0; index < MAX_COLORS; index += 1) {
    let hue = baseHue;
    if (scheme === 0) {
      hue = (baseHue + index * (28 + seededRandom(seed + index) * 32)) % 360;
    } else if (scheme === 1) {
      hue = (baseHue + index * 47 + seededRandom(seed + index * 2) * 55) % 360;
    } else {
      hue = (baseHue + index * (360 / MAX_COLORS) + seededRandom(seed + index * 3) * 36) % 360;
    }

    const saturation = 30 + seededRandom(seed + index * 5) * 45;
    const lightness = 40 + seededRandom(seed + index * 7) * 38;
    colors.push(hslToHex(hue, saturation, lightness));
  }

  return colors.sort((left, right) => luminance(right) - luminance(left));
}

export function createColorDistributionSeed() {
  return Date.now() + Math.floor(Math.random() * 1_000_000);
}

/** Randomly reorders palette slot indices for area assignment. */
export function buildColorIndexPermutation(length: number, seed: number): number[] {
  const order = Array.from({ length }, (_, index) => index);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(seededRandom(seed + index * 17) * (index + 1));
    const current = order[index];
    order[index] = order[swapIndex];
    order[swapIndex] = current;
  }
  return order;
}
