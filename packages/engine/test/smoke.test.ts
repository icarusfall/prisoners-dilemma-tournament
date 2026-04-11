import { describe, it, expect } from 'vitest';
import { ENGINE_VERSION } from '../src/index.js';

describe('engine skeleton', () => {
  it('exposes a version constant', () => {
    expect(ENGINE_VERSION).toBe('0.0.0');
  });
});
