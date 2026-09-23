import { describe, expect, it } from 'vitest';
import { calculatePOSPayment, roundTND } from './posPayment';

describe('POS payment calculations', () => {
  it('keeps Tunisian millimes exact instead of rounding 44.500 to 45', () => {
    const result = calculatePOSPayment({
      method: 'cash',
      total: 44.5,
      cashAmount: 44.5,
      cardAmount: 0,
      amountReceived: 44.5,
    });

    expect(roundTND(44.5)).toBe(44.5);
    expect(result.valid).toBe(true);
    expect(result.change).toBe(0);
  });

  it('rejects an underpaid cash sale', () => {
    const result = calculatePOSPayment({
      method: 'cash',
      total: 75,
      cashAmount: 75,
      cardAmount: 0,
      amountReceived: 50,
    });

    expect(result.valid).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.error).toContain('inférieur');
  });

  it('validates a split tender and calculates change from the cash portion', () => {
    const result = calculatePOSPayment({
      method: 'split',
      total: 120,
      cashAmount: 50,
      cardAmount: 70,
      amountReceived: 60,
    });

    expect(result.valid).toBe(true);
    expect(result.totalPaid).toBe(120);
    expect(result.remaining).toBe(0);
    expect(result.change).toBe(10);
  });

  it('rejects an invalid split total', () => {
    const result = calculatePOSPayment({
      method: 'split',
      total: 120,
      cashAmount: 40,
      cardAmount: 70,
      amountReceived: 40,
    });

    expect(result.valid).toBe(false);
    expect(result.remaining).toBe(10);
  });
});
