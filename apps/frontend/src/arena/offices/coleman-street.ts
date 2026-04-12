// Map configuration for 1 Coleman Street, London.
//
// The LGIM office sits on the east side of Coleman Street near
// Moorgate station. We zoom tight enough that the bots' random
// walks span roughly one city block — close enough to see individual
// sprites, far enough that collisions happen naturally.

export const COLEMAN_STREET = {
  /** Mapbox style — dark theme so bot sprites and coloured flashes pop. */
  style: 'mapbox://styles/mapbox/dark-v11',

  center: [-0.09005, 51.51555] as [number, number],
  zoom: 17.5,
  bearing: -15,
  pitch: 0,

  /**
   * Bounding box that constrains bot movement. Roughly one block
   * around 1 Coleman Street so bots stay on screen.
   *
   * [west, south, east, north] in degrees.
   */
  bounds: [-0.0925, 51.5145, -0.0876, 51.5166] as [number, number, number, number],
} as const;
