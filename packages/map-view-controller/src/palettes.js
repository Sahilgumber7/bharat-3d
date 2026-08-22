/**
 * Colour presets for the state maps.
 *
 * District fill is a **sequential (ordinal) ramp keyed to district area** — the
 * same variable that drives extrusion height, so colour and relief reinforce
 * each other instead of competing. It is deliberately *not* a categorical
 * palette: a categorical scheme encodes identity, and no categorical palette
 * survives 38 (let alone UP's 71) simultaneous mutually-adjacent fills. Cycling
 * hues to cover them would make colour mean nothing while looking like it means
 * something.
 *
 * Every ramp below passed `dataviz/scripts/validate_palette.js --ordinal`
 * against its own surface: single hue, monotone lightness, adjacent ΔL ≥ 0.06,
 * and the step nearest the surface clearing 2:1 so no district sinks into the
 * background. Re-run the validator if you change a step.
 *
 * The blue ramp steps are the reference palette's; ember and aqua are stepped
 * to the same gates.
 */

export const PALETTES = [
  {
    id: 'midnight',
    label: 'Midnight',
    mode: 'dark',
    surface: '#0E1535',
    // blue, steps 100–600 · validated ordinal on #0E1535 (light end 2.20:1)
    ramp: ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95'],
    grid: ['#2a3566', '#1b2350'],
    gridOpacity: 0.3,
    lights: { sky: '#bfd0ff', ground: '#1a1030', hemi: 0.9, key: 0.7 },
    ink: { primary: 'rgba(223,228,245,.92)', muted: 'rgba(223,228,245,.55)' },
    panel: 'rgba(14,21,53,.78)',
    theme: {
      accent: '#B24BFF',
      accentContrast: '#0E1535',
      surface: 'rgba(14,21,53,.72)',
      border: 'rgba(255,255,255,.14)',
      icon: 'rgba(255,255,255,.74)',
      iconActive: '#0E1535',
    },
  },

  {
    id: 'paper',
    label: 'Paper',
    mode: 'light',
    surface: '#fcfcfb',
    // blue, steps 250–700 · validated ordinal on #fcfcfb (light end 2.06:1)
    ramp: ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#0d366b'],
    grid: ['#d5d4cc', '#e6e5df'],
    gridOpacity: 0.9,
    lights: { sky: '#ffffff', ground: '#c9c8c0', hemi: 1.15, key: 0.55 },
    ink: { primary: '#0b0b0b', muted: '#52514e' },
    panel: 'rgba(252,252,251,.86)',
    theme: {
      accent: '#6D28FF',
      accentContrast: '#ffffff',
      surface: 'rgba(252,252,251,.82)',
      border: 'rgba(11,11,11,.14)',
      icon: 'rgba(11,11,11,.66)',
      iconActive: '#ffffff',
      shadow: '0 8px 28px rgba(11,11,11,.14)',
    },
  },

  {
    id: 'ember',
    label: 'Ember',
    mode: 'dark',
    surface: '#1a1210',
    // orange · validated ordinal on #1a1210 (light end 2.44:1)
    ramp: ['#fbd9c8', '#f6b596', '#ef8f63', '#eb6834', '#c04a1e', '#933614'],
    grid: ['#4a2f22', '#33211a'],
    gridOpacity: 0.35,
    lights: { sky: '#ffd9c0', ground: '#2a1408', hemi: 0.9, key: 0.72 },
    ink: { primary: 'rgba(250,238,232,.92)', muted: 'rgba(250,238,232,.55)' },
    panel: 'rgba(26,18,16,.8)',
    theme: {
      accent: '#C6FF3D',
      accentContrast: '#1a1210',
      surface: 'rgba(26,18,16,.74)',
      border: 'rgba(255,255,255,.14)',
      icon: 'rgba(255,255,255,.72)',
      iconActive: '#1a1210',
    },
  },

  {
    id: 'aqua',
    label: 'Aqua',
    mode: 'dark',
    surface: '#0b1a18',
    // aqua · validated ordinal on #0b1a18 (light end 2.30:1)
    ramp: ['#c9efe0', '#94dfc2', '#5fcfa3', '#1baf7a', '#147e59', '#0f5e43'],
    grid: ['#1d4038', '#142e29'],
    gridOpacity: 0.35,
    lights: { sky: '#c4f2e4', ground: '#06201a', hemi: 0.9, key: 0.7 },
    ink: { primary: 'rgba(228,245,240,.92)', muted: 'rgba(228,245,240,.55)' },
    panel: 'rgba(11,26,24,.8)',
    theme: {
      accent: '#FF3DAE',
      accentContrast: '#0b1a18',
      surface: 'rgba(11,26,24,.74)',
      border: 'rgba(255,255,255,.14)',
      icon: 'rgba(255,255,255,.72)',
      iconActive: '#0b1a18',
    },
  },
];

export const getPalette = (id) => PALETTES.find((p) => p.id === id) || PALETTES[0];

/**
 * Pick a ramp step for a normalised magnitude `t` (0–1).
 * Quantises to the validated steps rather than interpolating between them, so
 * every fill on screen is a colour the validator actually cleared.
 */
export function rampStep(ramp, t) {
  const i = Math.round(Math.min(1, Math.max(0, t)) * (ramp.length - 1));
  return ramp[i];
}

export default PALETTES;
