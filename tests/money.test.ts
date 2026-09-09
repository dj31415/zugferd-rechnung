import { describe, expect, it } from "vitest";
import { centsToDe, centsToXml, divRound, lineTotal, parseCents, parseQuantity, quantityToXml, taxOf } from "../src/lib/money";

describe("parseCents", () => {
  it("akzeptiert deutsche und englische Schreibweise", () => {
    expect(parseCents("5,00")).toBe(500n);
    expect(parseCents("5.00")).toBe(500n);
    expect(parseCents("5")).toBe(500n);
    expect(parseCents("1.234,56")).toBe(123456n);
    expect(parseCents("-0,5")).toBe(-50n);
  });
  it("lehnt Unsinn und zu viele Nachkommastellen ab", () => {
    expect(parseCents("")).toBeNull();
    expect(parseCents("abc")).toBeNull();
    expect(parseCents("1,234")).toBeNull();
  });
});

describe("Rundung", () => {
  it("rundet kaufmännisch", () => {
    expect(divRound(25n, 10n)).toBe(3n);
    expect(divRound(24n, 10n)).toBe(2n);
    expect(divRound(-25n, 10n)).toBe(-3n);
  });
  it("Positionsbetrag und Steuer", () => {
    expect(lineTotal(parseQuantity("52")!, 500n)).toBe(26000n);
    expect(lineTotal(parseQuantity("1,5")!, 333n)).toBe(500n); // 4,995 -> 5,00
    expect(taxOf(36000n, 7)).toBe(2520n);
    expect(taxOf(36000n, 0)).toBe(0n);
    expect(taxOf(1001n, 19)).toBe(190n); // 190,19 -> 190
  });
});

describe("Formatierung", () => {
  it("XML und deutsch", () => {
    expect(centsToXml(123456n)).toBe("1234.56");
    expect(centsToXml(5n)).toBe("0.05");
    expect(centsToDe(123456n)).toBe("1.234,56");
    expect(centsToDe(-5n)).toBe("-0,05");
    expect(quantityToXml(52000n)).toBe("52");
    expect(quantityToXml(1500n)).toBe("1.5");
  });
});
