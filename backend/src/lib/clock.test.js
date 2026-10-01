import { describe, expect, it } from 'vitest';
import { now } from './clock.js';

describe('now', () => {
  it('uses Argentina time, not the server clock (UTC in the container)', () => {
    // 00:30 UTC del 23 son las 21:30 del 22 acá.
    expect(now(new Date('2026-09-23T00:30:00Z'))).toEqual({ iso: '2026-09-22', time: '21:30' });
  });

  it('pads and uses 24 h', () => {
    expect(now(new Date('2026-01-05T12:05:00Z'))).toEqual({ iso: '2026-01-05', time: '09:05' });
  });
});
