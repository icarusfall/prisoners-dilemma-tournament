// Map configuration for 3 Dublin Landings, North Wall Quay, Dublin.
//
// The LGIM office sits on the north bank of the Liffey near the
// Samuel Beckett Bridge. We zoom in tight with 3D pitch, centred
// on the Dublin Landings development.

export const DUBLIN_LANDINGS = {
  /** Mapbox style — light pastel theme. */
  style: 'mapbox://styles/mapbox/light-v11',

  center: [-6.2420, 53.3487] as [number, number],
  zoom: 18,
  bearing: -30,
  pitch: 45,

  /**
   * Bounding box that constrains bot movement. Covers the streets
   * around Dublin Landings — North Wall Quay, Mayor Street, New
   * Wapping Street.
   *
   * [west, south, east, north] in degrees.
   */
  bounds: [-6.2460, 53.3470, -6.2380, 53.3505] as [number, number, number, number],
} as const;
