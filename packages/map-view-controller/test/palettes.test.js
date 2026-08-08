import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PALETTES, getPalette, rampStep } from '../src/palettes.js';

/** Relative luminance — enough to assert a ramp runs light -> dark. */
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

test('every palette is complete', () => {
  assert.ok(PALETTES.length >= 2);
  for (const p of PALETTES) {
    for (const k of ['id', 'label', 'mode', 'surface', 'ramp', 'grid', 'lights', 'ink', 'theme']) {
      assert.ok(p[k] != null, `${p.id}: missing ${k}`);
    }
    assert.ok(['light', 'dark'].includes(p.mode));
    assert.ok(p.ramp.length >= 3, `${p.id}: ramp too short`);
    for (const c of [...p.ramp, p.surface, p.theme.accent, p.theme.accentContrast]) {
      assert.match(c, /^#[0-9a-f]{6}$/i, `${p.id}: "${c}" is not a 6-digit hex`);
    }
  }
});

test('ramps run light -> dark, monotonically', () => {
  for (const p of PALETTES) {
    for (let i = 1; i < p.ramp.length; i++) {
      assert.ok(
        luminance(p.ramp[i]) < luminance(p.ramp[i - 1]),
        `${p.id}: ramp not monotone at step ${i} (${p.ramp[i - 1]} -> ${p.ramp[i]})`
      );
    }
  }
});

test('no ramp step sinks into its own surface', () => {
  // The dataviz ordinal gate: the step nearest the surface still clears 2:1.
  for (const p of PALETTES) {
    for (const step of p.ramp) {
      const ratio = contrast(step, p.surface);
      assert.ok(ratio >= 2, `${p.id}: ${step} is ${ratio.toFixed(2)}:1 on ${p.surface} — below the 2:1 floor`);
    }
  }
});

test('accent is legible on its own contrast colour', () => {
  for (const p of PALETTES) {
    const ratio = contrast(p.theme.accent, p.theme.accentContrast);
    assert.ok(ratio >= 3, `${p.id}: accent pair is only ${ratio.toFixed(2)}:1`);
  }
});

test('rampStep clamps out-of-range input', () => {
  const r = ['#000000', '#111111', '#222222'];
  assert.equal(rampStep(r, -5), r[0]);
  assert.equal(rampStep(r, 0), r[0]);
  assert.equal(rampStep(r, 1), r[2]);
  assert.equal(rampStep(r, 99), r[2]);
});

test('getPalette falls back rather than returning undefined', () => {
  assert.equal(getPalette('midnight').id, 'midnight');
  assert.equal(getPalette('nope'), PALETTES[0]);
});
