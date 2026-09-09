# ZUGFeRD-Rechnung im Browser

E-Rechnungen nach **ZUGFeRD 2.x / Factur-X, Profil EN 16931** (PDF/A-3b mit eingebetteter `factur-x.xml`)
direkt im Browser erzeugen. Gedacht für kleine Lieferanten, die an Handelszentralen wie **Markant**
(famila, Bartels-Langness, …) liefern und deren GLN-Anforderungen erfüllen müssen.

- Webformular mit Sofortprüfung aller Pflichtfelder (EN 16931) und der Markant-Regeln (GLN-Prüfziffern, Partnernummer, Lieferscheinnummer)
- Erzeugung komplett clientseitig – Steuernummer, IBAN und Kundendaten verlassen den Rechner nicht
- Eingaben bleiben im Browser gespeichert (localStorage); Export/Import als JSON für die Aufbewahrung
- Ausgabe: PDF/A-3b + XML, in CI geprüft mit [veraPDF](https://verapdf.org) und dem [Mustang-Validator](https://www.mustangproject.org)

Hintergrund, Markant-Regeln und Stolperfallen: [ERKENNTNISSE.md](ERKENNTNISSE.md).

## Benutzung

1. Seite öffnen (GitHub Pages, siehe Repository-Beschreibung) oder lokal starten.
2. Verkäufer-, Empfänger- und Positionsdaten eintragen; „Beispiel laden" zeigt eine vollständige Rechnung.
3. Wenn die Prüfung keine Fehler mehr zeigt: **PDF erzeugen**. PDF und XML werden heruntergeladen.
4. Das PDF bei <https://valitool.org> mit dem Profil des Empfängers (z. B. *Markant-Goods*) prüfen.
5. PDF **und** XML aufbewahren (GoBD).

Steuer: USt-Satz 7 % oder 19 %, oder *Kleinunternehmer § 19 UStG* (Kategorie E, 0 %).

## Entwicklung

    npm install
    npm run dev        # http://localhost:5173
    npm test           # Unit-Tests (Rundung, Validierung, XML, PDF-Struktur)
    npm run build      # dist/
    npm run sample     # Beispiel-PDFs nach out/
    npm run validate   # veraPDF (Docker) + Mustang (Java) auf out/*.pdf

Aufbau:

| Pfad | Inhalt |
|---|---|
| `src/lib/model.ts` | Datenmodell der Rechnung |
| `src/lib/validate.ts` | Pflichtfelder, GS1-/IBAN-Prüfziffern, Markant-Warnungen |
| `src/lib/money.ts`, `calc.ts` | Beträge als ganze Cent, kaufmännische Rundung |
| `src/lib/xml.ts` | UN/CEFACT CII, EN 16931 |
| `src/lib/pdf.ts` | Sichtbare Rechnung (pdf-lib), PDF/A-3b: eingebettete Schrift, sRGB-OutputIntent, XMP mit Factur-X-Schema, `/AF`-Anhang |
| `src/main.ts` | Formular, Live-Prüfung, Speicherung, Download |
| `prototyp/` | Ursprüngliches Python-Skript (reportlab + factur-x), Referenzimplementierung |

## Deployment

Der Workflow in `.github/workflows/ci.yml` testet, baut, erzeugt Beispiel-PDFs, validiert sie und
veröffentlicht `dist/` auf GitHub Pages (Settings → Pages → Source: *GitHub Actions*).

## Lizenz

MIT. Schriften: DejaVu Sans (Bitstream Vera/DejaVu-Lizenz). ICC-Profil: sRGB.
Keine Steuer- oder Rechtsberatung; die Konformität mit den Anforderungen des jeweiligen Empfängers ist selbst zu prüfen.
