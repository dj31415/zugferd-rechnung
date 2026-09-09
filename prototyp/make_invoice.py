# /// script
# requires-python = ">=3.11"
# dependencies = ["factur-x>=3.1", "reportlab>=4", "pyyaml>=6"]
# ///
"""
ZUGFeRD/Factur-X-Rechnung (Profil EN 16931) aus YAML erzeugen.

    cd prototyp && uv run --script make_invoice.py rechnung.yaml [ausgabe.pdf]

Erzeugt ein PDF mit sichtbarer Rechnung und eingebettetem factur-x.xml,
inkl. der von Markant geprüften Felder (GLN als GlobalID 0088,
Partnernummer, Bestell- und Lieferscheinnummer).
"""
import sys, re, io
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from xml.sax.saxutils import escape as esc
import yaml
from facturx import generate_from_binary, xml_check_xsd
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, DictionaryObject, NameObject, TextStringObject, NumberObject, StreamObject
from pathlib import Path
ASSETS = Path(__file__).parent.parent / "src" / "assets"
pdfmetrics.registerFont(TTFont("Sans", str(ASSETS / "DejaVuSans.ttf")))
pdfmetrics.registerFont(TTFont("Sans-Bold", str(ASSETS / "DejaVuSans-Bold.ttf")))
from reportlab.pdfbase.pdfmetrics import registerFontFamily
registerFontFamily("Sans", normal="Sans", bold="Sans-Bold", italic="Sans", boldItalic="Sans-Bold")
from reportlab import rl_config; rl_config.canvas_basefontname = "Sans"

D = lambda x: Decimal(str(x)).quantize(Decimal("0.01"), ROUND_HALF_UP)
def fmt(x): return f"{D(x):.2f}".replace(".", ",")
def d102(d): return (d if isinstance(d, date) else date.fromisoformat(str(d))).strftime("%Y%m%d")
def dde(d):  return (d if isinstance(d, date) else date.fromisoformat(str(d))).strftime("%d.%m.%Y")

# ---------- Validierung der Eingabe ----------
def check(cfg):
    problems, warnings = [], []
    def is_todo(v): return v is None or str(v).strip() == "" or "TODO" in str(v)
    def gln_ok(v): return bool(re.fullmatch(r"\d{13}", str(v))) and gs1_check(str(v))
    for who in ("verkaeufer", "kaeufer"):
        g = cfg[who].get("gln")
        if is_todo(g) or not gln_ok(g):
            problems.append(f"{who}.gln fehlt oder ist keine gültige 13-stellige GLN: {g!r}")
    if "lieferort" in cfg and not gln_ok(cfg["lieferort"].get("gln", "")):
        problems.append(f"lieferort.gln ungültig: {cfg['lieferort'].get('gln')!r}")
    v = cfg["verkaeufer"]
    if is_todo(v.get("steuernummer")) and is_todo(v.get("ust_id")):
        problems.append("verkaeufer: steuernummer oder ust_id ist Pflicht (EN 16931 BR-CO-26)")
    for f in ("rala_nummer",):
        if is_todo(v.get(f)): warnings.append(f"verkaeufer.{f} fehlt (Markant-Prüfung)")
    for f in ("bestellnummer", "lieferscheinnummer"):
        if is_todo(cfg.get(f)): warnings.append(f"{f} fehlt (Markant-Prüfung)")
    if not cfg.get("kleinunternehmer") and cfg.get("ust_satz") is None:
        problems.append("ust_satz fehlt oder kleinunternehmer: true setzen")
    return problems, warnings

def gs1_check(s):
    digits = [int(c) for c in s]
    total = sum(d * (3 if (len(digits) - i) % 2 == 0 else 1) for i, d in enumerate(digits[:-1]))
    return (10 - total % 10) % 10 == digits[-1]

