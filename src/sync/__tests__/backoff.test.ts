/**
 * The RNG is injected precisely so the jitter can be pinned. A spread nobody
 * asserts on is a spread that quietly becomes zero.
 */
import { backoffMs } from '../backoff';

const mid = () => 0.5; // the midpoint of the jitter range: no adjustment
const low = () => 0;
const high = () => 1;

describe('the schedule', () => {
  it('doubles to 8s, then steps 15/30/60', () => {
    const steps = [1, 2, 3, 4, 5, 6, 7].map((n) => backoffMs(n, mid));
    expect(steps).toEqual([1000, 2000, 4000, 8000, 15000, 30000, 60000]);
  });

  it('caps at a minute rather than growing forever', () => {
    expect(backoffMs(8, mid)).toBe(60000);
    expect(backoffMs(50, mid)).toBe(60000);
  });

  it('clamps a nonsense attempt to the first step instead of throwing', () => {
    // The drain that calls this is holding the user's unsent work; it must not
    // be the thing that crashes.
    expect(backoffMs(0, mid)).toBe(1000);
    expect(backoffMs(-3, mid)).toBe(1000);
    expect(backoffMs(Number.NaN, mid)).toBe(1000);
  });

  it('rounds a fractional attempt down to a real step', () => {
    expect(backoffMs(2.9, mid)).toBe(2000);
  });
});

describe('the jitter', () => {
  it('spans exactly ±20%', () => {
    expect(backoffMs(1, low)).toBe(800);
    expect(backoffMs(1, high)).toBe(1200);
    expect(backoffMs(7, low)).toBe(48000);
    expect(backoffMs(7, high)).toBe(72000);
  });

  it('stays inside the band for any value the RNG can return', () => {
    for (let i = 0; i <= 100; i += 1) {
      const ms = backoffMs(4, () => i / 100);
      expect(ms).toBeGreaterThanOrEqual(6400);
      expect(ms).toBeLessThanOrEqual(9600);
    }
  });

  it('is pure — same attempt, same RNG, same answer', () => {
    const rand = () => 0.37;
    expect(backoffMs(3, rand)).toBe(backoffMs(3, rand));
  });
});
