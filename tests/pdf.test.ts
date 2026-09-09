import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generate } from "../src/lib/generate";
import { sampleInvoice } from "../src/sample";

const assets = {
  fontRegular: new Uint8Array(readFileSync("src/assets/DejaVuSans.ttf")),
  fontBold: new Uint8Array(readFileSync("src/assets/DejaVuSans-Bold.ttf")),
  iccProfile: new Uint8Array(readFileSync("src/assets/srgb.icc")),
};

describe("generate", () => {
  it("baut ein PDF mit Factur-X-Anhang, XMP und OutputIntent", async () => {
    const r = await generate(sampleInvoice, assets, new Date("2024-07-08T10:00:00Z"));
    const pdf = new TextDecoder("latin1").decode(r.pdf);
    expect(pdf.startsWith("%PDF-1.7")).toBe(true);
    expect(pdf).toContain("/AFRelationship /Alternative");
    expect(pdf).toContain("/Subtype /text#2Fxml");
    expect(pdf).toContain("(factur-x.xml)");
    expect(pdf).toContain("/AF [");
    expect(pdf).toContain("/OutputIntents");
    expect(pdf).toContain("<pdfaid:part>3</pdfaid:part>");
    expect(pdf).toContain("<fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>");
    expect(pdf).toContain("<xmp:CreateDate>2024-07-08T10:00:00Z</xmp:CreateDate>");
    expect(pdf).toContain("/ID [");
    expect(r.basename).toBe("Rechnung-2024-001-zugferd");
  });
  it("wirft bei Validierungsfehlern", async () => {
    await expect(generate({ ...sampleInvoice, nummer: "" }, assets)).rejects.toThrow(/Rechnungsnummer/);
  });
});
