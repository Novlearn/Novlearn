/** Interpolate server-prepared coordinates for drawing/hovering, never formulas. */
export function interpolatePlot(
  values: (number | null)[],
  x: number,
  xMin: number,
  xMax: number,
  yRange: number,
): number {
  if (
    values.length < 2 ||
    !Number.isFinite(x) ||
    x < xMin ||
    x > xMax ||
    xMax <= xMin
  )
    return NaN;
  const position = ((x - xMin) / (xMax - xMin)) * (values.length - 1);
  const index = Math.floor(position),
    next = Math.min(index + 1, values.length - 1);
  const a = values[index],
    b = values[next];
  if (
    typeof a !== "number" ||
    typeof b !== "number" ||
    !Number.isFinite(a) ||
    !Number.isFinite(b) ||
    Math.abs(a - b) > yRange * 0.5
  )
    return NaN;
  return a + (b - a) * (position - index);
}
