export const MAX_COLORS = 7;

export type StylizerSettings = {
  colors: string[];
  backgroundColor: string;
  shapeDetail: number;
  dotSize: number;
  /** 0 = sparse / spread out, 100 = dense / packed */
  dotDensity: number;
  /** 0 = narrow color regions, 100 = wide color regions */
  colorArea: number;
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
  backgroundColor: "#ffffff",
  shapeDetail: 58,
  dotSize: 72,
  dotDensity: 62,
  colorArea: 55,
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
