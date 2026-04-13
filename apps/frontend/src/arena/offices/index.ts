// Office locations index.
//
// Each location defines map config (center, zoom, pitch, etc.) and a
// bounding box for bot movement. The arena setup panel lets users pick
// a location from this list.

import { COLEMAN_STREET } from './coleman-street.js';
import { DUBLIN_LANDINGS } from './dublin-landings.js';
import { WACKER_DRIVE } from './wacker-drive.js';

export interface OfficeLocation {
  style: string;
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
  bounds: [number, number, number, number];
}

export type LocationId = 'london' | 'dublin' | 'chicago';

export const LOCATIONS: Record<LocationId, { label: string; config: OfficeLocation }> = {
  london: { label: 'London — 1 Coleman St', config: COLEMAN_STREET as OfficeLocation },
  dublin: { label: 'Dublin — Dublin Landings', config: DUBLIN_LANDINGS as OfficeLocation },
  chicago: { label: 'Chicago — 71 S Wacker Dr', config: WACKER_DRIVE as OfficeLocation },
};

export const LOCATION_IDS = Object.keys(LOCATIONS) as LocationId[];
export const DEFAULT_LOCATION: LocationId = 'london';

export { COLEMAN_STREET, DUBLIN_LANDINGS, WACKER_DRIVE };
