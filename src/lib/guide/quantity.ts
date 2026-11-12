/**
 * Quantity detection shared by guide validation, the assistant guards and simplification.
 *
 * Text is normalised first (NFKC; format characters such as zero-width spaces and text-direction marks, and combining
 * marks, are removed or turned into spaces, whichever hides more), then split into tokens. A quantity is any of:
 * a number, optionally joined to a unit ("10 Nm", "4mm") or to a second number ("4 to 10 mm", "1/2"); a spelled-out
 * number (one..twelve count as numbers, so "ten Nm" equals "10 Nm"); other quantity words ("half", "several");
 * a unit word on its own ("an inch", "a litre"); an upper-case roman numeral ("XII"); a word that mixes scripts
 * ("twо" with a Cyrillic o), which is how look-alike spellings hide a number word.
 * Only English number words are recognised: callers hold back answers for guides in other languages.
 */

const NUMBER_WORD_VALUES: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12',
};

/** Quantity words that are not plain numbers; each stands for itself and must appear in the evidence. */
const OTHER_QUANTITY_WORDS = new Set([
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
  'hundred', 'hundreds', 'thousand', 'half', 'halves', 'quarter', 'quarters', 'third', 'thirds', 'dozen', 'dozens', 'twice', 'double', 'triple', 'pair', 'pairs',
  'couple', 'several', 'few', 'single', 'both', 'once', 'thrice',
]);

/** Unit words that count as a quantity even without a number ("an inch"). Canonical form on the right. */
const LONG_UNITS: Record<string, string> = {
  millimetre: 'mm', millimetres: 'mm', millimeter: 'mm', millimeters: 'mm',
  centimetre: 'cm', centimetres: 'cm', centimeter: 'cm', centimeters: 'cm',
  metre: 'm', metres: 'm', meter: 'm', meters: 'm', kilometre: 'km', kilometres: 'km', kilometer: 'km', kilometers: 'km',
  inch: 'in', inches: 'in', foot: 'ft', feet: 'ft', yard: 'yd', yards: 'yd', mile: 'mi', miles: 'mi',
  litre: 'l', litres: 'l', liter: 'l', liters: 'l', millilitre: 'ml', millilitres: 'ml', milliliter: 'ml', milliliters: 'ml',
  gallon: 'gal', gallons: 'gal', pint: 'pt', pints: 'pt', quart: 'qt', quarts: 'qt',
  gram: 'g', grams: 'g', milligram: 'mg', milligrams: 'mg', kilogram: 'kg', kilograms: 'kg', kilo: 'kg', kilos: 'kg',
  ounce: 'oz', ounces: 'oz', pound: 'lb', pounds: 'lb',
  newton: 'newton', newtons: 'newton', pascal: 'pa', pascals: 'pa', volt: 'v', volts: 'v', watt: 'w', watts: 'w', amp: 'amp', amps: 'amp', ampere: 'amp', amperes: 'amp',
  hertz: 'hz', degree: 'deg', degrees: 'deg', percent: '%',
  minute: 'min', minutes: 'min', hour: 'h', hours: 'h', seconds: 's', day: 'd', days: 'd', week: 'wk', weeks: 'wk', month: 'mo', months: 'mo', year: 'yr', years: 'yr',
};

/** Abbreviations that are a unit only directly after a number ("10 Nm", "4mm"). */
const SHORT_UNITS: Record<string, string> = {
  mm: 'mm', cm: 'cm', m: 'm', km: 'km', ft: 'ft', yd: 'yd', l: 'l', ml: 'ml', cl: 'cl', g: 'g', mg: 'mg', kg: 'kg', oz: 'oz', lb: 'lb', lbs: 'lb',
  nm: 'nm', pa: 'pa', kpa: 'kpa', psi: 'psi', bar: 'bar', v: 'v', w: 'w', kw: 'kw', hz: 'hz', khz: 'khz', mhz: 'mhz', rpm: 'rpm',
  min: 'min', mins: 'min', h: 'h', hr: 'h', hrs: 'h', sec: 's', secs: 's', s: 's', th: '', st: '', nd: '', rd: '',
};
const SYMBOL_UNITS: Record<string, string> = { '°': 'deg', '%': '%', '″': 'in', '′': 'ft' };

const ROMAN = /^(?=[MDCLXVI])M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/;
const CYRILLIC_OR_GREEK = /[\p{Script=Cyrillic}\p{Script=Greek}]/u;
const LATIN = /\p{Script=Latin}/u;

type Tok =
  | { t: 'n'; v: string }
  | { t: 'w'; v: string }
  | { t: 'sym'; v: string }
  | { t: 'sep'; v: string };

const TOKEN_RE = /(\p{N}+(?:[.,]\p{N}+)*)|([\p{L}\p{M}]+)|([°%″′])|([-–—/⁄])/gu;

