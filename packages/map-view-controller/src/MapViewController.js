import * as THREE from 'three';
import { computeFrame } from './geometry.js';
import { DEFAULT_VIEWS } from './views.js';
import { Toolbar } from './toolbar.js';
import { Exploder } from './explode.js';
import { resolveEasing } from './easing.js';

/**
 * MapViewController — a state-agnostic camera/view switcher for 3D state maps.
 *
 * It owns three things and nothing else:
 *   1. a floating icon toolbar overlaid on the canvas,
 *   2. eased camera transitions between view presets derived from the state's
 *      own bounding box (so no per-state camera tuning is needed),
 *   3. the two scene-level effects the presets need — a real clipping plane for
 *      cross-section, and animated district offsets for exploded view.
 *
 * It never renders. The host app keeps its own render loop; this class just
 * mutates the camera (and, for clipping, the renderer) each frame.
 *
 * @example
 *   const mvc = new MapViewController(scene, camera, stateConfig, { renderer });
 *   mvc.setView('topDown');
 */
export class MapViewController {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera  perspective or orthographic
   * @param {object} stateConfig
   *   @param {string} stateConfig.name
   *   @param {{min:object, max:object}} stateConfig.bounds
   *   @param {object} [stateConfig.centroid]  defaults to the bounds centre
   *   @param {Array}  [stateConfig.districts] [{ name, mesh, offsetDir?, offsetDistance? }]
   *   @param {object} [stateConfig.viewOverrides] per-view overrides, see setView docs
   *   @param {'y'|'z'} [stateConfig.upAxis='y']
   * @param {object} [options]
   *   @param {THREE.WebGLRenderer} [options.renderer]  required for cross-section
   *   @param {HTMLElement} [options.container]  toolbar host; defaults to the canvas parent
   *   @param {object} [options.theme]
   *   @param {string|object} [options.position='bottom-right']
   *   @param {'vertical'|'horizontal'} [options.orientation='vertical']
   *   @param {number} [options.duration=700]  transition ms
   *   @param {string|Function} [options.easing='easeInOutCubic']
   *   @param {Array} [options.views]  replace the default six presets
   *   @param {string} [options.initialView='isometric']
   *   @param {boolean} [options.showToolbar=true]
   *   @param {object} [options.controls]  anything with a `.target` Vector3 (e.g. OrbitControls)
   *   @param {(id:string)=>void} [options.onViewChange]
   */
  constructor(scene, camera, stateConfig, options = {}) {
    if (!scene || !camera) throw new Error('[MapViewController] scene and camera are required');
    if (!stateConfig?.bounds) throw new Error('[MapViewController] stateConfig.bounds is required');

    this.scene = scene;
    this.camera = camera;
    this.config = stateConfig;
    this.options = {
      duration: 700,
      easing: 'easeInOutCubic',
      position: 'bottom-right',
      orientation: 'vertical',
      initialView: 'isometric',
      showToolbar: true,
      ...options,
    };

    this.renderer = options.renderer || null;
    this.views = new Map((options.views || DEFAULT_VIEWS).map((v) => [v.id, v]));
    this.frame = computeFrame(stateConfig);

    this.exploder = new Exploder(this.frame, stateConfig.districts, {
      factor: stateConfig.explode?.factor ?? 0.45,
      scene,
    });

    // Live clipping plane. Only attached to the renderer while a clipped view
    // is active, so we never interfere with the host app's own planes.
    this._plane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
    this._planeAttached = false;
    this._prevClippingPlanes = null;

    this.currentViewId = null;
    this._anim = null;
    this._raf = null;
    this._destroyed = false;

    // The camera state we are currently at, kept so transitions can start from
    // an exact known value rather than re-deriving it from the camera.
    this._state = {
      position: camera.position.clone(),
      target: this.frame.center.clone(),
      up: camera.up.clone(),
      fov: camera.isPerspectiveCamera ? camera.fov : 50,
      zoom: camera.zoom ?? 1,
      clipConstant: 0,
      clipEnabled: 0,
      explode: 0,
    };

    if (this.options.showToolbar) {
      const container = options.container || this.renderer?.domElement?.parentElement;
      if (!container) {
        throw new Error(
          '[MapViewController] No toolbar container. Pass `container`, or `renderer` whose canvas has a positioned parent.'
        );
      }
      // The toolbar is absolutely positioned; make sure it anchors to the host.
      if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
      this.toolbar = new Toolbar({
        container,
        views: [...this.views.values()],
        theme: this.options.theme,
        position: this.options.position,
        orientation: this.options.orientation,
        onSelect: (id) => this.setView(id),
      });
    }

    if (this.options.initialView) {
      this.setView(this.options.initialView, { immediate: true });
    }
  }

