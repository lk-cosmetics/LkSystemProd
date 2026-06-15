import { describe, it, expect } from 'vitest';
import {
  isoToTunisLocal,
  tunisLocalToIso,
  tunisOffsetMinutes,
} from './tunisTime';

describe('tunisTime', () => {
  // Tunisia is UTC+1 year-round (no DST), so the offset is a flat +60 minutes.
  it('reports a +60min offset for Africa/Tunis', () => {
    expect(tunisOffsetMinutes(Date.UTC(2026, 5, 13, 12, 0, 0))).toBe(60);
    expect(tunisOffsetMinutes(Date.UTC(2026, 0, 1, 0, 0, 0))).toBe(60);
  });

  it('converts a Tunisia wall-clock value to the right UTC instant', () => {
    // 08:00 in Tunis is 07:00 UTC.
    expect(tunisLocalToIso('2026-06-13T08:00')).toBe('2026-06-13T07:00:00.000Z');
    // Midnight in Tunis is 23:00 UTC the previous day — the case that used to
    // silently exclude the intended day from the promotion window.
    expect(tunisLocalToIso('2026-06-13T00:00')).toBe('2026-06-12T23:00:00.000Z');
  });

  it('converts a UTC instant back to the Tunisia wall-clock input value', () => {
    expect(isoToTunisLocal('2026-06-13T07:00:00.000Z')).toBe('2026-06-13T08:00');
    expect(isoToTunisLocal('2026-06-12T23:00:00.000Z')).toBe('2026-06-13T00:00');
  });

  it('round-trips wall-clock → ISO → wall-clock', () => {
    const local = '2026-12-31T23:30';
    expect(isoToTunisLocal(tunisLocalToIso(local))).toBe(local);
  });

  it('treats the input as Tunisia time independent of the host clock', () => {
    // The conversion is anchored to Africa/Tunis via Intl, not the machine's
    // timezone, so the result is stable wherever the test (or browser) runs.
    expect(tunisLocalToIso('2026-03-01T15:45')).toBe('2026-03-01T14:45:00.000Z');
  });

  it('handles empty / nullish values gracefully', () => {
    expect(tunisLocalToIso('')).toBe('');
    expect(isoToTunisLocal('')).toBe('');
    expect(isoToTunisLocal(null)).toBe('');
    expect(isoToTunisLocal(undefined)).toBe('');
  });
});
