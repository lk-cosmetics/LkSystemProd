const SMALL = [
  'zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf',
  'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept',
  'dix-huit', 'dix-neuf',
] as const;

const TENS: Record<number, string> = {
  20: 'vingt',
  30: 'trente',
  40: 'quarante',
  50: 'cinquante',
  60: 'soixante',
};

function underHundred(value: number): string {
  if (value < 20) return SMALL[value];
  if (value < 70) {
    const ten = Math.floor(value / 10) * 10;
    const unit = value % 10;
    return unit === 0 ? TENS[ten] : `${TENS[ten]}${unit === 1 ? ' et ' : '-'}${SMALL[unit]}`;
  }
  if (value < 80) {
    const remainder = value - 60;
    return `soixante${remainder === 11 ? ' et ' : '-'}${underHundred(remainder)}`;
  }

  const remainder = value - 80;
  if (remainder === 0) return 'quatre-vingts';
  return `quatre-vingt-${underHundred(remainder)}`;
}

function underThousand(value: number): string {
  if (value < 100) return underHundred(value);

  const hundreds = Math.floor(value / 100);
  const remainder = value % 100;
  const prefix = hundreds === 1 ? 'cent' : `${SMALL[hundreds]} cent`;
  if (remainder === 0) return hundreds > 1 ? `${prefix}s` : prefix;
  return `${prefix} ${underHundred(remainder)}`;
}

function integerToFrench(value: number): string {
  if (value === 0) return SMALL[0];
  if (value < 1_000) return underThousand(value);
  if (value < 1_000_000) {
    const thousands = Math.floor(value / 1_000);
    const remainder = value % 1_000;
    const prefix = thousands === 1 ? 'mille' : `${underThousand(thousands)} mille`;
    return remainder === 0 ? prefix : `${prefix} ${underThousand(remainder)}`;
  }

  const millions = Math.floor(value / 1_000_000);
  const remainder = value % 1_000_000;
  const prefix = `${integerToFrench(millions)} million${millions > 1 ? 's' : ''}`;
  return remainder === 0 ? prefix : `${prefix} ${integerToFrench(remainder)}`;
}

export function amountInFrenchTnd(amount: number): string {
  const totalMillimes = Math.max(0, Math.round(amount * 1_000));
  const dinars = Math.floor(totalMillimes / 1_000);
  const millimes = totalMillimes % 1_000;
  const dinarWords = `${integerToFrench(dinars)} dinar${dinars === 1 ? '' : 's'} tunisien${dinars === 1 ? '' : 's'}`;
  const text = millimes === 0
    ? dinarWords
    : `${dinarWords} et ${integerToFrench(millimes)} millime${millimes === 1 ? '' : 's'}`;
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}