  /** Ids of the registered views, in toolbar order. */
  get viewIds() {
    return [...this.views.keys()];
  }

  /** The currently active view id, or null. */
  getView() {
    return this.currentViewId;
  }

  /**
   * Transition to a view preset.
   * @param {string} id
   * @param {object} [opts]
   *   @param {boolean} [opts.immediate=false]  jump with no animation
   *   @param {number}  [opts.duration]         override the transition length
   * @returns {Promise<void>} resolves when the transition completes
   */
  setView(id, opts = {}) {
    const view = this.views.get(id);
    if (!view) {
      console.warn(`[MapViewController] Unknown view "${id}"`);
      return Promise.resolve();
    }

    const target = this._resolveViewState(view);
    this.currentViewId = id;
    this.toolbar?.setActive(id);
    this.options.onViewChange?.(id);

    const duration = opts.immediate ? 0 : opts.duration ?? this.options.duration;
    return this._animateTo(target, duration);
  }

  /**
   * Compute the camera state for a view, applying per-state overrides.
   *
   * `stateConfig.viewOverrides[viewId]` may be:
   *   - an object, shallow-merged over the computed state
   *     (`{ position, target, up, fov, zoom, clip, explode }`), or
   *   - a function `(computed, ctx) => state` for full control.
   */
  _resolveViewState(view) {
    const ctx = {
      frame: this.frame,
      camera: this.camera,
      aspect: this._aspect(),
      config: this.config,
    };
    let state = view.compute(ctx);

    const override = this.config.viewOverrides?.[view.id];
    if (typeof override === 'function') state = override(state, ctx);
    else if (override) state = { ...state, ...override };

    return {
      position: new THREE.Vector3().copy(state.position),
      target: new THREE.Vector3().copy(state.target),
      up: new THREE.Vector3().copy(state.up || this.frame.up).normalize(),
      fov: state.fov ?? this._state.fov,
      zoom: state.zoom ?? 1,
      clip: state.clip || null,
      explode: state.explode ?? 0,
    };
  }

  _aspect() {
    if (this.camera.isPerspectiveCamera && this.camera.aspect) return this.camera.aspect;
    if (this.renderer) {
      const s = this.renderer.getSize(new THREE.Vector2());
      if (s.y) return s.x / s.y;
    }
    return 1;
  }

  /* ------------------------------------------------------------------ *
   * Transition
   * ------------------------------------------------------------------ */

