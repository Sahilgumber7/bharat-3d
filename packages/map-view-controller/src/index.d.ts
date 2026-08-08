import type {
  Scene,
  PerspectiveCamera,
  OrthographicCamera,
  Camera,
  WebGLRenderer,
  Group,
  Mesh,
  Object3D,
  Vector3,
  Box3,
} from 'three';

/* ------------------------------------------------------------------ *
 * Geometry data
 * ------------------------------------------------------------------ */

export interface DistrictData {
  name: string;
  /** SVG path in the state's own pixel space: `M x y L x y … Z`, one subpath per part. */
  path: string;
  centroid: [number, number];
  /** Number of `M…Z` subpaths — > 1 means the district has islands. */
  parts: number;
}

export interface StateData {
  name: string;
  slug: string;
  source: string;
  /** [width, height] of the state's pixel space; width is always 1000. */
  viewBox: [number, number];
  /** Geographic bounds, [minLon, minLat, maxLon, maxLat]. */
  bbox: [number, number, number, number];
  districtCount: number;
  districts: DistrictData[];
}

/* ------------------------------------------------------------------ *
 * Colour
 * ------------------------------------------------------------------ */

export interface Theme {
  accent?: string;
  accentContrast?: string;
  surface?: string;
  surfaceHover?: string;
  border?: string;
  icon?: string;
  iconActive?: string;
  tooltipBg?: string;
  tooltipText?: string;
  radius?: string;
  buttonSize?: string;
  gap?: string;
  padding?: string;
  shadow?: string;
  backdropFilter?: string;
  fontFamily?: string;
}

export interface Palette {
  id: string;
  label: string;
  mode: 'light' | 'dark';
  /** Scene background. */
  surface: string;
  /** Sequential ramp, light → dark. Districts quantise onto it by area. */
  ramp: string[];
  grid: [string, string];
  gridOpacity: number;
  lights: { sky: string; ground: string; hemi: number; key: number };
  ink: { primary: string; muted: string };
  panel: string;
  theme: Theme;
}

export declare const PALETTES: Palette[];
export declare function getPalette(id: string): Palette;
export declare function rampStep(ramp: string[], t: number): string;
export declare const DEFAULT_THEME: Required<Theme>;
export declare function resolveTheme(theme?: Theme): Required<Theme>;
export declare const POSITIONS: Record<string, Record<string, string>>;

/* ------------------------------------------------------------------ *
 * Views
 * ------------------------------------------------------------------ */

export type ViewId =
  | 'isometric'
  | 'crossSection'
  | 'topDown'
  | 'frontElevation'
  | 'firstPerson'
  | 'exploded';

export interface Frame {
  upAxis: 'y' | 'z';
  up: Vector3;
  east: Vector3;
  north: Vector3;
  box: Box3;
  center: Vector3;
  centroid: Vector3;
  width: number;
  depth: number;
  height: number;
  span: number;
  radius: number;
  floor: number;
}

export interface CameraState {
  position: Vector3;
  target: Vector3;
  up?: Vector3;
  fov?: number;
  zoom?: number;
  clip?: { normal: Vector3; constant: number } | null;
  explode?: number;
}

export interface ViewContext {
  frame: Frame;
  camera: Camera;
  aspect: number;
  config: StateConfig;
}

export interface ViewPreset {
  id: string;
  label?: string;
  title?: string;
  /** Inline SVG markup for the toolbar button. */
  icon?: string;
  compute(ctx: ViewContext): CameraState;
}

export declare const DEFAULT_VIEWS: ViewPreset[];
export declare const ICONS: Record<string, string>;

/* ------------------------------------------------------------------ *
 * MapViewController
 * ------------------------------------------------------------------ */

export interface DistrictRef {
  name: string;
  mesh: Object3D | string;
  /** Explicit explode direction — use for archipelagos, where "outward from
   *  the centroid" fans islands uselessly. */
  offsetDir?: Vector3 | { x: number; y: number; z: number } | [number, number, number];
  offsetDistance?: number;
}

export interface StateConfig {
  name?: string;
  bounds: {
    min: Vector3 | { x: number; y: number; z: number } | [number, number, number];
    max: Vector3 | { x: number; y: number; z: number } | [number, number, number];
  };
  centroid?: Vector3 | { x: number; y: number; z: number } | [number, number, number];
  upAxis?: 'y' | 'z';
  districts?: DistrictRef[];
  explode?: { factor?: number };
  crossSection?: { normal?: Vector3; offset?: number };
  firstPerson?: { eyeHeight?: number; start?: Vector3; lookAt?: Vector3; fov?: number };
  viewOverrides?: Record<
    string,
    Partial<CameraState> | ((computed: CameraState, ctx: ViewContext) => CameraState)
  >;
}

export interface MapViewControllerOptions {
  /** Required for the cross-section view, and used to size the viewport. */
  renderer?: WebGLRenderer;
  container?: HTMLElement;
  theme?: Theme;
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | Record<string, string>;
  orientation?: 'vertical' | 'horizontal';
  duration?: number;
  easing?: string | ((t: number) => number);
  views?: ViewPreset[];
  initialView?: string | null;
  showToolbar?: boolean;
  /** Anything with a `.target` Vector3, e.g. OrbitControls — kept in sync. */
  controls?: { target: Vector3; update?(): void };
  onViewChange?(viewId: string): void;
}

