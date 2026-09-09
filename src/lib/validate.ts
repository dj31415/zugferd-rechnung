import { hasLieferort, type Invoice, type Party } from "./model";
import { parseCents, parseQuantity } from "./money";

export interface Finding { field: string; message: string }
export interface ValidationResult { errors: Finding[]; warnings: Finding[] }

/** GS1-Prüfziffer (GLN, GTIN-8/12/13/14). */
export const gs1Check = (s: string): boolean => {
  if (!/^\d{8}$|^\d{12,14}$/.test(s)) return false;
  const d = s.split("").map(Number);
  const total = d.slice(0, -1).reduce((sum, x, i) => sum + x * ((d.length - i) % 2 === 0 ? 3 : 1), 0);
  return (10 - (total % 10)) % 10 === d[d.length - 1];
};

export const isGln = (s: string): boolean => /^\d{13}$/.test(s) && gs1Check(s);

export const ibanOk = (iban: string): boolean => {
  const s = iban.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) {
    const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const digit of v) rem = (rem * 10 + Number(digit)) % 97;
  }
  return rem === 1;
};

const isoDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const blank = (s: string | undefined): boolean => !s || s.trim() === "";

const LABEL: Record<string, string> = { verkaeufer: "Verkäufer", kaeufer: "Rechnungsempfänger", lieferort: "Lieferanschrift" };
const FIELD: Record<string, string> = { name: "Name", strasse: "Straße", plz: "PLZ", ort: "Ort" };

const checkParty = (prefix: string, p: Party, errors: Finding[]) => {
  const who = LABEL[prefix] ?? prefix;
  for (const f of ["name", "strasse", "plz", "ort"] as const) {
    if (blank(p[f])) errors.push({ field: `${prefix}.${f}`, message: `${who}: ${FIELD[f]} fehlt` });
  }
  if (!/^[A-Z]{2}$/.test(p.land)) errors.push({ field: `${prefix}.land`, message: `${who}: Ländercode muss 2 Großbuchstaben sein (z. B. DE)` });
  if (blank(p.gln)) errors.push({ field: `${prefix}.gln`, message: `${who}: GLN fehlt (Markant-Pflichtfeld)` });
  else if (!isGln(p.gln)) errors.push({ field: `${prefix}.gln`, message: `${who}: GLN muss 13 Ziffern mit gültiger GS1-Prüfziffer haben` });
};

/** Prüft Pflichtfelder (EN 16931) und die Markant-Anforderungen. errors verhindern die Erzeugung, warnings nicht. */
export function validate(inv: Invoice): ValidationResult {
  const errors: Finding[] = [];
  const warnings: Finding[] = [];

  if (blank(inv.nummer)) errors.push({ field: "nummer", message: "Rechnungsnummer fehlt (BT-1)" });
  if (!isoDate(inv.datum)) errors.push({ field: "datum", message: "Rechnungsdatum fehlt oder ungültig (BT-2)" });
  if (!blank(inv.leistungsdatum) && !isoDate(inv.leistungsdatum)) errors.push({ field: "leistungsdatum", message: "Leistungsdatum ungültig" });
  if (!isoDate(inv.faelligkeit)) errors.push({ field: "faelligkeit", message: "Fälligkeitsdatum fehlt oder ungültig (BT-9)" });
  if (!/^[A-Z]{3}$/.test(inv.waehrung)) errors.push({ field: "waehrung", message: "Währung muss ein 3-Buchstaben-Code sein (BT-5)" });

  const v = inv.verkaeufer;
  checkParty("verkaeufer", v, errors);
  if (blank(v.steuernummer) && blank(v.ustId)) {
    errors.push({ field: "verkaeufer.steuernummer", message: "Verkäufer: Steuernummer oder USt-IdNr. ist Pflicht (BR-CO-26, § 14 UStG)" });
  }
  if (!blank(v.ustId) && !/^[A-Z]{2}[A-Z0-9]{2,12}$/.test(v.ustId.replace(/\s/g, ""))) {
    errors.push({ field: "verkaeufer.ustId", message: "Verkäufer: USt-IdNr. hat kein gültiges Format (z. B. DE123456789)" });
  }
  if (blank(v.iban)) errors.push({ field: "verkaeufer.iban", message: "Verkäufer: IBAN fehlt (BT-84)" });
  else if (!ibanOk(v.iban)) errors.push({ field: "verkaeufer.iban", message: "Verkäufer: IBAN ist ungültig (Prüfsumme)" });
  if (!blank(v.bic) && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(v.bic.replace(/\s/g, "").toUpperCase())) {
    errors.push({ field: "verkaeufer.bic", message: "Verkäufer: BIC hat kein gültiges Format" });
  }
  if (blank(v.ralaNummer)) warnings.push({ field: "verkaeufer.ralaNummer", message: "Partnernummer (RALA) fehlt – Markant prüft sie; meist identisch mit der eigenen GLN" });

  checkParty("kaeufer", inv.kaeufer, errors);
  if (hasLieferort(inv)) checkParty("lieferort", inv.lieferort, errors);
  else warnings.push({ field: "lieferort.name", message: "Lieferanschrift fehlt – Markant erwartet die GLN des belieferten Marktes" });

  if (blank(inv.lieferscheinnummer)) warnings.push({ field: "lieferscheinnummer", message: "Lieferscheinnummer fehlt (Markant-Prüfung DN)" });
  if (blank(inv.bestellnummer)) warnings.push({ field: "bestellnummer", message: "Bestellnummer fehlt (bei Markant optional)" });

  if (!inv.kleinunternehmer) {
    const rate = Number(inv.ustSatz.replace(",", "."));
    if (inv.ustSatz.trim() === "" || Number.isNaN(rate) || rate < 0 || rate > 100) {
      errors.push({ field: "ustSatz", message: "USt-Satz fehlt oder ungültig – oder Kleinunternehmer ankreuzen" });
    } else if (rate === 0) {
      errors.push({ field: "ustSatz", message: "USt-Satz 0 % ohne Kleinunternehmerregelung ist nicht abbildbar (Kategorie S braucht > 0 %)" });
    }
  }

  if (inv.positionen.length === 0) errors.push({ field: "positionen", message: "Mindestens eine Rechnungsposition ist Pflicht (BR-16)" });
  inv.positionen.forEach((l, i) => {
    const p = `positionen.${i}`;
    const n = i + 1;
    if (blank(l.beschreibung)) errors.push({ field: `${p}.beschreibung`, message: `Position ${n}: Beschreibung fehlt (BT-153)` });
    if (parseQuantity(l.menge) === null) errors.push({ field: `${p}.menge`, message: `Position ${n}: Menge ungültig (max. 3 Nachkommastellen)` });
    if (parseCents(l.einzelpreis) === null) errors.push({ field: `${p}.einzelpreis`, message: `Position ${n}: Einzelpreis ungültig (z. B. 5,00)` });
    if (!/^[A-Z0-9]{2,3}$/.test(l.einheit)) errors.push({ field: `${p}.einheit`, message: `Position ${n}: Einheit muss ein UN/ECE-Code sein (H87 = Stück, KGM = kg)` });
    if (!blank(l.gtin) && !gs1Check(l.gtin)) errors.push({ field: `${p}.gtin`, message: `Position ${n}: GTIN hat eine falsche Prüfziffer` });
    if (blank(l.gtin)) warnings.push({ field: `${p}.gtin`, message: `Position ${n}: GTIN fehlt (Markant-Warnung BR-MARKANT-01)` });
  });

  return { errors, warnings };
}
