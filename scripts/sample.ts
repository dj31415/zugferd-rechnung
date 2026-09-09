/** Erzeugt aus den Beispieldaten PDF und XML nach out/ – für CI-Validierung (veraPDF, Mustang). */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { generate } from "../src/lib/generate";
import { sampleInvoice } from "../src/sample";

const assets = {
  fontRegular: new Uint8Array(readFileSync("src/assets/DejaVuSans.ttf")),
  fontBold: new Uint8Array(readFileSync("src/assets/DejaVuSans-Bold.ttf")),
  iccProfile: new Uint8Array(readFileSync("src/assets/srgb.icc")),
};
const variants = {
  kleinunternehmer: sampleInvoice,
  regelbesteuert: { ...sampleInvoice, nummer: "2024-002", kleinunternehmer: false, ustSatz: "7" },
};
mkdirSync("out", { recursive: true });
for (const [name, inv] of Object.entries(variants)) {
  const r = await generate(inv, assets);
  writeFileSync(`out/${name}.pdf`, r.pdf);
  writeFileSync(`out/${name}.xml`, r.xml);
  console.log(`out/${name}.pdf (${r.pdf.length} Bytes), Warnungen: ${r.validation.warnings.length}`);
}
