import test from 'node:test';
import assert from 'node:assert/strict';
import { createModel, parseTrips, HUBS, KM, CSV_TEMPLATE, BLEND } from '../examples/lane-balance/model.js';

test('the simulated network has a lopsided lane to plan, and numbers add up', () => {
  const m = createModel().calc();
  assert.equal(m.pairs.length, (HUBS.length * (HUBS.length - 1)) / 2);
  const t = m.totals();
  assert.ok(t.emptyNow > 5 && t.emptyNow < 60, `empty running ${t.emptyNow}`);
  assert.ok(t.open > 0 && t.recoverable > 0);
  assert.equal(Math.round(t.recoverable), Math.round(m.pairs.reduce((s, p) => s + p.open * p.km * BLEND, 0)));
  for (const p of m.pairs) {
    assert.ok(p.M >= p.m && Math.abs(p.gap - (p.M - p.m)) < 1e-9);
    assert.equal(p.km, KM[p.i][p.j]);
  }
});

test('festive surge widens the gaps; a longer horizon predicts more empty legs', () => {
  const m = createModel();
  m.surge = 0; const calm = m.calc().totals();
  m.surge = 50; const peak = m.calc().totals();
  assert.ok(peak.open > calm.open);
  m.hor = 24; const short = m.calc().totals();
  m.hor = 72; const long = m.calc().totals();
  assert.ok(long.predicted > short.predicted);
});

test('approving an option covers legs, lowers the open gap, and undo restores it exactly', () => {
  const m = createModel().calc();
  const before = m.totals();
  const top = [...m.pairs].sort((a, b) => b.open * b.km - a.open * a.km)[0];
  const entry = m.approve(top.key, 'A');
  assert.ok(entry && entry.legs >= 1 && entry.rs > 0);
  m.calc();
  const after = m.totals();
  assert.ok(after.open < before.open && after.emptyNow < before.emptyNow);
  assert.equal(after.approvedLegs, entry.legs);
  assert.equal(m.approve(top.key, 'A'), null, 'the same option cannot be approved twice on one lane');
  m.calc();
  assert.equal(m.totals().approvedLegs, entry.legs, 'a refused approval changes nothing');
  m.reset(); m.calc();
  assert.deepEqual(m.totals(), before);
  const e2 = m.approve(top.key, 'B'); m.calc();
  assert.ok(m.undo(e2.id)); m.calc();
  assert.deepEqual(m.totals(), before);
});

test('a dispatch instruction names real legs and never sends anything', () => {
  const m = createModel().calc();
  const p = m.pairs.sort((a, b) => b.open - a.open)[0];
  for (const o of m.options(p)) {
    if (o.eff < 1) continue;
    const ins = m.instruction(p, o);
    assert.equal(ins.ids.length, o.eff);
    assert.match(ins.text, /TR-\d{4}/);
  }
});

test('CSV: parses the template, reads loaded/empty flags and derives per-day flows', () => {
  const r = parseTrips(CSV_TEMPLATE, { days: 1 });
  assert.ok(r.ok);
  const [del, bom] = [0, 1];
  assert.equal(r.F[del][bom], 120);
  assert.equal(r.F[bom][del], 58); // empties (loaded=0) are not counted as loaded flow
  assert.equal(r.empty, 62 + 33);
  const m = createModel(); m.source = 'csv'; m.csv = r; m.calc();
  const p = m.pair('0-1');
  assert.equal(p.fr, del);
  assert.ok(Math.abs(p.gap - 62) < 1e-9);
});

test('CSV: accepts city names and aliases, derives days from dates, and reports what it skipped', () => {
  const csv = 'from,to,is_loaded,count,trip_date\nDelhi,Mumbai,yes,10,2026-09-01\nBangalore,Gurgaon,1,4,2026-09-10\nJaipur,Delhi,1,3,2026-09-02\nDelhi,Delhi,1,1,2026-09-02\nDelhi,Pune,maybe,2,2026-09-03';
  const r = parseTrips(csv);
  assert.ok(r.ok);
  assert.equal(r.days, 10);
  assert.ok(r.F[0][1] > 0 && r.F[2][0] > 0);
  assert.equal(r.skipped['place not in the 8 gateways'], 1);
  assert.equal(r.skipped['same origin and destination'], 1);
  assert.equal(r.skipped['could not read the loaded/empty flag'], 1);
  assert.deepEqual(r.unknownPlaces, ['Jaipur']);
});

test('CSV: fails loudly and specifically on bad input', () => {
  assert.equal(parseTrips('a,b\n1,2').ok, false);
  assert.match(parseTrips('a,b\n1,2').error, /origin/);
  assert.equal(parseTrips('origin,destination\nNowhere,Elsewhere').ok, false);
  assert.equal(parseTrips('').ok, false);
});