export declare class MapViewController {
  constructor(
    scene: Scene,
    camera: PerspectiveCamera | OrthographicCamera,
    stateConfig: StateConfig,
    options?: MapViewControllerOptions
  );
  readonly viewIds: string[];
  readonly frame: Frame;
  readonly config: StateConfig;
  getView(): string | null;
  setView(id: string, opts?: { immediate?: boolean; duration?: number }): Promise<void>;
  registerView(view: ViewPreset): this;
  setTheme(theme?: Theme, position?: string, orientation?: string): this;
  refresh(stateConfig?: StateConfig): this;
  destroy(): void;
}

/* ------------------------------------------------------------------ *
 * buildStateMap
 * ------------------------------------------------------------------ */

export interface BuildStateMapOptions {
  /** World size of the state's longest axis. Default 240. */
  span?: number;
  /** Base extrusion depth. Keep small vs `span` or districts read as blocks. Default 4.5. */
  thickness?: number;
  /** How far district area swings thickness, either side of `thickness`. Default 0.35. */
  relief?: number;
  /** Fraction each district shrinks toward its centre, cutting a seam. Default 0.01. */
  gap?: number;
  /** Sequential ramp, light → dark. Defaults to the Midnight palette's. */
  ramp?: string[];
}

export interface BuiltStateMap {
  group: Group;
  districts: Array<{ name: string; mesh: Mesh; t: number }>;
  stateConfig: StateConfig;
  /** Re-step every district onto a new ramp. Geometry untouched. */
  recolor(ramp: string[]): void;
  dispose(): void;
}

export declare function buildStateMap(
  data: StateData,
  opts?: BuildStateMapOptions
): BuiltStateMap;

export declare function parsePath(d: string): Array<Array<[number, number]>>;
export declare function ringArea(pts: Array<[number, number]>): number;

/* ------------------------------------------------------------------ *
 * createStateMap
 * ------------------------------------------------------------------ */

export interface CreateStateMapOptions extends BuildStateMapOptions {
  container: HTMLElement | string;
  /** State slug — requires `load`. Ignored when `data` is given. */
  state?: string;
  /** A state data document, e.g. `(await import('@bharat3d/state-maps/data/bihar.js')).default`. */
  data?: StateData;
  /** Loader for `state`; pass `loadStateData` from `@bharat3d/state-maps/data`. */
  load?: (slug: string) => Promise<StateData | { default: StateData }>;
  palette?: string;
  view?: ViewId | string;
  /** Paint the scene background. `false` gives a transparent canvas. Default true. */
  background?: boolean;
  grid?: boolean;
  toolbar?: boolean;
  position?: MapViewControllerOptions['position'];
  onViewChange?(viewId: string): void;
}

export interface StateMapHandle {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  controller: MapViewController;
  group: Group;
  readonly districts: Array<{ name: string; mesh: Mesh; t: number }>;
  readonly state: string;
  readonly palette: Palette;
  setView(id: ViewId | string, opts?: { immediate?: boolean; duration?: number }): Promise<void>;
  getView(): string | null;
  setPalette(palette: string | Palette): StateMapHandle;
  setState(slug: string, data?: StateData): Promise<StateMapHandle>;
  resize(): void;
  destroy(): void;
}

export declare function createStateMap(options: CreateStateMapOptions): Promise<StateMapHandle>;
export default createStateMap;

/* ------------------------------------------------------------------ *
 * Low-level helpers
 * ------------------------------------------------------------------ */

export declare function computeFrame(config: StateConfig): Frame;
export declare function fromFrame(
  frame: Frame,
  origin: Vector3,
  offsets?: { east?: number; north?: number; up?: number }
): Vector3;
export declare function fitBox(
  box: Box3,
  target: Vector3,
  dir: Vector3,
  up: Vector3,
  fov?: number,
  aspect?: number,
  padding?: number
): number;
export declare function fitRect(
  w: number,
  h: number,
  fov?: number,
  aspect?: number,
  padding?: number
): number;
export declare function fitDistance(
  radius: number,
  fov?: number,
  aspect?: number,
  padding?: number
): number;
export declare function toVec(v: unknown, label?: string): Vector3;

export declare const EASINGS: Record<string, (t: number) => number>;
export declare function resolveEasing(e?: string | ((t: number) => number)): (t: number) => number;

export declare class Exploder {
  constructor(frame: Frame, districts?: DistrictRef[], opts?: { factor?: number; scene?: Scene });
  readonly amount: number;
  setAmount(amount: number): void;
  syncBase(): void;
  destroy(): void;
}

export declare class Toolbar {
  constructor(opts: {
    container: HTMLElement;
    views: ViewPreset[];
    theme?: Theme;
    position?: MapViewControllerOptions['position'];
    orientation?: 'vertical' | 'horizontal';
    onSelect?(id: string): void;
  });
  el: HTMLElement;
  setActive(id: string | null): void;
  setTheme(theme?: Theme, position?: unknown, orientation?: string): void;
  destroy(): void;
}
