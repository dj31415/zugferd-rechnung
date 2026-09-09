/** Geldbeträge als ganze Cent, Mengen als Tausendstel – keine Fließkomma-Rundungsfehler. */

const parseDecimal = (s: string, scale: number): bigint | null => {
  const t = s.trim().replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const neg = t.startsWith("-");
  const [int, frac = ""] = t.replace("-", "").split(".");
  if (frac.length > scale) return null;
  const v = BigInt(int + frac.padEnd(scale, "0"));
  return neg ? -v : v;
};

/** "5,00" | "5.00" | "1.234,56" -> 500 | 500 | 123456 (Cent). null bei ungültiger Eingabe oder mehr als 2 Nachkommastellen. */
export const parseCents = (s: string): bigint | null => parseDecimal(s, 2);

/** Menge mit bis zu 3 Nachkommastellen -> Tausendstel. */
export const parseQuantity = (s: string): bigint | null => parseDecimal(s, 3);

/** Kaufmännisch runden (half up, symmetrisch) von num/den. */
export const divRound = (num: bigint, den: bigint): bigint => {
  const neg = (num < 0n) !== (den < 0n);
  const a = num < 0n ? -num : num;
  const b = den < 0n ? -den : den;
  const q = (a * 2n + b) / (2n * b);
  return neg ? -q : q;
};

/** Positionsbetrag: Menge (Tausendstel) × Preis (Cent), gerundet auf Cent. */
export const lineTotal = (qtyMilli: bigint, priceCents: bigint): bigint => divRound(qtyMilli * priceCents, 1000n);

/** Steuer: netto × Satz / 100; Satz in Prozent mit bis zu 2 Nachkommastellen. */
export const taxOf = (netCents: bigint, ratePercent: number): bigint =>
  divRound(netCents * BigInt(Math.round(ratePercent * 100)), 10000n);

const split = (v: bigint, scale: number): [string, string, boolean] => {
  const neg = v < 0n;
  const s = (neg ? -v : v).toString().padStart(scale + 1, "0");
  return [s.slice(0, s.length - scale), s.slice(s.length - scale), neg];
};

/** 123456 -> "1234.56" (für XML) */
export const centsToXml = (v: bigint): string => {
  const [i, f, neg] = split(v, 2);
  return `${neg ? "-" : ""}${i}.${f}`;
};

/** 123456 -> "1.234,56" (für die sichtbare Rechnung) */
export const centsToDe = (v: bigint): string => {
  const [i, f, neg] = split(v, 2);
  return `${neg ? "-" : ""}${i.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${f}`;
};

/** Tausendstel -> kürzeste Dezimaldarstellung ("52", "1.5") */
export const quantityToXml = (q: bigint): string => {
  const [i, f, neg] = split(q, 3);
  const frac = f.replace(/0+$/, "");
  return `${neg ? "-" : ""}${i}${frac ? "." + frac : ""}`;
};

export const quantityToDe = (q: bigint): string => quantityToXml(q).replace(".", ",");
