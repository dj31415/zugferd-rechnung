import { describe, expect, it } from "vitest";
import { gs1Check, ibanOk, validate } from "../src/lib/validate";
import { sampleInvoice } from "../src/sample";
import { emptyInvoice } from "../src/lib/model";

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));

describe("Prüfziffern", () => {
  it("GLN", () => {
    expect(gs1Check("4304525000009")).toBe(true);
    expect(gs1Check("4000001000005")).toBe(true);
    expect(gs1Check("4000001000004")).toBe(false);
    expect(gs1Check("400000100000")).toBe(false); // 12 Stellen: keine GLN
  });
  it("IBAN", () => {
    expect(ibanOk("DE02120300000000202051")).toBe(true);
    expect(ibanOk("DE02 1203 0000 0000 2020 51")).toBe(true);
    expect(ibanOk("DE03120300000000202051")).toBe(false);
  });
});

describe("validate", () => {
  it("Beispielrechnung hat keine Fehler, aber Markant-Warnungen", () => {
    const r = validate(sampleInvoice);
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((w) => w.field)).toEqual(["bestellnummer", "positionen.0.gtin", "positionen.1.gtin"]);
  });
  it("leere Rechnung ist voller Fehler", () => {
    const r = validate(emptyInvoice());
    expect(r.errors.length).toBeGreaterThan(8);
  });
  it("Steuernummer oder USt-Id ist Pflicht", () => {
    const inv = clone(sampleInvoice);
    inv.verkaeufer.steuernummer = "";
    expect(validate(inv).errors.map((e) => e.field)).toContain("verkaeufer.steuernummer");
    inv.verkaeufer.ustId = "DE123456789";
    expect(validate(inv).errors).toEqual([]);
  });
  it("USt-Satz 0 ohne Kleinunternehmer ist ein Fehler", () => {
    const inv = clone(sampleInvoice);
    inv.kleinunternehmer = false; inv.ustSatz = "0";
    expect(validate(inv).errors.map((e) => e.field)).toEqual(["ustSatz"]);
  });
  it("falsche GLN wird erkannt", () => {
    const inv = clone(sampleInvoice);
    inv.kaeufer.gln = "4304525000008";
    expect(validate(inv).errors[0].field).toBe("kaeufer.gln");
  });
});
