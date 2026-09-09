import type { Calc } from "./calc";
import { toFormat102, toGerman } from "./dates";
import { hasLieferort, type Invoice, type Party, type Seller } from "./model";
import { centsToXml, quantityToXml } from "./money";

export const EXEMPTION_TEXT = "Kein Ausweis von Umsatzsteuer, da Kleinunternehmer gemäß § 19 UStG";

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const has = (s: string | undefined): s is string => !!s && s.trim() !== "";
const t = (s: string) => s.trim();

const party = (tag: string, p: Party, opts: { id?: string; seller?: Seller } = {}): string => {
  let x = `<ram:${tag}>`;
  if (has(opts.id)) x += `<ram:ID>${esc(t(opts.id))}</ram:ID>`;
  if (has(p.gln)) x += `<ram:GlobalID schemeID="0088">${esc(t(p.gln))}</ram:GlobalID>`;
  x += `<ram:Name>${esc(t(p.name))}</ram:Name>`;
  x += "<ram:PostalTradeAddress>"
    + `<ram:PostcodeCode>${esc(t(p.plz))}</ram:PostcodeCode>`
    + `<ram:LineOne>${esc(t(p.strasse))}</ram:LineOne>`
    + `<ram:CityName>${esc(t(p.ort))}</ram:CityName>`
    + `<ram:CountryID>${esc(t(p.land) || "DE")}</ram:CountryID>`
    + "</ram:PostalTradeAddress>";
  if (opts.seller) {
    if (has(opts.seller.steuernummer)) x += `<ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">${esc(t(opts.seller.steuernummer))}</ram:ID></ram:SpecifiedTaxRegistration>`;
    if (has(opts.seller.ustId)) x += `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${esc(t(opts.seller.ustId).replace(/\s/g, ""))}</ram:ID></ram:SpecifiedTaxRegistration>`;
  }
  return x + `</ram:${tag}>`;
};

