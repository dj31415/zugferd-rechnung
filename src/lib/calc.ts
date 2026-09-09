import type { Invoice } from "./model";
import { lineTotal, parseCents, parseQuantity, taxOf } from "./money";

export interface CalcLine {
  nr: number;
  beschreibung: string;
  artikelnummer: string;
  gtin: string;
  einheit: string;
  qty: bigint;     // Tausendstel
  price: bigint;   // Cent
  total: bigint;   // Cent
}

export interface Calc {
  lines: CalcLine[];
  net: bigint;
  tax: bigint;
  gross: bigint;
  rate: number;       // Prozent
  category: "S" | "E";
}

/** Rechnet alle Beträge. Setzt eine bereits erfolgreiche validate() voraus. */
export function compute(inv: Invoice): Calc {
  const lines: CalcLine[] = inv.positionen.map((p, i) => {
    const qty = parseQuantity(p.menge);
    const price = parseCents(p.einzelpreis);
    if (qty === null || price === null) throw new Error(`Position ${i + 1}: Menge oder Preis ungültig`);
    return { nr: i + 1, beschreibung: p.beschreibung.trim(), artikelnummer: p.artikelnummer.trim(), gtin: p.gtin.trim(),
      einheit: p.einheit.trim() || "H87", qty, price, total: lineTotal(qty, price) };
  });
  const net = lines.reduce((s, l) => s + l.total, 0n);
  const category = inv.kleinunternehmer ? "E" : "S";
  const rate = inv.kleinunternehmer ? 0 : Number(inv.ustSatz.replace(",", "."));
  const tax = taxOf(net, rate);
  return { lines, net, tax, gross: net + tax, rate, category };
}
