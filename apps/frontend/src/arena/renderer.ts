// Arena Mapbox renderer.
//
// Owns the map instance, the bot symbol layer, interaction lines, and
// score halos. The simulation module drives state; this module projects
// it onto Mapbox layers.

import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { SPRITE_NAMES, SPRITE_SVGS } from './sprites/index.js';
import { PRESET_COLOURS } from '../palette.js';
import type { ArenaBot } from './types.js';

// ---------------------------------------------------------------------
// Sprite loading
// ---------------------------------------------------------------------

const SPRITE_SIZE = 48;

/**
 * Render an SVG string to an HTMLImageElement at `SPRITE_SIZE` pixels.
 * Returns a Promise because Image.onload is async.
 */
function svgToImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image(SPRITE_SIZE, SPRITE_SIZE);
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}

// ---------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------

export interface ArenaRenderer {
  map: mapboxgl.Map;
  /** Update all bot positions and visual states on the map. */
  updateBots(bots: ArenaBot[]): void;
  /** Show a line between two interacting bots. */
  showInteractionLine(a: ArenaBot, b: ArenaBot, pairId: string): void;
  /** Remove an interaction line. */
  removeInteractionLine(pairId: string): void;
  /** Remove all interaction lines. */
  clearInteractionLines(): void;
  /** Destroy the renderer and the map. */
  destroy(): void;
}

/**
 * Colour for a bot's icon, accounting for visual state.
 */
function botIconColour(bot: ArenaBot): string {
  if (bot.isZombie) return '#3a5a3a';
  switch (bot.visualState) {
    case 'cooperate': return '#66ee77';
    case 'defect': return '#ee4444';
    default: return PRESET_COLOURS[bot.botId] ?? '#cccccc';
  }
}

export async function createRenderer(
  container: HTMLElement,
  mapConfig: {
    style: string;
    center: [number, number];
    zoom: number;
    bearing: number;
    pitch: number;
  },
): Promise<ArenaRenderer> {
  const token = import.meta.env.VITE_MAPBOX_TOKEN;
  if (!token) throw new Error('VITE_MAPBOX_TOKEN is not set');

  mapboxgl.accessToken = token;

  const map = new mapboxgl.Map({
    container,
    style: mapConfig.style,
    center: mapConfig.center,
    zoom: mapConfig.zoom,
    bearing: mapConfig.bearing,
    pitch: mapConfig.pitch,
    attributionControl: false,
    // Prevent accidental map drags from disrupting the demo.
    dragRotate: false,
    touchZoomRotate: false,
  });

  // Add compact attribution.
  map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');

  await new Promise<void>((resolve) => map.on('load', () => resolve()));

  // Load sprite images into Mapbox.
  for (const name of SPRITE_NAMES) {
    const img = await svgToImage(SPRITE_SVGS[name]);
    map.addImage(`sprite-${name}`, img, { sdf: true });
  }

  // ---- Bot positions GeoJSON source ----
  map.addSource('arena-bots', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  // Score halo (circle behind each sprite).
  map.addLayer({
    id: 'arena-halos',
    type: 'circle',
    source: 'arena-bots',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['get', 'score'], 0, 4, 100, 18, 500, 30],
      'circle-color': ['get', 'colour'],
      'circle-opacity': 0.2,
      'circle-blur': 0.6,
    },
  });

  // Bot sprite layer.
  map.addLayer({
    id: 'arena-sprites',
    type: 'symbol',
    source: 'arena-bots',
    layout: {
      'icon-image': ['get', 'spriteImage'],
      'icon-size': 0.6,
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'text-field': ['get', 'label'],
      'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
      'text-size': 10,
      'text-offset': [0, 1.8],
      'text-allow-overlap': true,
    },
    paint: {
      'icon-color': ['get', 'colour'],
      'text-color': '#cccccc',
      'text-halo-color': '#111111',
      'text-halo-width': 1,
    },
  });

  // ---- Interaction lines source ----
  map.addSource('arena-lines', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  map.addLayer({
    id: 'arena-interaction-lines',
    type: 'line',
    source: 'arena-lines',
    paint: {
      'line-color': ['get', 'colour'],
      'line-width': 2,
      'line-opacity': 0.7,
    },
  });

  // Track active interaction lines by pairId.
  const activeLines = new Map<string, GeoJSON.Feature>();

  function buildBotFeatures(bots: ArenaBot[]): GeoJSON.FeatureCollection {
    return {
      type: 'FeatureCollection',
      features: bots.map((bot) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [bot.lng, bot.lat] },
        properties: {
          id: bot.instanceId,
          botId: bot.botId,
          label: bot.name,
          colour: botIconColour(bot),
          score: bot.score,
          spriteImage: `sprite-${SPRITE_NAMES[bot.spriteVariant % SPRITE_NAMES.length]}`,
        },
      })),
    };
  }

  function updateBots(bots: ArenaBot[]): void {
    const source = map.getSource('arena-bots') as mapboxgl.GeoJSONSource | undefined;
    if (source) source.setData(buildBotFeatures(bots));
  }

  function showInteractionLine(a: ArenaBot, b: ArenaBot, pairId: string): void {
    // Determine line colour: green if both cooperated, red if both defected, yellow if mixed.
    let colour = '#ffcc00';
    if (a.visualState === 'cooperate' && b.visualState === 'cooperate') colour = '#66ee77';
    else if (a.visualState === 'defect' && b.visualState === 'defect') colour = '#ee4444';

    const feature: GeoJSON.Feature = {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [[a.lng, a.lat], [b.lng, b.lat]],
      },
      properties: { pairId, colour },
    };
    activeLines.set(pairId, feature);
    flushLines();
  }

  function removeInteractionLine(pairId: string): void {
    activeLines.delete(pairId);
    flushLines();
  }

  function clearInteractionLines(): void {
    activeLines.clear();
    flushLines();
  }

  function flushLines(): void {
    const source = map.getSource('arena-lines') as mapboxgl.GeoJSONSource | undefined;
    if (source) {
      source.setData({
        type: 'FeatureCollection',
        features: Array.from(activeLines.values()),
      });
    }
  }

  function destroy(): void {
    map.remove();
  }

  return {
    map,
    updateBots,
    showInteractionLine,
    removeInteractionLine,
    clearInteractionLines,
    destroy,
  };
}
