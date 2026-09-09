# Erkenntnisse: ZUGFeRD-Rechnungen für famila / Markant

Stand: 28.08.2026. Ergebnis: eine mit diesem Skript erzeugte Rechnung wurde von Valitool (Profil **Markant-Goods**)
als **gültig** akzeptiert (ZUGFeRD 2.x COMFORT / Factur-X EN 16931, Modus HYBRID_DOCUMENT).

## 1. Ausgangslage

- Rechnungen wurden bisher mit einem Online-Rechnungsgenerator erstellt → normales PDF **ohne eingebettetes XML**.
- Markant (Handelszentrale hinter famila / Bartels-Langness) nimmt nur ZUGFeRD/Factur-X-Rechnungen an.
- Erster Validierungsbericht: `BIZON-1 Embedding_Error` + vier Folgefehler (RALA-90, PN-90, ON-90, DN-90),
  alle mit derselben Ursache „No embedded XML found".

## 2. Der Standard (ferd-net.de/standards/zugferd)

- ZUGFeRD = Hybridformat: **PDF/A-3** mit eingebetteter `factur-x.xml` (UN/CEFACT Cross Industry Invoice, EN 16931).
- Aktuelle Version 2.5.2 (04.08.2026); Profile MINIMUM / BASIC WL / BASIC / **EN 16931 (COMFORT)** / EXTENDED / XRECHNUNG.
- Wir verwenden Profil EN 16931 (`urn:cen.eu:en16931:2017`). Das reicht für Markant.
- Spezifikation + Beispieldateien: https://www.ferd-net.de/download-zugferd

## 3. Was Markant zusätzlich prüft (Validator-Module RALA, PartnerNumber, OrderNumber, DeliveryNoteNumber)

| Anforderung | Umsetzung im XML | Pflicht? |
|---|---|---|
| GLN des Verkäufers | `SellerTradeParty/GlobalID schemeID="0088"` | ja (BR-MARKANT-05) |
| GLN des Rechnungsempfängers | `BuyerTradeParty/GlobalID schemeID="0088"` | ja (BR-MARKANT-06) |
| GLN des Liefermarkts | `ShipToTradeParty/GlobalID schemeID="0088"` | ja |
| Partnernummer (RALA) | `SellerTradeParty/ID` = Pseudo-GLN | ja – Pseudo-GLN wird akzeptiert |
| Klaranschrift Empfänger | `BuyerTradeParty/Name` **exakt** wie Markant-Stammdaten | ja (BR-MARKANT-RALA-02, Fehler!) |
| Lieferscheinnummer | `DespatchAdviceReferencedDocument/IssuerAssignedID` | ja |
| Bestellnummer | `BuyerOrderReferencedDocument/IssuerAssignedID` | **nein** – ohne Bestellnummer keine Beanstandung |
| GTIN je Position | `SpecifiedTradeProduct/GlobalID schemeID="0160"` | nein, nur Warnung BR-MARKANT-01 |
| Hinweis auf Entgeltminderung | Zahlungsbedingungen | nur wenn Skonto/Boni vereinbart (BR-MARKANT-16) |

Erkenntnis: Markant vergleicht Name **und Straße** des Empfängers mit seinen Stammdaten. Abweichende
Groß-/Kleinschreibung („famila" statt „Famila") ist ein **Fehler**; „7 - 13" statt „7-13" nur eine Warnung.

## 4. Stammdaten (Beispiel, Struktur validiert)

Die echten Stammdaten liegen nicht im Repo. `rechnung.yaml` enthält fiktive Beispieldaten; die Struktur
entspricht der validierten Rechnung.

| | Wert |
|---|---|
| Verkäufer | Kleinunternehmer (Imkerei) mit **Pseudo-GLN** als Partnernummer (13-stellig, GS1-Prüfziffer muss stimmen) |
| Steuernummer | `SpecifiedTaxRegistration schemeID="FC"` (USt-IdNr. wäre `schemeID="VA"`) |
| Steuer | Kleinunternehmer § 19 UStG → Kategorie **E**, 0 %, mit `ExemptionReason` |
| Rechnungsempfänger | **Famila Handelsmarkt Neumünster GmbH & Co. KG**, Alte Weide **7-13**, 24116 Kiel, GLN 4304525000009 (Markant-Stammdaten) |
| Lieferort | famila-Markt mit eigener GLN (`ShipToTradeParty`) |
| Bank | IBAN, BIC, Kontoinhaber → `SpecifiedTradeSettlementPaymentMeans` TypeCode 58 |
| Artikel | Händler-Artikelnummer als `SellerAssignedID`, GTIN optional |

