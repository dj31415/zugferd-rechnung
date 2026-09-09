/** Datenmodell einer Rechnung, wie es das Formular liefert. Beträge sind Strings in deutscher Schreibweise ("5,00"). */
export interface Party {
  name: string;
  strasse: string;
  plz: string;
  ort: string;
  land: string;
  gln: string;
}

export interface Seller extends Party {
  steuernummer: string;
  ustId: string;
  ralaNummer: string;
  iban: string;
  bic: string;
  kontoinhaber: string;
}

export interface Line {
  beschreibung: string;
  artikelnummer: string;
  gtin: string;
  menge: string;
  einheit: string;
  einzelpreis: string;
}

export interface Invoice {
  nummer: string;
  datum: string;          // ISO yyyy-mm-dd
  leistungsdatum: string; // ISO, leer = datum
  faelligkeit: string;    // ISO
  waehrung: string;
  kleinunternehmer: boolean;
  ustSatz: string;        // "7", "19"
  verkaeufer: Seller;
  kaeufer: Party;
  lieferort: Party;       // leer lassen (name == "") wenn nicht benötigt
  bestellnummer: string;
  lieferscheinnummer: string;
  kaeuferReferenz: string;
  positionen: Line[];
}

export const emptyParty = (): Party => ({ name: "", strasse: "", plz: "", ort: "", land: "DE", gln: "" });

export const emptyLine = (): Line => ({ beschreibung: "", artikelnummer: "", gtin: "", menge: "1", einheit: "H87", einzelpreis: "" });

export const emptyInvoice = (): Invoice => ({
  nummer: "",
  datum: "",
  leistungsdatum: "",
  faelligkeit: "",
  waehrung: "EUR",
  kleinunternehmer: false,
  ustSatz: "7",
  verkaeufer: { ...emptyParty(), steuernummer: "", ustId: "", ralaNummer: "", iban: "", bic: "", kontoinhaber: "" },
  kaeufer: emptyParty(),
  lieferort: emptyParty(),
  bestellnummer: "",
  lieferscheinnummer: "",
  kaeuferReferenz: "",
  positionen: [emptyLine()],
});

export const hasLieferort = (inv: Invoice): boolean => inv.lieferort.name.trim() !== "" || inv.lieferort.gln.trim() !== "";