/** Factur-X / ZUGFeRD 2.x, Profil EN 16931 (COMFORT), UN/CEFACT Cross Industry Invoice D16B. */
export function buildXml(inv: Invoice, calc: Calc): string {
  const cur = t(inv.waehrung) || "EUR";
  const v = inv.verkaeufer;
  const rate = String(calc.rate);
  const cat = calc.category;

  const items = calc.lines.map((l) => {
    let prod = "";
    if (has(l.gtin)) prod += `<ram:GlobalID schemeID="0160">${esc(l.gtin)}</ram:GlobalID>`;
    if (has(l.artikelnummer)) prod += `<ram:BuyerAssignedID>${esc(l.artikelnummer)}</ram:BuyerAssignedID>`;
    prod += `<ram:Name>${esc(l.beschreibung)}</ram:Name>`;
    return "<ram:IncludedSupplyChainTradeLineItem>"
      + `<ram:AssociatedDocumentLineDocument><ram:LineID>${l.nr}</ram:LineID></ram:AssociatedDocumentLineDocument>`
      + `<ram:SpecifiedTradeProduct>${prod}</ram:SpecifiedTradeProduct>`
      + `<ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${centsToXml(l.price)}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>`
      + `<ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="${esc(l.einheit)}">${quantityToXml(l.qty)}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>`
      + "<ram:SpecifiedLineTradeSettlement>"
      + `<ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>${cat}</ram:CategoryCode><ram:RateApplicablePercent>${rate}</ram:RateApplicablePercent></ram:ApplicableTradeTax>`
      + `<ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${centsToXml(l.total)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>`
      + "</ram:SpecifiedLineTradeSettlement>"
      + "</ram:IncludedSupplyChainTradeLineItem>";
  }).join("");

  let agreement = "<ram:ApplicableHeaderTradeAgreement>";
  if (has(inv.kaeuferReferenz)) agreement += `<ram:BuyerReference>${esc(t(inv.kaeuferReferenz))}</ram:BuyerReference>`;
  agreement += party("SellerTradeParty", v, { id: v.ralaNummer, seller: v });
  agreement += party("BuyerTradeParty", inv.kaeufer);
  if (has(inv.bestellnummer)) agreement += `<ram:BuyerOrderReferencedDocument><ram:IssuerAssignedID>${esc(t(inv.bestellnummer))}</ram:IssuerAssignedID></ram:BuyerOrderReferencedDocument>`;
  agreement += "</ram:ApplicableHeaderTradeAgreement>";

  const leistung = has(inv.leistungsdatum) ? inv.leistungsdatum : inv.datum;
  let delivery = "<ram:ApplicableHeaderTradeDelivery>";
  if (hasLieferort(inv)) delivery += party("ShipToTradeParty", inv.lieferort);
  delivery += `<ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime><udt:DateTimeString format="102">${toFormat102(leistung)}</udt:DateTimeString></ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent>`;
  if (has(inv.lieferscheinnummer)) delivery += `<ram:DespatchAdviceReferencedDocument><ram:IssuerAssignedID>${esc(t(inv.lieferscheinnummer))}</ram:IssuerAssignedID></ram:DespatchAdviceReferencedDocument>`;
  delivery += "</ram:ApplicableHeaderTradeDelivery>";

  const exemption = cat === "E" ? `<ram:ExemptionReason>${esc(EXEMPTION_TEXT)}</ram:ExemptionReason>` : "";
  const bic = t(v.bic).replace(/\s/g, "").toUpperCase();
  const settlement = "<ram:ApplicableHeaderTradeSettlement>"
    + `<ram:InvoiceCurrencyCode>${esc(cur)}</ram:InvoiceCurrencyCode>`
    + "<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>58</ram:TypeCode>"
    + `<ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${esc(t(v.iban).replace(/\s/g, "").toUpperCase())}</ram:IBANID>`
    + `<ram:AccountName>${esc(t(v.kontoinhaber) || t(v.name))}</ram:AccountName></ram:PayeePartyCreditorFinancialAccount>`
    + (bic ? `<ram:PayeeSpecifiedCreditorFinancialInstitution><ram:BICID>${esc(bic)}</ram:BICID></ram:PayeeSpecifiedCreditorFinancialInstitution>` : "")
    + "</ram:SpecifiedTradeSettlementPaymentMeans>"
    + `<ram:ApplicableTradeTax><ram:CalculatedAmount>${centsToXml(calc.tax)}</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode>${exemption}`
    + `<ram:BasisAmount>${centsToXml(calc.net)}</ram:BasisAmount><ram:CategoryCode>${cat}</ram:CategoryCode><ram:RateApplicablePercent>${rate}</ram:RateApplicablePercent></ram:ApplicableTradeTax>`
    + `<ram:SpecifiedTradePaymentTerms><ram:Description>Zahlbar bis ${toGerman(inv.faelligkeit)} ohne Abzug</ram:Description>`
    + `<ram:DueDateDateTime><udt:DateTimeString format="102">${toFormat102(inv.faelligkeit)}</udt:DateTimeString></ram:DueDateDateTime></ram:SpecifiedTradePaymentTerms>`
    + "<ram:SpecifiedTradeSettlementHeaderMonetarySummation>"
    + `<ram:LineTotalAmount>${centsToXml(calc.net)}</ram:LineTotalAmount><ram:TaxBasisTotalAmount>${centsToXml(calc.net)}</ram:TaxBasisTotalAmount>`
    + `<ram:TaxTotalAmount currencyID="${esc(cur)}">${centsToXml(calc.tax)}</ram:TaxTotalAmount><ram:GrandTotalAmount>${centsToXml(calc.gross)}</ram:GrandTotalAmount>`
    + `<ram:DuePayableAmount>${centsToXml(calc.gross)}</ram:DuePayableAmount>`
    + "</ram:SpecifiedTradeSettlementHeaderMonetarySummation>"
    + "</ram:ApplicableHeaderTradeSettlement>";

  return '<?xml version="1.0" encoding="UTF-8"?>'
    + '<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"'
    + ' xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"'
    + ' xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100"'
    + ' xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">'
    + "<rsm:ExchangedDocumentContext><ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>"
    + `<rsm:ExchangedDocument><ram:ID>${esc(t(inv.nummer))}</ram:ID><ram:TypeCode>380</ram:TypeCode>`
    + `<ram:IssueDateTime><udt:DateTimeString format="102">${toFormat102(inv.datum)}</udt:DateTimeString></ram:IssueDateTime></rsm:ExchangedDocument>`
    + `<rsm:SupplyChainTradeTransaction>${items}${agreement}${delivery}${settlement}</rsm:SupplyChainTradeTransaction>`
    + "</rsm:CrossIndustryInvoice>";
}
