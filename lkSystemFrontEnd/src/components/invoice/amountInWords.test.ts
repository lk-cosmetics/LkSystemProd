import { describe, expect, it } from 'vitest';

import { amountInFrenchTnd } from './amountInWords';

describe('amountInFrenchTnd', () => {
  it('writes whole dinar amounts in French', () => {
    expect(amountInFrenchTnd(184)).toBe('Cent quatre-vingt-quatre dinars tunisiens.');
    expect(amountInFrenchTnd(1)).toBe('Un dinar tunisien.');
  });

  it('includes millimes when present', () => {
    expect(amountInFrenchTnd(21.125)).toBe(
      'Vingt et un dinars tunisiens et cent vingt-cinq millimes.',
    );
  });
});