Ein früherer Fehler: Verkäufer-GLN mit nur 12 Stellen → ungültig; die Pseudo-GLN muss 13-stellig sein.

## 5. Steuerliche Pflichtangaben – auch für Kleinunternehmer

- EN 16931 **BR-E-2**: Bei Steuerkategorie E muss USt-IdNr. **oder** Steuernummer des Verkäufers enthalten sein.
- § 14 Abs. 4 UStG verlangt Steuernummer/USt-IdNr. auf jeder Rechnung, unabhängig von § 19.
- Die alten Rechnungen schrieben „USt-IdNr." ohne Nummer → nicht regelkonform.

## 6. PDF/A-3-Fallen (beim zweiten Validierungslauf gefunden)

| Fehler | Ursache | Fix im Skript |
|---|---|---|
| `ISO_19005_3 6.2.11.4.1` Schrift nicht eingebettet | reportlab-Standardschrift Helvetica (Type 1, nicht eingebettet) | DejaVu Sans TTF aus `src/assets/` registriert; `FONTNAME` in **allen** Tabellen (auch Layout-Tabellen ohne Text!), `initialFontName`, `bulletFontName` |
| `ISO_19005_3 6.2.4.3` DeviceRGB ohne OutputIntent | Farben ohne ICC-Profil | sRGB-ICC (`src/assets/srgb.icc`) als `/OutputIntents` eingefügt |
| (Web-Version) Trailer ohne `/ID`, fehlendes `/AF` | pdf-lib setzt beides nicht von selbst | `context.trailerInfo.ID` setzen; Filespec-Referenzen nach `flush()` in `/AF` eintragen; XMP unkomprimiert mit `pdfaid` + Factur-X-Extension-Schema |

Prüfung lokal: `pdffonts datei.pdf` darf nur eingebettete Schriften (`emb yes`) zeigen; `pdfdetach -list` muss `factur-x.xml` zeigen.

## 7. Verbleibende Warnungen (akzeptiert)

- **BR-MARKANT-01** GTIN fehlt – eintragen, sobald EAN der Gläser bekannt (`gtin:` in YAML).
- **BR-MARKANT-16** keine Entgeltminderung – korrekt, solange kein Skonto/Bonus vereinbart.
- **VD-Valitool-71** keine Handelsregister-/GF-Angaben – für Einzelunternehmen ohne HR-Eintrag nicht zutreffend.

## 8. Workflow für die nächste Rechnung

1. Webformular öffnen (gespeicherte Stammdaten sind noch da), `Rechnungsnummer`, Daten, Lieferscheinnummer, Positionen anpassen.
2. **PDF erzeugen** – die Prüfung im Formular blockt fehlende Pflichtfelder.
3. Kontrolle bei https://valitool.org, Profil Markant-Goods → „Ist gültig?: Ja".
4. PDF an famila/Markant senden. PDF **und** XML aufbewahren (GoBD).

Der Python-Prototyp in `prototyp/` (reportlab + factur-x) bleibt als Referenz; die Web-Version
(pdf-lib) erzeugt dieselbe XML-Struktur und besteht veraPDF (PDF/A-3b) und Mustang (EN 16931).

## 9. Offen / Ideen

- **Hosting/Tool für iPad** – vertagt. Optionen: Vercel (Python-Functions, Pro-Plan wegen kommerzieller Nutzung,
  Postgres+Blob für Stammdaten/Archiv, Deployment Protection + eigener Login) vs. VPS/Fly.io mit SQLite + Tailscale.
  Kern (`make_invoice.py`) bleibt hostingneutral.
- Mustang-Validator (Java) lokal anbinden, um EN-16931-Regeln vor dem Upload zu prüfen.
- Optionale Felder: Skonto/Entgeltminderung, GTIN, Gutschrift (TypeCode 381).
- Weitere Händler (EDEKA, REWE) haben ähnliche GLN-Anforderungen – ggf. Profile je Empfänger.

## Quellen

- https://www.ferd-net.de/standards/zugferd
- https://hphock.de/jtl-wawi-e-rechnungen-globalids-markant-konformitaet-in-version-1-7-2/
- https://www.sage-forum.de/threads/erechnung-zugferd-f%C3%BCr-markant.5270/
- Validierungsberichte von https://valitool.org (Profil Markant-Goods), nicht im Repo