# ---------- Berechnung ----------
def compute(cfg):
    lines = []
    for i, p in enumerate(cfg["positionen"], 1):
        total = D(Decimal(str(p["menge"])) * Decimal(str(p["einzelpreis"])))
        lines.append({**p, "nr": i, "gesamt": total})
    net = sum((l["gesamt"] for l in lines), Decimal("0"))
    if cfg.get("kleinunternehmer"):
        rate, cat = Decimal("0"), "E"
    else:
        rate, cat = Decimal(str(cfg["ust_satz"])), "S"
    tax = D(net * rate / 100)
    return lines, net, tax, D(net + tax), rate, cat

# ---------- XML (UN/CEFACT CII, EN 16931) ----------
def party(tag, p, extra_id=None, tax=False):
    x = [f"<ram:{tag}>"]
    if extra_id: x.append(f"<ram:ID>{esc(extra_id)}</ram:ID>")
    if p.get("gln"): x.append(f'<ram:GlobalID schemeID="0088">{esc(str(p["gln"]))}</ram:GlobalID>')
    x.append(f"<ram:Name>{esc(p['name'])}</ram:Name>")
    x.append("<ram:PostalTradeAddress>"
             f"<ram:PostcodeCode>{esc(str(p['plz']))}</ram:PostcodeCode>"
             f"<ram:LineOne>{esc(p['strasse'])}</ram:LineOne>"
             f"<ram:CityName>{esc(p['ort'])}</ram:CityName>"
             f"<ram:CountryID>{esc(p.get('land','DE'))}</ram:CountryID>"
             "</ram:PostalTradeAddress>")
    if tax:
        if p.get("steuernummer") and "TODO" not in str(p["steuernummer"]):
            x.append(f'<ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">{esc(str(p["steuernummer"]))}</ram:ID></ram:SpecifiedTaxRegistration>')
        if p.get("ust_id"):
            x.append(f'<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">{esc(p["ust_id"])}</ram:ID></ram:SpecifiedTaxRegistration>')
    x.append(f"</ram:{tag}>")
    return "".join(x)

