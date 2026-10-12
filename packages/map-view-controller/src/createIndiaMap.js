import * as THREE from 'three';
import { MapViewController } from './MapViewController.js';
import { buildIndiaMap } from './india-map.js';
import { getPalette, PALETTES } from './palettes.js';
import { DEFAULT_VIEWS } from './views.js';
import { fitBox } from './geometry.js';
import { createOverlays } from './overlay.js';

/**
 * Batteries-included entry point: a clickable, themeable, 3D national picker
 * of every state and UT, in one call — the same "India tier" bharat3d.com's
 * own gallery uses.
 *
 *   import { createIndiaMap, createStateMap } from '@bharat3d/state-maps';
 *   import { STATES, loadStateData } from '@bharat3d/state-maps/data';
 *
 *   const india = await createIndiaMap({
 *     container: '#map',
 *     registry: STATES,
 *     load: loadStateData,
 *     onSelect: async (slug) => {
 *       india.destroy();
 *       await createStateMap({ container: '#map', state: slug, load: loadStateData });
 *     },
 *   });
 *
 * Geometry is not bundled here. Pass `states` (an array you've already
 * loaded, `[{slug, name, doc}]`), or `registry` + `load` to fetch every
 * state's data pack on demand — `@bharat3d/state-maps/data` provides both.
 */
