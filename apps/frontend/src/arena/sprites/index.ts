// Bot sprite gallery — 8 hand-drawn SVG silhouettes.
//
// Imported as raw strings via Vite's `?raw` suffix so they can be
// converted to ImageData for Mapbox's `addImage` without a network
// request. Each SVG is white-on-transparent; Mapbox's `icon-color`
// paint property handles per-bot tinting.

import officeWorker from './office-worker.svg?raw';
import courier from './courier.svg?raw';
import barista from './barista.svg?raw';
import professor from './professor.svg?raw';
import builder from './builder.svg?raw';
import jogger from './jogger.svg?raw';
import tourist from './tourist.svg?raw';
import securityGuard from './security-guard.svg?raw';
import camel from './camel.svg?raw';
import ceo from './ceo.svg?raw';
import djgroove from './djgroove.svg?raw';
import dogWalker from './dog-walker.svg?raw';
import mayaHead from './maya-head.svg?raw';
import scotsman from './scotsman.svg?raw';

export const SPRITE_NAMES = [
  'office-worker',
  'courier',
  'barista',
  'professor',
  'builder',
  'jogger',
  'tourist',
  'security-guard',
  'camel',
  'ceo',
  'djgroove',
  'dog-walker',
  'maya-head',
  'scotsman',
] as const;

export type SpriteName = (typeof SPRITE_NAMES)[number];

export const SPRITE_SVGS: Record<SpriteName, string> = {
  'office-worker': officeWorker,
  'courier': courier,
  'barista': barista,
  'professor': professor,
  'builder': builder,
  'jogger': jogger,
  'tourist': tourist,
  'security-guard': securityGuard,
  'camel': camel,
  'ceo': ceo,
  'djgroove': djgroove,
  'dog-walker': dogWalker,
  'maya-head': mayaHead,
  'scotsman': scotsman,
};
