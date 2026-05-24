/** Fit two side-by-side preview panels inside the available viewport. */
export function computePreviewSizeForViewport(
  videoWidth: number,
  videoHeight: number,
  availableWidth: number,
  availableHeight: number,
  panelGap = 12,
) {
  const aspectWidth = videoWidth > 0 ? videoWidth : 16;
  const aspectHeight = videoHeight > 0 ? videoHeight : 9;
  const ratio = aspectWidth / aspectHeight;

  const maxPanelWidth = Math.max(1, (availableWidth - panelGap) / 2);
  const maxPanelHeight = Math.max(1, availableHeight);

  let width = maxPanelWidth;
  let height = width / ratio;

  if (height > maxPanelHeight) {
    height = maxPanelHeight;
    width = height * ratio;
  }

  return {
    width: Math.max(1, Math.floor(width)),
    height: Math.max(1, Math.floor(height)),
  };
}
