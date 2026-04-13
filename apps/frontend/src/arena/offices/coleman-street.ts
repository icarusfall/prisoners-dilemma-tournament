// Map configuration for 1 Coleman Street, London.
//
// The LGIM office sits at the north end of Coleman Street, near
// Moorgate station. We zoom in tight and pitch for 3D building
// extrusions, centred on the actual office building.

export const COLEMAN_STREET = {
  /** Mapbox style — light pastel theme. */
  style: 'mapbox://styles/mapbox/light-v11',

  center: [-0.08988, 51.51640] as [number, number],
  zoom: 18,
  bearing: -15,
  pitch: 45,

  /**
   * Bounding box that constrains bot movement. Covers the streets
   * around 1 Coleman Street — Coleman St, Moorgate, London Wall,
   * Basinghall St. Bots are funnelled along real streets by building
   * collision.
   *
   * [west, south, east, north] in degrees.
   */
  bounds: [-0.0920, 51.5152, -0.0876, 51.5178] as [number, number, number, number],
} as const;
