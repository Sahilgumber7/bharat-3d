import type { StateData } from './index';

export interface StateEntry {
  name: string;
  slug: string;
  file: string;
  districtCount: number;
  viewBox: [number, number];
}

/** Every Indian state and UT in this data pack, alphabetical. */
export declare const STATES: StateEntry[];
export declare const SOURCE: string;
export declare const STATE_COUNT: number;
export declare const DISTRICT_COUNT: number;
/** slug -> dynamic import, so bundlers can code-split each state. */
export declare const loaders: Record<string, () => Promise<{ default: StateData }>>;
export declare function findState(slug: string): StateEntry | undefined;
export declare function loadStateData(slug: string): Promise<StateData>;
