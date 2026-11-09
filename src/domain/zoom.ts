/**
 * Geometry of the photo viewer's zoom (PLAN.md §6.10). Offsets are measured from the centre of the
 * box and applied after the scale (`translate` then `scale` in a React Native transform), so a point
 * `p` of the photo, from the centre, is drawn at `p × scale + offset`. The functions are worklets:
 * they run on the UI thread during a gesture, and are plain functions anywhere else.
 */

export const MAX_ZOOM = 5;
export const DOUBLE_TAP_ZOOM = 2.5;
/** A swipe longer than this share of the width, or faster than SWIPE_VELOCITY, turns the page. */
export const SWIPE_SHARE = 0.25;
export const SWIPE_VELOCITY = 500;

/** Size of a photo shown whole inside a box (`resizeMode="contain"`). */
export function containSize(width: number, height: number, boxWidth: number, boxHeight: number): { width: number; height: number } {
  'worklet';
  if (width <= 0 || height <= 0) return { width: boxWidth, height: boxHeight };
  const fit = Math.min(boxWidth / width, boxHeight / height);
  return { width: width * fit, height: height * fit };
}

/**
 * Keeps one axis of the offset inside the photo: zoomed, its edge never leaves the edge of the box;
 * while it fits in the box on that axis, it stays centred.
 */
export function clampOffset(offset: number, fitted: number, box: number, scale: number): number {
  'worklet';
  const max = Math.max(0, (fitted * scale - box) / 2);
  return Math.min(max, Math.max(-max, offset));
}

/**
 * The offset that keeps under the fingers the point that was at `startFocal` (from the centre) when
 * the scale was `startScale` and the offset `startOffset`, now that the fingers are at `focal` and
 * the scale is `scale`: pinching zooms on what is between the fingers and follows them as they move.
 */
export function pinchOffset(startFocal: number, startOffset: number, startScale: number, focal: number, scale: number): number {
  'worklet';
  return focal - (startFocal - startOffset) * (scale / startScale);
}

/** The page a horizontal swipe ends on: the next or the previous one, never past the ends. */
export function pageAfterSwipe(page: number, count: number, translation: number, velocity: number, width: number): number {
  'worklet';
  let next = page;
  if (translation < -width * SWIPE_SHARE || velocity < -SWIPE_VELOCITY) next = page + 1;
  else if (translation > width * SWIPE_SHARE || velocity > SWIPE_VELOCITY) next = page - 1;
  return Math.max(0, Math.min(count - 1, next));
}