  _animateTo(target, duration) {
    this._cancelAnim();

    const from = {
      position: this._state.position.clone(),
      target: this._state.target.clone(),
      up: this._state.up.clone(),
      fov: this._state.fov,
      zoom: this._state.zoom,
      explode: this._state.explode,
      clipConstant: this._state.clipConstant,
      clipEnabled: this._state.clipEnabled,
    };

    // Clipping: sweep the plane in from "wide open" so the cut appears to slide
    // through the mesh instead of popping. Reverse on the way out.
    const wantsClip = !!target.clip;
    if (wantsClip) {
      this._plane.normal.copy(target.clip.normal);
      if (!from.clipEnabled) {
        // Start fully open: push the plane past the far side of the state.
        from.clipConstant = target.clip.constant + this.frame.radius * 2;
      }
      this._attachPlane();
    }
    const toClipConstant = wantsClip
      ? target.clip.constant
      : from.clipConstant + this.frame.radius * 2;

    // Spherical arc for the camera: interpolate the *direction* from target to
    // camera, plus the distance, so the camera swings around the state rather
    // than cutting a straight line through it.
    const fromOffset = from.position.clone().sub(from.target);
    const toOffset = target.position.clone().sub(target.target);
    const fromDist = fromOffset.length() || 1e-6;
    const toDist = toOffset.length() || 1e-6;
    const qFrom = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      fromOffset.clone().divideScalar(fromDist)
    );
    const qTo = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      toOffset.clone().divideScalar(toDist)
    );

    const ease = resolveEasing(this.options.easing);
    const start = performance.now();
    const scratchQ = new THREE.Quaternion();
    const scratchV = new THREE.Vector3();

    return new Promise((resolve) => {
      const step = (now) => {
        if (this._destroyed) return resolve();
        const raw = duration <= 0 ? 1 : Math.min(1, (now - start) / duration);
        const t = ease(raw);

        this._state.target.lerpVectors(from.target, target.target, t);
        scratchQ.copy(qFrom).slerp(qTo, t);
        scratchV.set(0, 0, 1).applyQuaternion(scratchQ).multiplyScalar(fromDist + (toDist - fromDist) * t);
        this._state.position.copy(this._state.target).add(scratchV);

        this._state.up.lerpVectors(from.up, target.up, t).normalize();
        this._state.fov = from.fov + (target.fov - from.fov) * t;
        this._state.zoom = from.zoom + (target.zoom - from.zoom) * t;
        this._state.explode = from.explode + (target.explode - from.explode) * t;
        this._state.clipConstant = from.clipConstant + (toClipConstant - from.clipConstant) * t;
        this._state.clipEnabled = wantsClip ? 1 : 1 - t;

        this._apply();

        if (raw < 1) {
          this._raf = requestAnimationFrame(step);
        } else {
          this._raf = null;
          this._anim = null;
          if (!wantsClip) {
            this._detachPlane();
            this._state.clipEnabled = 0;
          }
          resolve();
        }
      };

      // Run the first frame synchronously so `immediate: true` really is immediate.
      if (duration <= 0) step(start);
      else this._raf = requestAnimationFrame(step);
      this._anim = { resolve };
    });
  }

  /** Push the interpolated state onto the camera / renderer / meshes. */
  _apply() {
    const s = this._state;
    this.camera.position.copy(s.position);
    this.camera.up.copy(s.up);
    this.camera.lookAt(s.target);

    if (this.camera.isPerspectiveCamera && Math.abs(this.camera.fov - s.fov) > 1e-4) {
      this.camera.fov = s.fov;
      this.camera.updateProjectionMatrix();
    }
    if (this.camera.isOrthographicCamera && Math.abs(this.camera.zoom - s.zoom) > 1e-4) {
      this.camera.zoom = s.zoom;
      this.camera.updateProjectionMatrix();
    }

    // Keep third-party controls (OrbitControls et al.) in sync with our target.
    if (this.options.controls?.target) {
      this.options.controls.target.copy(s.target);
      this.options.controls.update?.();
    }

    this._plane.constant = s.clipConstant;
    this.exploder.setAmount(s.explode);
  }

  _attachPlane() {
    if (this._planeAttached || !this.renderer) return;
    this._prevClippingPlanes = this.renderer.clippingPlanes;
    this.renderer.clippingPlanes = [...(this._prevClippingPlanes || []), this._plane];
    this._planeAttached = true;
  }

  _detachPlane() {
    if (!this._planeAttached || !this.renderer) return;
    this.renderer.clippingPlanes = this._prevClippingPlanes || [];
    this._prevClippingPlanes = null;
    this._planeAttached = false;
  }

  _cancelAnim() {
    if (this._raf !== null) cancelAnimationFrame(this._raf);
    this._raf = null;
    this._anim?.resolve?.();
    this._anim = null;
  }

  /* ------------------------------------------------------------------ *
   * Public helpers
   * ------------------------------------------------------------------ */

  /** Register or replace a view preset at runtime. */
  registerView(view) {
    if (!view?.id || typeof view.compute !== 'function') {
      throw new Error('[MapViewController] A view needs an `id` and a `compute(ctx)` function');
    }
    this.views.set(view.id, view);
    return this;
  }

  /** Swap the theme (and optionally position/orientation) without a rebuild. */
  setTheme(theme, position, orientation) {
    this.options.theme = theme;
    if (position) this.options.position = position;
    if (orientation) this.options.orientation = orientation;
    this.toolbar?.setTheme(theme, this.options.position, this.options.orientation);
    this.toolbar?.setActive(this.currentViewId);
    return this;
  }

  /**
   * Recompute presets from the (possibly changed) state config or viewport.
   * Call after a canvas resize, or after swapping `stateConfig`.
   */
  refresh(stateConfig) {
    if (stateConfig) {
      this.config = stateConfig;
      this.frame = computeFrame(stateConfig);
      this.exploder.destroy();
      this.exploder = new Exploder(this.frame, stateConfig.districts, {
        factor: stateConfig.explode?.factor ?? 0.45,
        scene: this.scene,
      });
    }
    if (this.currentViewId) this.setView(this.currentViewId, { immediate: true });
    return this;
  }

  /** Tear down: stop animating, remove the toolbar, restore scene + renderer. */
  destroy() {
    this._destroyed = true;
    this._cancelAnim();
    this._detachPlane();
    this.exploder.destroy();
    this.toolbar?.destroy();
    this.toolbar = null;
    this.views.clear();
  }
}

export default MapViewController;