export async function createIndiaMap(options = {}) {
  const {
    container,
    states,
    registry,
    load,
    palette: paletteId = 'midnight',
    view = 'isometric',
    span = 320,
    depth = 8,
    background = true,
    grid = true,
    toolbar = true,
    position = 'bottom-right',
    onViewChange,
    onSelect,
    onHover,
  } = options;

  const el = typeof container === 'string' ? document.querySelector(container) : container;
  if (!el) throw new Error('[state-maps] `container` must be an element or a selector that matches one');

  const entries = states ?? (await resolveAll(registry, load));
  let palette = getPalette(paletteId);

  /* ---------------- scene ---------------- */
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: !background });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  el.appendChild(renderer.domElement);
  Object.assign(renderer.domElement.style, { display: 'block', width: '100%', height: '100%' });
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative';

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 6000);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
  const key = new THREE.DirectionalLight(0xffffff, 0.7);
  key.position.set(140, 260, 120);
  scene.add(hemi, key);

  const LIGHT_GAIN =
    renderer.useLegacyLights === false || Number.parseInt(THREE.REVISION, 10) >= 155 ? Math.PI : 1;

  let gridHelper = null;

  /* ---------------- geometry ---------------- */
  const built = buildIndiaMap(entries, { span, depth, ramp: palette.ramp });
  scene.add(built.group);

  const center = built.box.getCenter(new THREE.Vector3());

  const indiaConfig = {
    name: 'India',
    bounds: { min: built.box.min, max: built.box.max },
    centroid: center.clone(),
    // One entry per *state* — the exploded view pulls whole states apart
    // from the national centroid, since there are no individual district
    // meshes at this tier to explode.
    districts: built.states.map((s) => ({ name: s.name, mesh: s.group })),
    explode: { factor: 0.5 },
    // The default walkthrough eye height is tuned for a single state's
    // ~240-unit span; at national scale that plants the camera in the
    // nearest state's wall. Standing taller clears it into a real flyover.
    firstPerson: { eyeHeight: Math.max(span * 0.14, 30) },
    upAxis: 'y',
  };

  // A hand-tuned north-up oblique replaces the library's generic isometric —
  // it reads as a map should (geographic north at the top of the screen).
  const isoView = {
    id: 'isometric',
    label: DEFAULT_VIEWS[0].label,
    title: DEFAULT_VIEWS[0].title,
    icon: DEFAULT_VIEWS[0].icon,
    compute: ({ aspect }) => {
      const worldUp = new THREE.Vector3(0, 1, 0);
      const north = built.north;
      const dir = new THREE.Vector3().addScaledVector(north, -0.72).addScaledVector(worldUp, 0.68).normalize();
      const up = north.clone();
      const fov = 36;
      const dist = fitBox(built.box, center, dir, up, fov, aspect, 1.08);
      return {
        position: center.clone().addScaledVector(dir, dist),
        target: center.clone(),
        up,
        fov,
        zoom: 1,
        clip: null,
        explode: 0,
      };
    },
  };
  // Cross-section (a clipping plane) and front elevation don't add anything
  // useful for a flat national picker.
  const views = DEFAULT_VIEWS.filter((v) => v.id !== 'crossSection' && v.id !== 'frontElevation').map((v) =>
    v.id === 'isometric' ? isoView : v
  );

  const overlays = createOverlays({ scene, built, getPalette: () => palette, container: el });

  const mvc = new MapViewController(scene, camera, indiaConfig, {
    renderer,
    container: el,
    theme: palette.theme,
    position,
    initialView: view,
    showToolbar: toolbar,
    views,
    // Overlays are pinned to real places; once states are pulled apart they
    // would hang in mid-air, so they step aside for the exploded view.
    onViewChange: (id) => {
      overlays.layer.visible = id !== 'exploded';
      onViewChange?.(id);
    },
  });

  function applyPalette(next) {
    palette = typeof next === 'string' ? getPalette(next) : next;
    scene.background = background ? new THREE.Color(palette.surface) : null;
    hemi.color.set(palette.lights.sky);
    hemi.groundColor.set(palette.lights.ground);
    hemi.intensity = palette.lights.hemi * LIGHT_GAIN;
    key.intensity = palette.lights.key * LIGHT_GAIN;

    if (gridHelper) {
      scene.remove(gridHelper);
      gridHelper.geometry.dispose();
      gridHelper.material.dispose();
      gridHelper = null;
    }
    if (grid) {
      gridHelper = new THREE.GridHelper(
        span * 2.8,
        30,
        new THREE.Color(palette.grid[0]),
        new THREE.Color(palette.grid[1])
      );
      gridHelper.material.transparent = true;
      gridHelper.material.opacity = palette.gridOpacity;
      scene.add(gridHelper);
    }

    built.recolor(palette.ramp);
    overlays.refresh();
    mvc.setTheme(palette.theme);
    return api;
  }

  /* ---------------- click / hover ---------------- */
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pointerDownAt = null;

  function pick(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(built.group, true).find((h) => h.object.isMesh);
    const slug = hit?.object.userData.stateSlug;
    if (slug) onSelect?.(slug, built.states.find((s) => s.slug === slug));
  }

  renderer.domElement.addEventListener('pointerdown', (e) => {
    pointerDownAt = [e.clientX, e.clientY];
  });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!pointerDownAt) return;
    const [dx, dy] = pointerDownAt;
    pointerDownAt = null;
    // A few px of slop distinguishes a click from an orbit-drag.
    if (Math.hypot(e.clientX - dx, e.clientY - dy) < 4) pick(e.clientX, e.clientY);
  });

  let hoveredSlug = null;
  if (onHover) {
    renderer.domElement.addEventListener('pointermove', (e) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(built.group, true).find((h) => h.object.isMesh);
      const slug = hit?.object.userData.stateSlug || null;
      if (slug !== hoveredSlug) {
        hoveredSlug = slug;
        onHover(slug, slug ? built.states.find((s) => s.slug === slug) : null);
      }
    });
    renderer.domElement.addEventListener('pointerleave', () => {
      if (hoveredSlug) {
        hoveredSlug = null;
        onHover(null, null);
      }
    });
  }

  /* ---------------- loop & resize ---------------- */
  const resize = () => {
    const w = el.clientWidth || 1;
    const h = el.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    mvc.refresh();
  };

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  ro?.observe(el);
  window.addEventListener('resize', resize);

  let raf = null;
  let disposed = false;

  const tick = () => {
    if (disposed) return;
    raf = requestAnimationFrame(tick);
    renderer.render(scene, camera);
    overlays.updateLabels(camera, el.clientWidth, el.clientHeight);
  };

  /* ---------------- public handle ---------------- */
  const api = {
    /** @type {THREE.Scene} */ scene,
    /** @type {THREE.PerspectiveCamera} */ camera,
    /** @type {THREE.WebGLRenderer} */ renderer,
    /** @type {MapViewController} */ controller: mvc,
    /** @type {THREE.Group} */ group: built.group,
    /** Every state/UT rendered, with its mesh and slug. */
    get states() {
      return built.states;
    },
    get palette() {
      return palette;
    },

    /** Switch camera preset. Returns a promise that settles when it lands. */
    setView: (id, opts) => mvc.setView(id, opts),
    getView: () => mvc.getView(),
    /** Swap colours — scene, lights, grid, toolbar and per-state fills. */
    setPalette: applyPalette,

    /** Colour (and optionally raise) states by `{slug: number}`. See overlay.js. */
    setValues: overlays.setValues,
    clearValues: overlays.clearValues,
    /** Pin markers (`[{lon, lat, value?, label?}]`) to real places. */
    addPoints: overlays.addPoints,
    /** Draw weighted arcs (`[{from:[lon,lat], to:[lon,lat], weight?}]`). */
    addArcs: overlays.addArcs,
    /** Remove every marker and arc. */
    clearOverlays: overlays.clear,
    get legend() {
      return overlays.legend;
    },
    /** Project lon/lat to a world position on the map (for custom labels). */
    lonLatToWorld: built.lonLatToWorld,

    resize,

    destroy() {
      overlays.dispose();
      disposed = true;
      if (raf !== null) cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener('resize', resize);
      mvc.destroy();
      built.dispose();
      if (gridHelper) {
        gridHelper.geometry.dispose();
        gridHelper.material.dispose();
      }
      renderer.dispose();
      renderer.domElement.remove();
    },
  };

  applyPalette(palette);
  resize();
  tick();

  return api;
}

async function resolveAll(registry, load) {
  if (!registry || !load) {
    throw new Error(
      '[state-maps] Pass either `states` (already-loaded [{slug,name,doc}]) or `registry` + `load`:\n' +
        "  import { STATES, loadStateData } from '@bharat3d/state-maps/data';\n" +
        '  createIndiaMap({ container, registry: STATES, load: loadStateData })'
    );
  }
  const docs = await Promise.all(registry.map((s) => load(s.slug)));
  return registry.map((s, i) => ({
    slug: s.slug,
    name: s.name,
    doc: docs[i]?.districts ? docs[i] : docs[i]?.default,
  }));
}

export { PALETTES };
export default createIndiaMap;
