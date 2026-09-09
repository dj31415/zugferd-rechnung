import fontkit from "@pdf-lib/fontkit";
import { AFRelationship, PDFDocument, PDFArray, PDFDict, PDFFont, PDFHexString, PDFName, PDFPage, PDFString, rgb } from "pdf-lib";
import type { Calc } from "./calc";
import { toGerman } from "./dates";
import { hasLieferort, type Invoice, type Party } from "./model";
import { centsToDe, quantityToDe } from "./money";
import { EXEMPTION_TEXT } from "./xml";

export interface PdfAssets {
  fontRegular: Uint8Array;
  fontBold: Uint8Array;
  iccProfile: Uint8Array; // sRGB
}

const mm = (v: number) => v * 2.834645669;
const A4: [number, number] = [mm(210), mm(297)];
const MARGIN = mm(20);
const GREY = rgb(0.55, 0.55, 0.55);
const LIGHT = rgb(0.9, 0.9, 0.9);
const BLACK = rgb(0, 0, 0);

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Wörter umbrechen, so dass jede Zeile in width passt. */
const wrap = (text: string, font: PDFFont, size: number, width: number): string[] => {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const probe = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(probe, size) <= width || !line) line = probe;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
};

class Writer {
  page!: PDFPage;
  y = 0;
  constructor(readonly doc: PDFDocument, readonly regular: PDFFont, readonly bold: PDFFont) { this.newPage(); }
  newPage() { this.page = this.doc.addPage(A4); this.y = A4[1] - MARGIN; }
  ensure(height: number) { if (this.y - height < MARGIN) this.newPage(); }
  text(s: string, x: number, y: number, opts: { size?: number; bold?: boolean; right?: number } = {}) {
    const size = opts.size ?? 9;
    const font = opts.bold ? this.bold : this.regular;
    const xx = opts.right !== undefined ? opts.right - font.widthOfTextAtSize(s, size) : x;
    this.page.drawText(s, { x: xx, y, size, font, color: BLACK });
  }
  /** Absatz mit Umbruch; gibt verbrauchte Höhe zurück. */
  paragraph(s: string, x: number, width: number, opts: { size?: number; bold?: boolean } = {}) {
    const size = opts.size ?? 9;
    const lines = wrap(s, opts.bold ? this.bold : this.regular, size, width);
    this.ensure(lines.length * size * 1.3);
    for (const l of lines) { this.text(l, x, this.y - size, opts); this.y -= size * 1.3; }
  }
  gap(h: number) { this.y -= h; }
}

const addressLines = (p: Party): string[] => [p.name, p.strasse, `${p.plz} ${p.ort}`, p.gln ? `GLN ${p.gln}` : ""].map((s) => s.trim()).filter(Boolean);

