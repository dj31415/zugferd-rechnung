import { compute } from "./calc";
import type { Invoice } from "./model";
import { buildPdf, type PdfAssets } from "./pdf";
import { validate, type ValidationResult } from "./validate";
import { buildXml } from "./xml";

export interface Result { pdf: Uint8Array; xml: string; validation: ValidationResult; basename: string }

/** Kompletter Ablauf: prüfen, rechnen, XML bauen, PDF/A-3 bauen. Wirft bei Validierungsfehlern. */
export async function generate(inv: Invoice, assets: PdfAssets, now?: Date): Promise<Result> {
  const validation = validate(inv);
  if (validation.errors.length) throw new ValidationError(validation);
  const calc = compute(inv);
  const xml = buildXml(inv, calc);
  const pdf = await buildPdf(inv, calc, xml, assets, now);
  const basename = `Rechnung-${inv.nummer.trim().replace(/[^\w.-]+/g, "_")}-zugferd`;
  return { pdf, xml, validation, basename };
}

export class ValidationError extends Error {
  constructor(readonly validation: ValidationResult) { super(validation.errors.map((e) => e.message).join("\n")); }
}
