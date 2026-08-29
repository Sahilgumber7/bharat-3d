import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATES } from '../data/states/index.js';
import outline from '../data/india-outline.js';

// data/india-outline.js is generated (tools/build-overview.mjs) and committed,
// so it can fall out of step with the state data it was derived from. These
// checks are what tells you to re-run the build.

test('the overview outline covers exactly the states in the registry', () => {
  assert.equal(outline.length, STATES.length);
  const slugs = new Set(outline.map((s) => s.slug));
  for (const s of STATES) {
    assert.ok(slugs.has(s.slug), `${s.slug} missing from india-outline.js — re-run npm run build:overview`);
  }
});

test('every state contributes at least one drawable ring', () => {
  for (const s of outline) {
    assert.ok(s.districts.length > 0, `${s.slug} has no districts`);
    for (const d of s.districts) {
      assert.ok(d.rings.length > 0, `${s.slug} has a district with no rings`);
      for (const ring of d.rings) {
        // Below three points a ring encloses no area, and ExtrudeGeometry
        // would silently produce nothing.
        assert.ok(ring.length >= 3, `${s.slug} has a degenerate ring`);
      }
    }
  }
});

test('every point is a lon/lat inside India\'s bounding box', () => {
  // Generous bounds — this is a "did the projection get skipped or inverted"
  // check, not a border definition.
  for (const s of outline) {
    for (const d of s.districts) {
      for (const [lon, lat] of d.rings.flat()) {
        assert.ok(lon > 60 && lon < 100, `${s.slug}: longitude ${lon} out of range`);
        assert.ok(lat > 5 && lat < 40, `${s.slug}: latitude ${lat} out of range`);
      }
    }
  }
});

test('the outline stays small enough to load before first paint', () => {
  // The whole point of precomputing it. If this fails, the tolerance in
  // tools/build-overview.mjs has been lowered too far.
  const points = outline.reduce(
    (n, s) => n + s.districts.reduce((m, d) => m + d.rings.reduce((k, r) => k + r.length, 0), 0),
    0
  );
  assert.ok(points < 60_000, `${points} points is too many for the national view`);
});
