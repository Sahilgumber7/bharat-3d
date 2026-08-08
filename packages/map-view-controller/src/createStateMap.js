import * as THREE from 'three';
import { MapViewController } from './MapViewController.js';
import { buildStateMap } from './state-map.js';
import { getPalette, PALETTES } from './palettes.js';

/**
 * Batteries-included entry point: a working 3D state map in one call.
 *
 *   const map = await createStateMap({ container: '#map', state: 'bihar' });
 *
 * It owns a renderer, scene, camera, lights, render loop and resize handling —
 * the boilerplate you'd otherwise write before seeing anything on screen. If you
 * already have a Three.js scene, skip this and use `buildStateMap` +
 * `MapViewController` directly against your own objects.
 *
 * Geometry is not bundled here. Pass `data` (a state module's default export),
 * or pass `state` plus a `load` function — `@bharat3d/state-maps/data` provides
 * one. Keeping the import at the call site means a bundler only pulls in the
 * states you actually reference.
 */
export async function createStateMap(options = {}) {
  const {
    container,
    state,
    data,
    load,
    palette: paletteId = 'midnight',
    view = 'isometric',
    span = 240,
    thickness,
    relief,
    gap,
    background = true,
    grid = true,
    toolbar = true,
    position = 'bottom-right',
    onViewChange,
  } = options;

  const el = typeof container === 'string' ? document.querySelector(container) : container;
  if (!el) throw new Error('[state-maps] `container` must be an element or a selector that matches one');

  const doc = data ?? (await resolveData(state, load));
  let palette = getPalette(paletteId);

  /* ---------------- scene ---------------- */
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: !background });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.localClippingEnabled = true; // required by the cross-section view
  el.appendChild(renderer.domElement);
  Object.assign(renderer.domElement.style, { display: 'block', width: '100%', height: '100%' });
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative';

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 6000);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
  const key = new THREE.DirectionalLight(0xffffff, 0.7);
  key.position.set(140, 260, 120);
  scene.add(hemi, key);

  // three r155 switched lights to physically-correct units, so the same
  // intensity renders far darker there than on r128-r154. The palettes are
  // authored in legacy units; scale by PI on modern builds so a map looks the
  // same across every version this package supports.
  const LIGHT_GAIN =
    renderer.useLegacyLights === false || Number.parseInt(THREE.REVISION, 10) >= 155
      ? Math.PI
      : 1;

  let gridHelper = null;

  /* ---------------- state geometry ---------------- */
  let built = buildStateMap(doc, { span, thickness, relief, gap, ramp: palette.ramp });
  scene.add(built.group);

  const mvc = new MapViewController(scene, camera, built.stateConfig, {
    renderer,
    container: el,
    theme: palette.theme,
    position,
    initialView: view,
    showToolbar: toolbar,
    onViewChange,
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
        span * 3.75,
        30,
        new THREE.Color(palette.grid[0]),
        new THREE.Color(palette.grid[1])
      );
      gridHelper.material.transparent = true;
      gridHelper.material.opacity = palette.gridOpacity;
      scene.add(gridHelper);
    }

    built.recolor(palette.ramp);
    mvc.setTheme(palette.theme);
    return api;
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

  // ResizeObserver catches layout changes a window listener misses (flex/grid
  // reflow, panel toggles), which is most of them in a real app.
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  ro?.observe(el);
  window.addEventListener('resize', resize);

  let raf = null;
  let disposed = false;

  const tick = () => {
    if (disposed) return;
    raf = requestAnimationFrame(tick);
    renderer.render(scene, camera);
  };

  /* ---------------- public handle ---------------- */
  const api = {
    /** @type {THREE.Scene} */ scene,
    /** @type {THREE.PerspectiveCamera} */ camera,
    /** @type {THREE.WebGLRenderer} */ renderer,
    /** @type {MapViewController} */ controller: mvc,
    /** @type {THREE.Group} */ group: built.group,
    get districts() {
      return built.districts;
    },
    get state() {
      return built.stateConfig.name;
    },
    get palette() {
      return palette;
    },

    /** Switch camera preset. Returns a promise that settles when it lands. */
    setView: (id, opts) => mvc.setView(id, opts),
    getView: () => mvc.getView(),
    /** Swap colours — scene, lights, grid, toolbar and district fills. */
    setPalette: applyPalette,

    /** Swap to a different state in place, reusing the scene and camera. */
    async setState(next, nextData) {
      const nextDoc = nextData ?? (await resolveData(next, load));
      scene.remove(built.group);
      built.dispose();
      built = buildStateMap(nextDoc, { span, thickness, relief, gap, ramp: palette.ramp });
      scene.add(built.group);
      api.group = built.group;
      mvc.refresh(built.stateConfig);
      return api;
    },

    resize,

    destroy() {
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

async function resolveData(slug, load) {
  if (!slug) {
    throw new Error('[state-maps] Pass either `data` (a state module) or `state` (a slug) + `load`');
  }
  if (typeof load !== 'function') {
    throw new Error(
      `[state-maps] To load "${slug}" by slug, pass \`load\`:\n` +
        "  import { loadStateData } from '@bharat3d/state-maps/data';\n" +
        `  createStateMap({ container, state: '${slug}', load: loadStateData })`
    );
  }
  const mod = await load(slug);
  return mod?.districts ? mod : mod?.default;
}

export { PALETTES };
export default createStateMap;
