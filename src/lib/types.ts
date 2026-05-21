export const MAX_COLORS = 7;

export type StylizerSettings = {
  colors: string[];
  shapeDetail: number;
  motionDetail: number;
  dotSize: number;
};

export const DEFAULT_COLORS = [
  "#F5D5CB",
  "#9BB7D4",
  "#7BA4C9",
  "#E8C4B8",
  "#6B93B8",
  "#D4A99A",
  "#4A6F8C",
];

export const DEFAULT_SETTINGS: StylizerSettings = {
  colors: DEFAULT_COLORS,
  shapeDetail: 58,
  motionDetail: 62,
  dotSize: 72,
};

export type Pebble = {
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
  rotation: number;
  colorIndex: number;
};

export type ProcessedFrame = {
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  pebbles: Pebble[];
};

export function normalizePalette(colors: string[]): string[] {
  const next = colors.slice(0, MAX_COLORS).map((color) => color.toLowerCase());
  while (next.length < MAX_COLORS) {
    next.push(DEFAULT_COLORS[next.length].toLowerCase());
  }
  return next;
}