def build_xml(cfg, lines, net, tax, gross, rate, cat):
    cur = cfg.get("waehrung", "EUR")
    v, b = cfg["verkaeufer"], cfg["kaeufer"]
    ok = lambda s: s and "TODO" not in str(s)
    items = []
    for l in lines:
        prod = ""
        if ok(l.get("gtin")): prod += f'<ram:GlobalID schemeID="0160">{esc(str(l["gtin"]))}</ram:GlobalID>'
        if ok(l.get("artikelnummer")): prod += f"<ram:BuyerAssignedID>{esc(str(l['artikelnummer']))}</ram:BuyerAssignedID>"
        prod += f"<ram:Name>{esc(l['beschreibung'])}</ram:Name>"
        items.append(
            "<ram:IncludedSupplyChainTradeLineItem>"
            f"<ram:AssociatedDocumentLineDocument><ram:LineID>{l['nr']}</ram:LineID></ram:AssociatedDocumentLineDocument>"
            f"<ram:SpecifiedTradeProduct>{prod}</ram:SpecifiedTradeProduct>"
            "<ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice>"
            f"<ram:ChargeAmount>{D(l['einzelpreis'])}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>"
            f"<ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode=\"{esc(l.get('einheit','H87'))}\">{l['menge']}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>"
            "<ram:SpecifiedLineTradeSettlement>"
            f"<ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>{cat}</ram:CategoryCode><ram:RateApplicablePercent>{rate}</ram:RateApplicablePercent></ram:ApplicableTradeTax>"
            f"<ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>{l['gesamt']}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>"
            "</ram:SpecifiedLineTradeSettlement>"
            "</ram:IncludedSupplyChainTradeLineItem>")

    agreement = "<ram:ApplicableHeaderTradeAgreement>"
    if ok(cfg.get("kaeufer_referenz")): agreement += f"<ram:BuyerReference>{esc(cfg['kaeufer_referenz'])}</ram:BuyerReference>"
    agreement += party("SellerTradeParty", v, extra_id=v["rala_nummer"] if ok(v.get("rala_nummer")) else None, tax=True)
    agreement += party("BuyerTradeParty", b)
    if ok(cfg.get("bestellnummer")):
        agreement += f"<ram:BuyerOrderReferencedDocument><ram:IssuerAssignedID>{esc(str(cfg['bestellnummer']))}</ram:IssuerAssignedID></ram:BuyerOrderReferencedDocument>"
    agreement += "</ram:ApplicableHeaderTradeAgreement>"

    delivery = "<ram:ApplicableHeaderTradeDelivery>"
    if cfg.get("lieferort"): delivery += party("ShipToTradeParty", cfg["lieferort"])
    delivery += f'<ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime><udt:DateTimeString format="102">{d102(cfg.get("leistungsdatum", cfg["datum"]))}</udt:DateTimeString></ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent>'
    if ok(cfg.get("lieferscheinnummer")):
        delivery += f"<ram:DespatchAdviceReferencedDocument><ram:IssuerAssignedID>{esc(str(cfg['lieferscheinnummer']))}</ram:IssuerAssignedID></ram:DespatchAdviceReferencedDocument>"
    delivery += "</ram:ApplicableHeaderTradeDelivery>"

    exemption = "<ram:ExemptionReason>Kein Ausweis von Umsatzsteuer, da Kleinunternehmer gemäß § 19 UStG</ram:ExemptionReason>" if cat == "E" else ""
    settlement = (
        "<ram:ApplicableHeaderTradeSettlement>"
        f"<ram:InvoiceCurrencyCode>{cur}</ram:InvoiceCurrencyCode>"
        "<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>58</ram:TypeCode>"
        f"<ram:PayeePartyCreditorFinancialAccount><ram:IBANID>{esc(v['iban'].replace(' ', ''))}</ram:IBANID>"
        f"<ram:AccountName>{esc(v.get('kontoinhaber', v['name']))}</ram:AccountName></ram:PayeePartyCreditorFinancialAccount>"
        f"<ram:PayeeSpecifiedCreditorFinancialInstitution><ram:BICID>{esc(v['bic'])}</ram:BICID></ram:PayeeSpecifiedCreditorFinancialInstitution>"
        "</ram:SpecifiedTradeSettlementPaymentMeans>"
        f"<ram:ApplicableTradeTax><ram:CalculatedAmount>{tax}</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode>{exemption}"
        f"<ram:BasisAmount>{net}</ram:BasisAmount><ram:CategoryCode>{cat}</ram:CategoryCode><ram:RateApplicablePercent>{rate}</ram:RateApplicablePercent></ram:ApplicableTradeTax>"
        f"<ram:SpecifiedTradePaymentTerms><ram:Description>Zahlbar bis {dde(cfg['faelligkeit'])} ohne Abzug</ram:Description>"
        f'<ram:DueDateDateTime><udt:DateTimeString format="102">{d102(cfg["faelligkeit"])}</udt:DateTimeString></ram:DueDateDateTime></ram:SpecifiedTradePaymentTerms>'
        "<ram:SpecifiedTradeSettlementHeaderMonetarySummation>"
        f"<ram:LineTotalAmount>{net}</ram:LineTotalAmount><ram:TaxBasisTotalAmount>{net}</ram:TaxBasisTotalAmount>"
        f'<ram:TaxTotalAmount currencyID="{cur}">{tax}</ram:TaxTotalAmount><ram:GrandTotalAmount>{gross}</ram:GrandTotalAmount>'
        f"<ram:DuePayableAmount>{gross}</ram:DuePayableAmount>"
        "</ram:SpecifiedTradeSettlementHeaderMonetarySummation>"
        "</ram:ApplicableHeaderTradeSettlement>")

    return ('<?xml version="1.0" encoding="UTF-8"?>'
        '<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" '
        'xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" '
        'xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" '
        'xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">'
        "<rsm:ExchangedDocumentContext><ram:GuidelineSpecifiedDocumentContextParameter>"
        "<ram:ID>urn:cen.eu:en16931:2017</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>"
        f"<rsm:ExchangedDocument><ram:ID>{esc(str(cfg['nummer']))}</ram:ID><ram:TypeCode>380</ram:TypeCode>"
        f'<ram:IssueDateTime><udt:DateTimeString format="102">{d102(cfg["datum"])}</udt:DateTimeString></ram:IssueDateTime></rsm:ExchangedDocument>'
        f"<rsm:SupplyChainTradeTransaction>{''.join(items)}{agreement}{delivery}{settlement}</rsm:SupplyChainTradeTransaction>"
        "</rsm:CrossIndustryInvoice>").encode()

