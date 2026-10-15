import { describe, expect, it } from 'vitest';
import { fmtTND } from './types';

describe('fmtTND', () => {
  it('formats a plain amount with three decimals', () => {
    expect(fmtTND(176)).toBe('176.000');
    expect(fmtTND('89.5')).toBe('89.500');
    expect(fmtTND(44.5)).toBe('44.500');
  });

  it('never renders a signed zero as "-0.000"', () => {
    // The cart showed "-0.000 TND" for a cleared discount because
    // `(-0).toFixed(3)` is "-0.000".
    expect(fmtTND(-0)).toBe('0.000');
    expect(fmtTND(0)).toBe('0.000');
  });

  it('collapses a tiny negative that rounds to zero', () => {
    // Subtracting two equal totals can land just below zero in floating point;
    // at three decimals that is zero, and it must not acquire a minus sign.
    expect(fmtTND(-0.0001)).toBe('0.000');
    expect(fmtTND(176.0 - 176.0000001)).toBe('0.000');
  });

  it('still formats genuinely negative amounts', () => {
    expect(fmtTND(-12.5)).toBe('-12.500');
  });

  it('falls back to zero for non-numeric input', () => {
    expect(fmtTND(null)).toBe('0.000');
    expect(fmtTND(undefined)).toBe('0.000');
    expect(fmtTND('abc')).toBe('0.000');
  });
});
