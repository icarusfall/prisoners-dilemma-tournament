// Map configuration for 71 S Wacker Drive, Chicago.
//
// The LGIM America office is in the Willis Tower neighbourhood on
// the south bank of the Chicago River. We zoom in with 3D pitch
// centred on the Wacker/Adams intersection.

export const WACKER_DRIVE = {
  /** Mapbox style — light pastel theme. */
  style: 'mapbox://styles/mapbox/light-v11',

  center: [-87.6368, 41.8786] as [number, number],
  zoom: 18,
  bearing: -5,
  pitch: 45,

  /**
   * Bounding box that constrains bot movement. Covers the streets
   * around 71 S Wacker — Wacker Drive, Adams Street, Franklin
   * Street, the Riverwalk.
   *
   * [west, south, east, north] in degrees.
   */
  bounds: [-87.6400, 41.8768, -87.6336, 41.8805] as [number, number, number, number],
} as const;