# ---------- PDF ----------
def build_pdf(cfg, lines, net, tax, gross, rate, cat):
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=20*mm, rightMargin=20*mm, topMargin=20*mm, bottomMargin=20*mm, initialFontName="Sans")
    st = getSampleStyleSheet(); N = st["Normal"]; H = st["Title"]
    N.fontName = "Sans"; H.fontName = "Sans-Bold"; N.bulletFontName = H.bulletFontName = "Sans"
    v, b = cfg["verkaeufer"], cfg["kaeufer"]
    P = lambda t: Paragraph(t, N)
    def addr(p): return f"{esc(p['name'])}<br/>{esc(p['strasse'])}<br/>{esc(str(p['plz']))} {esc(p['ort'])}<br/>GLN {esc(str(p.get('gln','')))}"
    meta = [["Rechnungs-Nr.", str(cfg["nummer"])], ["Rechnungsdatum", dde(cfg["datum"])],
            ["Leistungsdatum", dde(cfg.get("leistungsdatum", cfg["datum"]))], ["Fällig am", dde(cfg["faelligkeit"])],
            ["Bestell-Nr.", str(cfg.get("bestellnummer",""))], ["Lieferschein-Nr.", str(cfg.get("lieferscheinnummer",""))],
            ["Partner-Nr. (RALA)", str(v.get("rala_nummer",""))]]
    story = [Paragraph("Rechnung", H),
             P(f"<font size=8>{esc(v['name'])}, {esc(v['strasse'])}, {v['plz']} {esc(v['ort'])} · GLN {v.get('gln','')}</font>"), Spacer(1, 6*mm),
             Table([[P("<b>Rechnungsempfänger</b><br/>"+addr(b)), Table(meta, colWidths=[40*mm, 45*mm], style=[("FONTSIZE",(0,0),(-1,-1),9),("FONTNAME",(0,0),(-1,-1),"Sans")])]],
                   colWidths=[85*mm, 85*mm], style=[("VALIGN",(0,0),(-1,-1),"TOP"), ("FONTNAME",(0,0),(-1,-1),"Sans")])]
    if cfg.get("lieferort"):
        story += [Spacer(1, 4*mm), P("<b>Lieferanschrift</b><br/>" + addr(cfg["lieferort"]))]
    story.append(Spacer(1, 8*mm))
    rows = [["Pos", "Beschreibung", "Art.-Nr.", "Menge", "Einzelpreis", "Gesamt"]]
    for l in lines:
        rows.append([l["nr"], P(esc(l["beschreibung"])), l.get("artikelnummer",""), str(l["menge"]), fmt(l["einzelpreis"]), fmt(l["gesamt"])])
    t = Table(rows, colWidths=[12*mm, 68*mm, 25*mm, 18*mm, 25*mm, 25*mm], repeatRows=1)
    t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),colors.lightgrey), ("GRID",(0,0),(-1,-1),0.3,colors.grey),
                           ("ALIGN",(3,1),(-1,-1),"RIGHT"), ("FONTSIZE",(0,0),(-1,-1),9), ("FONTNAME",(0,0),(-1,-1),"Sans"), ("FONTNAME",(0,0),(-1,0),"Sans-Bold"), ("VALIGN",(0,0),(-1,-1),"TOP")]))
    story.append(t)
    sums = [["Nettobetrag", fmt(net)+" €"]]
    if cat == "E": sums.append(["Umsatzsteuer", "0,00 € (§ 19 UStG)"])
    else: sums.append([f"zzgl. {rate} % USt", fmt(tax)+" €"])
    sums.append(["Rechnungsbetrag", fmt(gross)+" €"])
    ts = Table(sums, colWidths=[123*mm, 50*mm], style=[("ALIGN",(1,0),(1,-1),"RIGHT"), ("FONTNAME",(0,0),(-1,-1),"Sans"), ("FONTNAME",(0,-1),(-1,-1),"Sans-Bold")])
    story += [Spacer(1, 4*mm), ts, Spacer(1, 8*mm)]
    if cat == "E": story.append(P("Kein Ausweis von Umsatzsteuer, da Kleinunternehmer gemäß § 19 UStG."))
    story.append(P(f"Zahlbar bis {dde(cfg['faelligkeit'])} ohne Abzug auf: {esc(v['iban'])}, BIC {esc(v['bic'])}, Kontoinhaber {esc(v.get('kontoinhaber', v['name']))}"))
    ids = [f"Steuernummer {v['steuernummer']}" if v.get("steuernummer") else "", f"USt-IdNr. {v['ust_id']}" if v.get("ust_id") else ""]
    story.append(P("<font size=8>" + " · ".join(i for i in ids if i) + "</font>"))
    doc.build(story)
    return buf.getvalue()

