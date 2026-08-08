import type * as React from 'react';
import type {
  MapViewController,
  MapViewControllerOptions,
  StateConfig,
  Theme,
  ViewPreset,
} from './index';
import type { Scene, PerspectiveCamera, OrthographicCamera, WebGLRenderer, Vector3 } from 'three';

export interface MapViewControllerProps {
  scene: Scene;
  camera: PerspectiveCamera | OrthographicCamera;
  renderer?: WebGLRenderer;
  stateConfig: StateConfig;
  theme?: Theme;
  position?: MapViewControllerOptions['position'];
  orientation?: 'vertical' | 'horizontal';
  duration?: number;
  easing?: string | ((t: number) => number);
  views?: ViewPreset[];
  container?: HTMLElement | React.RefObject<HTMLElement>;
  controls?: { target: Vector3; update?(): void };
  initialView?: string;
  /** Controlled mode: the controller follows this id. */
  view?: string;
  onViewChange?(viewId: string): void;
  onReady?(controller: MapViewController): void;
}

/** Renders null — the toolbar is a DOM node over the canvas. React owns lifecycle only. */
export declare const MapViewControllerReact: React.FC<MapViewControllerProps>;
export default MapViewControllerReact;