/** Zeichnet die sichtbare Rechnung. */
function drawInvoice(w: Writer, inv: Invoice, calc: Calc) {
  const v = inv.verkaeufer;
  const left = MARGIN;
  const right = A4[0] - MARGIN;
  const width = right - left;

  w.text("Rechnung", left, w.y - 20, { size: 20, bold: true });
  w.gap(26);
  w.text(`${v.name} · ${v.strasse} · ${v.plz} ${v.ort} · GLN ${v.gln}`, left, w.y - 8, { size: 8 });
  w.gap(8 + mm(6));

  // Empfänger links, Metadaten rechts
  const top = w.y;
  w.text("Rechnungsempfänger", left, w.y - 9, { bold: true });
  w.gap(12);
  for (const l of addressLines(inv.kaeufer)) { w.text(l, left, w.y - 9); w.gap(12); }
  const afterAddr = w.y;
  w.y = top;
  const meta: [string, string][] = [
    ["Rechnungs-Nr.", inv.nummer], ["Rechnungsdatum", toGerman(inv.datum)],
    ["Leistungsdatum", toGerman(inv.leistungsdatum || inv.datum)], ["Fällig am", toGerman(inv.faelligkeit)],
    ["Bestell-Nr.", inv.bestellnummer], ["Lieferschein-Nr.", inv.lieferscheinnummer], ["Partner-Nr. (RALA)", v.ralaNummer],
    ["Kundenreferenz", inv.kaeuferReferenz],
  ];
  const metaX = left + width / 2;
  for (const [k, val] of meta) {
    if (!val.trim()) continue;
    w.text(k, metaX, w.y - 9); w.text(val, metaX + mm(40), w.y - 9); w.gap(12);
  }
  w.y = Math.min(afterAddr, w.y);

  if (hasLieferort(inv)) {
    w.gap(mm(4));
    w.text("Lieferanschrift", left, w.y - 9, { bold: true }); w.gap(12);
    for (const l of addressLines(inv.lieferort)) { w.text(l, left, w.y - 9); w.gap(12); }
  }
  w.gap(mm(8));

  // Positionstabelle
  const cols = [10, 67, 25, 18, 25, 25].map(mm);
  const xs = cols.reduce<number[]>((acc, c, i) => [...acc, (acc[i] ?? left) + c], [left]);
  const heads = ["Pos", "Beschreibung", "Art.-Nr.", "Menge", "Einzelpreis", "Gesamt"];
  const rowH = 14;
  const pad = 3;
  const header = () => {
    w.ensure(rowH);
    w.page.drawRectangle({ x: left, y: w.y - rowH, width, height: rowH, color: LIGHT, borderColor: GREY, borderWidth: 0.3 });
    heads.forEach((h, i) => w.text(h, xs[i] + pad, w.y - 10, { bold: true, right: i >= 3 ? xs[i + 1] - pad : undefined }));
    w.gap(rowH);
  };
  header();
  for (const l of calc.lines) {
    const descLines = wrap(l.beschreibung, w.regular, 9, cols[1] - 2 * pad);
    const h = Math.max(rowH, descLines.length * 12 + 4);
    if (w.y - h < MARGIN) { w.newPage(); header(); }
    w.page.drawRectangle({ x: left, y: w.y - h, width, height: h, borderColor: GREY, borderWidth: 0.3 });
    for (const x of xs.slice(1, -1)) w.page.drawLine({ start: { x, y: w.y }, end: { x, y: w.y - h }, thickness: 0.3, color: GREY });
    const ty = w.y - 10;
    w.text(String(l.nr), xs[0] + pad, ty);
    descLines.forEach((d, i) => w.text(d, xs[1] + pad, ty - i * 12));
    w.text(l.artikelnummer, xs[2] + pad, ty);
    w.text(quantityToDe(l.qty), 0, ty, { right: xs[4] - pad });
    w.text(centsToDe(l.price), 0, ty, { right: xs[5] - pad });
    w.text(centsToDe(l.total), 0, ty, { right: xs[6] - pad });
    w.gap(h);
  }

  // Summen
  w.gap(mm(4));
  const sums: [string, string, boolean][] = [["Nettobetrag", `${centsToDe(calc.net)} €`, false]];
  if (calc.category === "E") sums.push(["Umsatzsteuer", "0,00 € (§ 19 UStG)", false]);
  else sums.push([`zzgl. ${String(calc.rate).replace(".", ",")} % USt`, `${centsToDe(calc.tax)} €`, false]);
  sums.push(["Rechnungsbetrag", `${centsToDe(calc.gross)} €`, true]);
  for (const [k, val, b] of sums) {
    w.ensure(rowH);
    w.text(k, xs[3] + pad, w.y - 10, { bold: b }); w.text(val, 0, w.y - 10, { bold: b, right: right - pad }); w.gap(rowH);
  }
  w.gap(mm(8));

  if (calc.category === "E") w.paragraph(`${EXEMPTION_TEXT}.`, left, width);
  const konto = v.kontoinhaber.trim() || v.name;
  w.paragraph(`Zahlbar bis ${toGerman(inv.faelligkeit)} ohne Abzug auf: IBAN ${v.iban}${v.bic ? `, BIC ${v.bic}` : ""}, Kontoinhaber ${konto}`, left, width);
  const ids = [v.steuernummer && `Steuernummer ${v.steuernummer}`, v.ustId && `USt-IdNr. ${v.ustId}`].filter(Boolean).join(" · ");
  w.gap(4);
  w.paragraph(ids, left, width, { size: 8 });
}

const pdfDate = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z"); // xmp: 2024-07-08T10:00:00Z

/** XMP-Metadaten mit PDF/A-3b-Kennung und Factur-X-Erweiterungsschema. */
function buildXmp(o: { title: string; author: string; subject: string; keywords: string; producer: string; creator: string; created: Date }): string {
  const d = pdfDate(o.created);
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
   <pdfaid:part>3</pdfaid:part>
   <pdfaid:conformance>B</pdfaid:conformance>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
   <dc:format>application/pdf</dc:format>
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlEsc(o.title)}</rdf:li></rdf:Alt></dc:title>
   <dc:creator><rdf:Seq><rdf:li>${xmlEsc(o.author)}</rdf:li></rdf:Seq></dc:creator>
   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${xmlEsc(o.subject)}</rdf:li></rdf:Alt></dc:description>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
   <pdf:Producer>${xmlEsc(o.producer)}</pdf:Producer>
   <pdf:Keywords>${xmlEsc(o.keywords)}</pdf:Keywords>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
   <xmp:CreatorTool>${xmlEsc(o.creator)}</xmp:CreatorTool>
   <xmp:CreateDate>${d}</xmp:CreateDate>
   <xmp:ModifyDate>${d}</xmp:ModifyDate>
   <xmp:MetadataDate>${d}</xmp:MetadataDate>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
   <pdfaExtension:schemas>
    <rdf:Bag>
     <rdf:li rdf:parseType="Resource">
      <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
      <pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>
      <pdfaSchema:prefix>fx</pdfaSchema:prefix>
      <pdfaSchema:property>
       <rdf:Seq>
        <rdf:li rdf:parseType="Resource">
         <pdfaProperty:name>DocumentFileName</pdfaProperty:name>
         <pdfaProperty:valueType>Text</pdfaProperty:valueType>
         <pdfaProperty:category>external</pdfaProperty:category>
         <pdfaProperty:description>The name of the embedded XML document</pdfaProperty:description>
        </rdf:li>
        <rdf:li rdf:parseType="Resource">
         <pdfaProperty:name>DocumentType</pdfaProperty:name>
         <pdfaProperty:valueType>Text</pdfaProperty:valueType>
         <pdfaProperty:category>external</pdfaProperty:category>
         <pdfaProperty:description>The type of the hybrid document in capital letters, e.g. INVOICE or ORDER</pdfaProperty:description>
        </rdf:li>
        <rdf:li rdf:parseType="Resource">
         <pdfaProperty:name>Version</pdfaProperty:name>
         <pdfaProperty:valueType>Text</pdfaProperty:valueType>
         <pdfaProperty:category>external</pdfaProperty:category>
         <pdfaProperty:description>The actual version of the standard applying to the embedded XML document</pdfaProperty:description>
        </rdf:li>
        <rdf:li rdf:parseType="Resource">
         <pdfaProperty:name>ConformanceLevel</pdfaProperty:name>
         <pdfaProperty:valueType>Text</pdfaProperty:valueType>
         <pdfaProperty:category>external</pdfaProperty:category>
         <pdfaProperty:description>The conformance level of the embedded XML document</pdfaProperty:description>
        </rdf:li>
       </rdf:Seq>
      </pdfaSchema:property>
     </rdf:li>
    </rdf:Bag>
   </pdfaExtension:schemas>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">
   <fx:DocumentType>INVOICE</fx:DocumentType>
   <fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>
   <fx:Version>1.0</fx:Version>
   <fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

