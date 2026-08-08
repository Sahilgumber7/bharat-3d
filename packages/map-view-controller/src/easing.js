/**
 * Easing functions used by camera transitions.
 * Each takes normalised time `t` in [0,1] and returns eased progress in [0,1].
 */

export const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

export const easeInOutQuint = (t) =>
  t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;

export const linear = (t) => t;

export const EASINGS = { easeInOutCubic, easeOutCubic, easeInOutQuint, linear };

/** Resolve an easing given either a name or a function. */
export function resolveEasing(easing) {
  if (typeof easing === 'function') return easing;
  return EASINGS[easing] || easeInOutCubic;
}
