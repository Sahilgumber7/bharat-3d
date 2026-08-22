import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { computeFrame, fitBox, toVec } from '../src/geometry.js';
import { buildStateMap } from '../src/state-map.js';
import { buildIndiaMap } from '../src/india-map.js';
import { loadStateData, STATES } from '../data/states/index.js';

const boxOf = (min, max) => new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max));

test('computeFrame derives the state axes', () => {
  const f = computeFrame({ bounds: { min: [-100, 0, -50], max: [100, 20, 50] } });
  assert.equal(f.width, 200);
  assert.equal(f.depth, 100);
  assert.equal(f.height, 20);
  assert.equal(f.span, 200);
  assert.deepEqual(f.center.toArray(), [0, 10, 0]);
  assert.deepEqual(f.north.toArray(), [0, 0, -1]); // Y-up default
});

test('computeFrame honours a Z-up config', () => {
  const f = computeFrame({ upAxis: 'z', bounds: { min: [-100, -50, 0], max: [100, 50, 20] } });
  assert.deepEqual(f.up.toArray(), [0, 0, 1]);
  assert.equal(f.height, 20);
  assert.equal(f.depth, 100);
});

test('toVec accepts arrays, objects and Vector3', () => {
  assert.deepEqual(toVec([1, 2, 3]).toArray(), [1, 2, 3]);
  assert.deepEqual(toVec({ x: 1, y: 2, z: 3 }).toArray(), [1, 2, 3]);
  assert.deepEqual(toVec(new THREE.Vector3(1, 2, 3)).toArray(), [1, 2, 3]);
  assert.throws(() => toVec(null, 'bounds.min'), /bounds\.min/);
});

test('fitBox actually contains the box — every corner, every direction', () => {
  const box = boxOf([-111, 0, -120], [111, 40, 120]);
  const target = box.getCenter(new THREE.Vector3());
  const up = new THREE.Vector3(0, 1, 0);

  for (const aspect of [0.6, 1, 16 / 9, 3]) {
    for (const fov of [18, 24, 45, 68]) {
      for (const dir of [
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(0.6, 0.7, -0.6).normalize(),
        new THREE.Vector3(-0.4, 0.5, 0.76).normalize(),
      ]) {
        const camUp = Math.abs(dir.dot(up)) > 0.999 ? new THREE.Vector3(0, 0, -1) : up;
        const d = fitBox(box, target, dir, camUp, fov, aspect, 1);
        const cam = new THREE.PerspectiveCamera(fov, aspect, 0.1, 1e5);
        cam.position.copy(target).addScaledVector(dir, d);
        cam.up.copy(camUp);
        cam.lookAt(target);
        cam.updateMatrixWorld();
        cam.updateProjectionMatrix();

        for (let i = 0; i < 8; i++) {
          const p = new THREE.Vector3(
            i & 1 ? box.max.x : box.min.x,
            i & 2 ? box.max.y : box.min.y,
            i & 4 ? box.max.z : box.min.z
          ).project(cam);
          const where = `fov=${fov} aspect=${aspect} dir=${dir.toArray()}`;
          assert.ok(Math.abs(p.x) <= 1.001, `${where}: corner x ${p.x.toFixed(3)} outside frustum`);
          assert.ok(Math.abs(p.y) <= 1.001, `${where}: corner y ${p.y.toFixed(3)} outside frustum`);
        }
      }
    }
  }
});

test('buildStateMap produces usable meshes and a valid stateConfig', async () => {
  const data = await loadStateData('delhi');
  const built = buildStateMap(data, { span: 240 });

  assert.equal(built.districts.length, data.districtCount);
  const frame = computeFrame(built.stateConfig);
  assert.ok(frame.width > 0 && frame.depth > 0 && frame.height > 0);
  // `span` scales the state's viewBox, not its geometry: districts need not
  // touch every edge, and the seam gap pulls the outermost ones in a little.
  // So the longest axis approaches 240 from below, never exceeds it.
  const longest = Math.max(frame.width, frame.depth);
  assert.ok(longest <= 240 + 1e-6, `longest axis ${longest} exceeds span`);
  assert.ok(longest > 240 * 0.9, `longest axis ${longest} far short of span 240`);

  for (const { name, mesh, t } of built.districts) {
    assert.equal(mesh.name, name);
    assert.ok(mesh.geometry.attributes.position.count > 0, `${name}: empty geometry`);
    assert.ok(t >= 0 && t <= 1, `${name}: normalised area out of range`);
  }

  built.dispose();
});

test('recolor re-steps fills without touching geometry', async () => {
  const data = await loadStateData('goa');
  const built = buildStateMap(data, { ramp: ['#ffffff', '#000000'] });
  const before = built.districts.map((d) => d.mesh.geometry.attributes.position.count);

  built.recolor(['#ff0000', '#00ff00']);
  for (const { mesh } of built.districts) {
    const hex = '#' + mesh.material.color.getHexString();
    assert.ok(['#ff0000', '#00ff00'].includes(hex), `unexpected fill ${hex}`);
  }
  assert.deepEqual(built.districts.map((d) => d.mesh.geometry.attributes.position.count), before);
  built.dispose();
});

test('gap:0 leaves districts flush; the default cuts a seam', async () => {
  const data = await loadStateData('goa');
  const flush = buildStateMap(data, { gap: 0 });
  const seamed = buildStateMap(data, { gap: 0.05 });
  const area = (b) => new THREE.Box3().setFromObject(b.group).getSize(new THREE.Vector3()).x;
  assert.ok(area(seamed) < area(flush), 'seamed build should not be wider than flush');
  flush.dispose();
  seamed.dispose();
});

test('the whole data pack builds', async () => {
  for (const entry of STATES) {
    const built = buildStateMap(await loadStateData(entry.slug), { span: 240 });
    assert.equal(built.districts.length, entry.districtCount, `${entry.slug}`);
    const f = computeFrame(built.stateConfig);
    assert.ok(f.height > 0 && Number.isFinite(f.radius), `${entry.slug}: bad frame`);
    built.dispose();
  }
});

test('buildIndiaMap produces one merged mesh per state, correctly east/west oriented', async () => {
  const [bihar, delhi, goa] = await Promise.all(
    ['bihar', 'delhi', 'goa'].map((slug) => loadStateData(slug))
  );
  const entries = [
    { slug: 'bihar', name: 'Bihar', doc: bihar },
    { slug: 'delhi', name: 'Delhi', doc: delhi },
    { slug: 'goa', name: 'Goa', doc: goa },
  ];
  const built = buildIndiaMap(entries);

  assert.equal(built.states.length, 3);
  for (const s of built.states) {
    assert.ok(s.mesh.geometry.attributes.position.count > 0, `${s.slug}: empty geometry`);
    assert.equal(s.mesh.userData.stateSlug, s.slug);
  }

  // Bihar (lon ~83-88, east) must land at a larger world X than Delhi
  // (lon ~76-77.5, west) — a real regression once flipped the whole map
  // east/west while looking "close enough" in a screenshot.
  const centerX = (slug) =>
    new THREE.Box3()
      .setFromObject(built.states.find((s) => s.slug === slug).mesh)
      .getCenter(new THREE.Vector3()).x;
  assert.ok(centerX('bihar') > centerX('delhi'), 'Bihar (east) should sit right of Delhi (west)');

  built.recolor(['#ff0000', '#00ff00', '#0000ff']);
  assert.equal('#' + built.states[0].mesh.material.color.getHexString(), '#ff0000');

  built.dispose();
});
