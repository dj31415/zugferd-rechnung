import { describe, expect, it } from "vitest";
import { compute } from "../src/lib/calc";
import { buildXml } from "../src/lib/xml";
import { sampleInvoice } from "../src/sample";

describe("buildXml", () => {
  const xml = buildXml(sampleInvoice, compute(sampleInvoice));
  it("enthält die Markant-relevanten Felder", () => {
    expect(xml).toContain('<ram:ID>urn:cen.eu:en16931:2017</ram:ID>');
    expect(xml).toContain('<ram:SellerTradeParty><ram:ID>4000001000005</ram:ID><ram:GlobalID schemeID="0088">4000001000005</ram:GlobalID>');
    expect(xml).toContain('<ram:BuyerTradeParty><ram:GlobalID schemeID="0088">4304525000009</ram:GlobalID>');
    expect(xml).toContain('<ram:ShipToTradeParty><ram:GlobalID schemeID="0088">4331586000006</ram:GlobalID>');
    expect(xml).toContain('<ram:DespatchAdviceReferencedDocument><ram:IssuerAssignedID>20</ram:IssuerAssignedID>');
    expect(xml).not.toContain("BuyerOrderReferencedDocument");
    expect(xml).toContain('<ram:ID schemeID="FC">12/345/67890</ram:ID>');
  });
  it("Kleinunternehmer: Kategorie E mit Begründung, Summen stimmen", () => {
    expect(xml).toContain("<ram:CategoryCode>E</ram:CategoryCode>");
    expect(xml).toContain("<ram:ExemptionReason>");
    expect(xml).toContain("<ram:LineTotalAmount>360.00</ram:LineTotalAmount><ram:TaxBasisTotalAmount>360.00</ram:TaxBasisTotalAmount>");
    expect(xml).toContain('<ram:TaxTotalAmount currencyID="EUR">0.00</ram:TaxTotalAmount><ram:GrandTotalAmount>360.00</ram:GrandTotalAmount>');
  });
  it("Regelbesteuerung: Kategorie S mit 7 %", () => {
    const inv = { ...sampleInvoice, kleinunternehmer: false, ustSatz: "7" };
    const x = buildXml(inv, compute(inv));
    expect(x).toContain("<ram:CategoryCode>S</ram:CategoryCode><ram:RateApplicablePercent>7</ram:RateApplicablePercent>");
    expect(x).toContain("<ram:CalculatedAmount>25.20</ram:CalculatedAmount>");
    expect(x).toContain("<ram:GrandTotalAmount>385.20</ram:GrandTotalAmount>");
    expect(x).not.toContain("ExemptionReason");
  });
  it("escaped Sonderzeichen", () => {
    expect(xml).toContain("GmbH &amp; Co. KG");
  });
});