/** `1,500` -> `1500`, `4,5` -> `4.5`, `4.0` -> `4`, `04` -> `4`. Non-ASCII digits are kept as they are. */
function canonNumber(raw: string): string {
  if (!/^[0-9.,]+$/.test(raw)) return raw;
  let s = raw.replace(/,(?=\d{3}(?!\d))/g, '');
  s = s.replace(',', '.');
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s.replace(/^0+(?=\d)/, '') || '0';
}

function tokenise(text: string): Tok[] {
  const out: Tok[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    if (m[1] !== undefined) out.push({ t: 'n', v: canonNumber(m[1]) });
    else if (m[2] !== undefined) {
      const word = NUMBER_WORD_VALUES[m[2].toLowerCase()];
      out.push(word !== undefined ? { t: 'n', v: word } : { t: 'w', v: m[2] });
    } else if (m[3] !== undefined) out.push({ t: 'sym', v: m[3] });
    else out.push({ t: 'sep', v: m[4]! });
  }
  return out;
}

/** Quantity keys of one already-normalised text: key -> how it is shown to a person. */
function keysOf(text: string, into: Map<string, string>): void {
  const toks = tokenise(text);
  for (let i = 0; i < toks.length; ) {
    const tok = toks[i]!;
    if (tok.t === 'n') {
      let j = i + 1;
      let kind = 'n';
      let to: string | undefined;
      const sep = toks[j];
      const after = toks[j + 1];
      if (sep && after?.t === 'n' && sep.t === 'sep') {
        kind = sep.v === '/' || sep.v === '⁄' ? 'f' : 'r';
        to = after.v;
        j += 2;
      } else if (sep?.t === 'w' && /^(to|through|thru)$/i.test(sep.v) && after?.t === 'n') {
        kind = 'r';
        to = after.v;
        j += 2;
      }
      let unit = '';
      const u = toks[j];
      if (u?.t === 'sym') {
        unit = SYMBOL_UNITS[u.v] ?? '';
        j++;
      } else if (u?.t === 'w') {
        const lower = u.v.toLowerCase();
        const known = Object.hasOwn(LONG_UNITS, lower) ? LONG_UNITS[lower] : Object.hasOwn(SHORT_UNITS, lower) ? SHORT_UNITS[lower] : undefined;
        if (known !== undefined) {
          unit = known;
          j++;
        }
      }
      const shown = `${tok.v}${to === undefined ? '' : kind === 'f' ? `/${to}` : `-${to}`}${unit ? ` ${unit}` : ''}`;
      into.set(`${kind}:${tok.v}~${to ?? ''}:${unit}`, shown);
      i = j;
      continue;
    }
    if (tok.t === 'w') {
      const lower = tok.v.toLowerCase();
      if (OTHER_QUANTITY_WORDS.has(lower)) into.set(`w:${lower}`, lower);
      else if (Object.hasOwn(LONG_UNITS, lower)) into.set(`u:${LONG_UNITS[lower]}`, lower);
      else if (tok.v.length >= 2 && tok.v === tok.v.toUpperCase() && ROMAN.test(tok.v)) into.set(`roman:${tok.v}`, tok.v);
      else if (LATIN.test(tok.v) && CYRILLIC_OR_GREEK.test(tok.v)) into.set(`mixed:${lower}`, tok.v);
    }
    i++;
  }
}

/** NFKC, then two readings: format characters and combining marks removed (joins a number word split by a zero-width space) and replaced by spaces (splits a number glued to a unit by one). */
function normalisedReadings(text: string): string[] {
  const base = text.normalize('NFKC');
  return [base.replace(/[\p{Cf}\p{Mn}]/gu, '').replace(/_/g, ' '), base.replace(/[\p{Cf}\p{Mn}\p{Cc}_]/gu, ' ')];
}

/** Every quantity key in `text`, mapped to a readable form. */
export function quantityKeys(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const reading of normalisedReadings(text)) keysOf(reading, out);
  return out;
}

/** True when the text contains any quantity (digits of any script, number words, unit words, roman numerals, look-alike spellings). */
export function containsQuantity(text: string): boolean {
  return quantityKeys(text).size > 0;
}

/**
 * Quantities in `text` that appear in none of the `evidence` pieces. Each piece is read on its own, so a number
 * and a unit (or the two ends of a range) that sit in different pieces never combine into a new pair.
 */
export function findIntroducedQuantities(evidence: string | readonly string[], text: string): string[] {
  const known = new Set<string>();
  for (const piece of typeof evidence === 'string' ? [evidence] : evidence) for (const k of quantityKeys(piece).keys()) known.add(k);
  const out: string[] = [];
  for (const [key, shown] of quantityKeys(text)) if (!known.has(key)) out.push(shown);
  return out;
}
