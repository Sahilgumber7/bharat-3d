import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { STATES, loadStateData } from '../data/states/index.js';
import { buildIndiaMap } from '../src/india-map.js';
import { createOverlays, normalise } from '../src/overlay.js';
import { getPalette } from '../src/palettes.js';

const entries = await Promise.all(
  STATES.map(async (s) => {
    const m = await loadStateData(s.slug);
    return { slug: s.slug, name: s.name, doc: m.districts ? m : m.default };
  })
);

function setup() {
  const scene = new THREE.Scene();
  const built = buildIndiaMap(entries);
  scene.add(built.group);
  return { built, scene, o: createOverlays({ scene, built, getPalette: () => getPalette('paper') }) };
}

test('normalise maps min/max to 0/1 and tolerates a flat series', () => {
  const { t, domain } = normalise({ a: 10, b: 30, c: 20 });
  assert.deepEqual(domain, [10, 30]);
  assert.equal(t.a, 0);
  assert.equal(t.b, 1);
  assert.equal(t.c, 0.5);
  assert.equal(normalise({ a: 5, b: 5 }).t.a, 0);
});

test('lonLatToWorld puts north at -Z and east at +X, inside the map box', () => {
  const { built } = setup();
  const delhi = built.lonLatToWorld(77.2, 28.6);
  const chennai = built.lonLatToWorld(80.27, 13.08);
  const mumbai = built.lonLatToWorld(72.88, 19.07);
  assert.ok(delhi.z < chennai.z, 'Delhi is north of Chennai');
  assert.ok(chennai.x > mumbai.x, 'Chennai is east of Mumbai');
  for (const p of [delhi, chennai, mumbai]) {
    assert.ok(p.x > built.box.min.x && p.x < built.box.max.x);
    assert.ok(p.z > built.box.min.z && p.z < built.box.max.z);
  }
});

test('setValues colours by value, raises relief, leaves missing states neutral', () => {
  const { built, o } = setup();
  o.setValues({ maharashtra: 100, kerala: 0 }, { relief: 1 });
  const mh = built.states.find((s) => s.slug === 'maharashtra');
  const kl = built.states.find((s) => s.slug === 'kerala');
  const gj = built.states.find((s) => s.slug === 'gujarat');
  assert.equal(mh.mesh.scale.y, 2);
  assert.equal(kl.mesh.scale.y, 1);
  assert.equal(gj.mesh.scale.y, 1);
  assert.notEqual(mh.mesh.material.color.getHex(), kl.mesh.material.color.getHex());
  assert.notEqual(gj.mesh.material.color.getHex(), mh.mesh.material.color.getHex());
  o.clearValues();
  assert.equal(mh.mesh.scale.y, 1);
});

test('points and arcs are added, and clear() removes and disposes them', () => {
  const { o } = setup();
  const pts = o.addPoints([{ lon: 77.2, lat: 28.6, value: 5 }, { lon: 72.88, lat: 19.07 }]);
  const arcs = o.addArcs([{ from: [77.2, 28.6], to: [72.88, 19.07], weight: 3 }]);
  assert.equal(pts.meshes.length, 2);
  assert.equal(arcs.group.children.length, 1);
  assert.equal(o.layer.children.length, 2);
  o.clear();
  assert.equal(o.layer.children.length, 0);
});
