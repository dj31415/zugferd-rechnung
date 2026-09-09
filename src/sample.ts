import type { Invoice } from "./lib/model";

/** Fiktive Beispielrechnung – Kleinunternehmer liefert Honig an einen famila-Markt (Markant). */
export const sampleInvoice: Invoice = {
  nummer: "2024-001",
  datum: "2024-07-08",
  leistungsdatum: "2024-07-08",
  faelligkeit: "2024-07-22",
  waehrung: "EUR",
  kleinunternehmer: true,
  ustSatz: "7",
  verkaeufer: {
    name: "Imkerei Muster", strasse: "Musterweg 1", plz: "12345", ort: "Musterstadt", land: "DE",
    gln: "4000001000005", steuernummer: "12/345/67890", ustId: "", ralaNummer: "4000001000005",
    iban: "DE02120300000000202051", bic: "BYLADEM1001", kontoinhaber: "Max Muster",
  },
  kaeufer: { name: "Famila Handelsmarkt Neumünster GmbH & Co. KG", strasse: "Alte Weide 7-13", plz: "24116", ort: "Kiel", land: "DE", gln: "4304525000009" },
  lieferort: { name: "famila Rendsburg", strasse: "Friedrichstädter Str. 4", plz: "24768", ort: "Rendsburg", land: "DE", gln: "4331586000006" },
  bestellnummer: "",
  lieferscheinnummer: "20",
  kaeuferReferenz: "",
  positionen: [
    { beschreibung: "Rapshonig 500 g", artikelnummer: "100001", gtin: "", menge: "52", einheit: "H87", einzelpreis: "5,00" },
    { beschreibung: "Blütenhonig 500 g", artikelnummer: "100002", gtin: "", menge: "20", einheit: "H87", einzelpreis: "5,00" },
  ],
};