const PRODUCER = "zugferd-rechnung (pdf-lib)";

/** Erzeugt das fertige PDF/A-3b mit eingebetteter factur-x.xml. */
export async function buildPdf(inv: Invoice, calc: Calc, xml: string, assets: PdfAssets, now: Date = new Date()): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(assets.fontRegular, { subset: true });
  const bold = await doc.embedFont(assets.fontBold, { subset: true });
  drawInvoice(new Writer(doc, regular, bold), inv, calc);

  const created = new Date(Math.floor(now.getTime() / 1000) * 1000); // Sekundengenau, damit Info und XMP übereinstimmen
  const title = `Rechnung ${inv.nummer}`;
  const subject = `Rechnung ${inv.nummer} an ${inv.kaeufer.name}`;
  const keywords = "Rechnung, Factur-X, ZUGFeRD";
  doc.setTitle(title); doc.setAuthor(inv.verkaeufer.name); doc.setSubject(subject); doc.setKeywords([keywords]);
  doc.setProducer(PRODUCER); doc.setCreator(PRODUCER); doc.setCreationDate(created); doc.setModificationDate(created);

  // Eingebettete Rechnung (AFRelationship Alternative, wie von Factur-X gefordert)
  const xmlBytes = new TextEncoder().encode(xml);
  await doc.attach(xmlBytes, "factur-x.xml", {
    mimeType: "text/xml", description: "Factur-X/ZUGFeRD-Rechnung (EN 16931)",
    creationDate: created, modificationDate: created, afRelationship: AFRelationship.Alternative,
  });
  await doc.flush();
  const ctx = doc.context;
  const embeddedNames = doc.catalog.lookup(PDFName.of("Names"), PDFDict).lookup(PDFName.of("EmbeddedFiles"), PDFDict).lookup(PDFName.of("Names"), PDFArray);
  const fileSpecRefs = embeddedNames.asArray().filter((_, i) => i % 2 === 1);
  doc.catalog.set(PDFName.of("AF"), ctx.obj(fileSpecRefs));

  // OutputIntent (sRGB), Pflicht sobald DeviceRGB verwendet wird
  const icc = ctx.flateStream(assets.iccProfile, { N: 3 });
  const intent = ctx.obj({
    Type: "OutputIntent", S: "GTS_PDFA1",
    OutputConditionIdentifier: PDFString.of("sRGB IEC61966-2.1"), Info: PDFString.of("sRGB IEC61966-2.1"),
    RegistryName: PDFString.of("http://www.color.org"), DestOutputProfile: ctx.register(icc),
  });
  doc.catalog.set(PDFName.of("OutputIntents"), ctx.obj([ctx.register(intent)]));

  // XMP-Metadaten (unkomprimiert)
  const xmp = buildXmp({ title, author: inv.verkaeufer.name, subject, keywords, producer: PRODUCER, creator: PRODUCER, created });
  const meta = ctx.stream(new TextEncoder().encode(xmp), { Type: "Metadata", Subtype: "XML" });
  doc.catalog.set(PDFName.of("Metadata"), ctx.register(meta));

  // Datei-Identifikator im Trailer (PDF/A 6.1.3)
  const idHex = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  ctx.trailerInfo.ID = ctx.obj([PDFHexString.of(idHex), PDFHexString.of(idHex)]);

  return doc.save({ updateFieldAppearances: false, useObjectStreams: false });
}
