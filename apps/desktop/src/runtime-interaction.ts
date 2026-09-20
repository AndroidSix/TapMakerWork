export interface RuntimeWindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  pid: number;
  executablePath?: string;
}

export interface RuntimeViewportPoint {
  x: number;
  y: number;
}

/** Maps a point in the cropped preview back into the native Runtime window. */
export function runtimeViewportPoint(
  bounds: RuntimeWindowBounds,
  targetAspect: number,
  normalizedX: number,
  normalizedY: number
): RuntimeViewportPoint {
  const nx = Math.min(1, Math.max(0, normalizedX));
  const ny = Math.min(1, Math.max(0, normalizedY));
  const rawAspect = bounds.width / Math.max(1, bounds.height);
  let cropX = 0;
  let cropY = 0;
  let cropWidth = bounds.width;
  let cropHeight = bounds.height;
  if (Number.isFinite(targetAspect) && targetAspect > 0 && Math.abs(rawAspect - targetAspect) > 0.003) {
    if (rawAspect > targetAspect) {
      cropWidth = bounds.height * targetAspect;
      cropX = (bounds.width - cropWidth) / 2;
    } else {
      cropHeight = bounds.width / targetAspect;
      cropY = bounds.height - cropHeight;
    }
  }
  return {
    x: Math.round(bounds.x + cropX + cropWidth * nx),
    y: Math.round(bounds.y + cropY + cropHeight * ny)
  };
}