def add_output_intent(pdf_bytes):
    """PDF/A-3 verlangt ein OutputIntent mit RGB-Profil, sobald DeviceRGB verwendet wird."""
    r = PdfReader(io.BytesIO(pdf_bytes)); w = PdfWriter(clone_from=r)
    icc = StreamObject(); icc.set_data((ASSETS / "srgb.icc").read_bytes())
    icc.update({NameObject("/N"): NumberObject(3)})
    icc_ref = w._add_object(icc)
    oi = DictionaryObject({NameObject("/Type"): NameObject("/OutputIntent"), NameObject("/S"): NameObject("/GTS_PDFA1"),
        NameObject("/OutputConditionIdentifier"): TextStringObject("sRGB IEC61966-2.1"),
        NameObject("/Info"): TextStringObject("sRGB IEC61966-2.1"), NameObject("/RegistryName"): TextStringObject("http://www.color.org"),
        NameObject("/DestOutputProfile"): icc_ref})
    w._root_object[NameObject("/OutputIntents")] = ArrayObject([w._add_object(oi)])
    out = io.BytesIO(); w.write(out); return out.getvalue()

def main():
    if len(sys.argv) < 2: sys.exit(__doc__)
    cfg = yaml.safe_load(open(sys.argv[1], encoding="utf-8"))
    out = sys.argv[2] if len(sys.argv) > 2 else f"Rechnung-{cfg['nummer']}-zugferd.pdf"
    problems, warnings = check(cfg)
    for w in warnings: print("WARNUNG:", w)
    if problems:
        print("\n".join("FEHLER: " + p for p in problems)); sys.exit(1)
    lines, net, tax, gross, rate, cat = compute(cfg)
    xml = build_xml(cfg, lines, net, tax, gross, rate, cat)
    xml_check_xsd(xml, flavor="factur-x", level="en16931")
    pdf = build_pdf(cfg, lines, net, tax, gross, rate, cat)
    result = generate_from_binary(pdf, xml, flavor="factur-x", level="en16931", check_xsd=False,
                                  pdf_metadata={"author": cfg["verkaeufer"]["name"], "title": f"Rechnung {cfg['nummer']}",
                                                "subject": f"Rechnung {cfg['nummer']} an {cfg['kaeufer']['name']}", "keywords": "Rechnung, Factur-X, ZUGFeRD"})
    result = add_output_intent(result)
    open(out, "wb").write(result)
    open(out.replace(".pdf", ".xml"), "wb").write(xml)
    print(f"OK: {out}  (netto {fmt(net)} / USt {fmt(tax)} / brutto {fmt(gross)} €) – XSD-Prüfung bestanden")
    print("Nächster Schritt: PDF bei https://valitool.org (Profil Markant) hochladen.")

if __name__ == "__main__":
    main()
