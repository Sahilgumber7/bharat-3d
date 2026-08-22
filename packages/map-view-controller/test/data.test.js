import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATES, STATE_COUNT, DISTRICT_COUNT, SUB_DISTRICT_COUNT, loaders, findState, loadStateData,
} from '../data/states/index.js';
import { parsePath, ringArea } from '../src/state-map.js';

test('registry is internally consistent', () => {
  assert.equal(STATES.length, STATE_COUNT);
  assert.equal(STATES.reduce((s, e) => s + e.districtCount, 0), DISTRICT_COUNT);
  assert.equal(STATES.reduce((s, e) => s + e.subDistrictCount, 0), SUB_DISTRICT_COUNT);
  assert.equal(Object.keys(loaders).length, STATE_COUNT);
  for (const s of STATES) {
    assert.ok(loaders[s.slug], `no loader for ${s.slug}`);
    assert.equal(findState(s.slug), s);
    assert.match(s.slug, /^[a-z0-9-]+$/);
    assert.ok(s.districtCount > 0);
    assert.ok(s.subDistrictCount >= 0);
    assert.ok(s.viewBox[0] > 0 && s.viewBox[1] > 0);
  }
});

test('sub-districts, where present, are well-formed and roll up to the registry total', async () => {
  let total = 0;
  for (const entry of STATES) {
    const data = await loadStateData(entry.slug);
    const [vw, vh] = data.viewBox;
    let stateTotal = 0;
    for (const d of data.districts) {
      if (!d.subdistricts) continue;
      stateTotal += d.subdistricts.length;
      for (const sd of d.subdistricts) {
        const rings = parsePath(sd.path);
        assert.ok(rings.length >= 1, `${entry.slug}/${d.name}/${sd.name}: path parsed to no rings`);
        assert.equal(rings.length, sd.parts, `${entry.slug}/${d.name}/${sd.name}: parts != subpaths`);
        for (const ring of rings) {
          assert.ok(ring.length >= 3, `${entry.slug}/${d.name}/${sd.name}: degenerate ring`);
          for (const [x, y] of ring) {
            assert.ok(x >= -2 && x <= vw + 2, `${entry.slug}/${d.name}/${sd.name}: x ${x} outside viewBox`);
            assert.ok(y >= -2 && y <= vh + 2, `${entry.slug}/${d.name}/${sd.name}: y ${y} outside viewBox`);
          }
        }
      }
    }
    assert.equal(stateTotal, entry.subDistrictCount, `${entry.slug}: subDistrictCount mismatch`);
    total += stateTotal;
  }
  assert.equal(total, SUB_DISTRICT_COUNT);
});

test('unknown slugs fail loudly and list the valid ones', async () => {
  await assert.rejects(() => loadStateData('atlantis'), /Unknown state "atlantis"/);
});

test('every state loads, and its geometry is well-formed', async () => {
  for (const entry of STATES) {
    const data = await loadStateData(entry.slug);
    assert.equal(data.slug, entry.slug, `${entry.slug}: slug mismatch`);
    assert.equal(data.districts.length, entry.districtCount, `${entry.slug}: count mismatch`);

    const [vw, vh] = data.viewBox;
    for (const d of data.districts) {
      const rings = parsePath(d.path);
      assert.ok(rings.length >= 1, `${entry.slug}/${d.name}: path parsed to no rings`);
      assert.equal(rings.length, d.parts, `${entry.slug}/${d.name}: parts != subpaths`);

      for (const ring of rings) {
        assert.ok(ring.length >= 3, `${entry.slug}/${d.name}: degenerate ring`);
        assert.ok(ringArea(ring) > 0, `${entry.slug}/${d.name}: zero-area ring`);
        for (const [x, y] of ring) {
          assert.ok(Number.isFinite(x) && Number.isFinite(y), `${entry.slug}/${d.name}: NaN vertex`);
          // A small negative is fine (rounding); wildly out of frame is not.
          assert.ok(x >= -2 && x <= vw + 2, `${entry.slug}/${d.name}: x ${x} outside viewBox`);
          assert.ok(y >= -2 && y <= vh + 2, `${entry.slug}/${d.name}: y ${y} outside viewBox`);
        }
      }
    }
  }
});

test('district names are unique within a state', async () => {
  for (const entry of STATES) {
    const data = await loadStateData(entry.slug);
    const names = data.districts.map((d) => d.name);
    assert.equal(new Set(names).size, names.length, `${entry.slug}: duplicate district names`);
  }
});
