import { compute } from "./lib/calc";
import { emptyInvoice, emptyLine, type Invoice } from "./lib/model";
import { centsToDe, parseCents, parseQuantity, lineTotal } from "./lib/money";
import type { PdfAssets } from "./lib/pdf";
import { validate, type Finding } from "./lib/validate";
import { buildXml } from "./lib/xml";
import { sampleInvoice } from "./sample";
import fontRegularUrl from "./assets/DejaVuSans.ttf?url";
import fontBoldUrl from "./assets/DejaVuSans-Bold.ttf?url";
import iccUrl from "./assets/srgb.icc?url";

const STORAGE_KEY = "zugferd-rechnung.v1";
const $ = <T extends Element = HTMLElement>(sel: string): T => document.querySelector(sel) as T;

// ---------- Zustand ----------
let inv: Invoice = load();

function load(): Invoice {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return merge(emptyInvoice(), JSON.parse(raw));
  } catch { /* leerer Start */ }
  return emptyInvoice();
}
function save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(inv)); } catch { /* z. B. privater Modus */ } }

/** Unbekannte Felder verwerfen, fehlende ergänzen – macht Importe alter/fremder JSON robust. */
function merge<T extends object>(base: T, data: unknown): T {
  if (typeof data !== "object" || data === null) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(base)) {
    const d = (data as Record<string, unknown>)[k];
    if (d === undefined) continue;
    if (Array.isArray(v)) out[k] = Array.isArray(d) ? d.map((x) => merge(emptyLine(), x)) : v;
    else if (typeof v === "object" && v !== null) out[k] = merge(v, d);
    else if (typeof d === typeof v) out[k] = d;
  }
  return out as T;
}

const getPath = (obj: unknown, path: string): unknown => path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);
const setPath = (obj: unknown, path: string, value: unknown) => {
  const keys = path.split(".");
  const last = keys.pop()!;
  const target = keys.reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], obj) as Record<string, unknown>;
  target[last] = value;
};

// ---------- Formular <-> Zustand ----------
const form = $<HTMLFormElement>("#form");

function fillForm() {
  renderLines();
  for (const el of form.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-path]")) {
    const v = getPath(inv, el.dataset.path!);
    if (el instanceof HTMLInputElement && el.type === "checkbox") el.checked = Boolean(v);
    else el.value = String(v ?? "");
  }
  refresh();
}

function renderLines() {
  const tbody = $<HTMLTableSectionElement>("#lines tbody");
  tbody.innerHTML = "";
  inv.positionen.forEach((l, i) => {
    const tr = document.createElement("tr");
    const p = `positionen.${i}`;
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td><input data-path="${p}.beschreibung" required></td>
      <td><input data-path="${p}.artikelnummer" style="width:7rem"></td>
      <td><input data-path="${p}.gtin" inputmode="numeric" style="width:9rem"></td>
      <td class="num"><input data-path="${p}.menge" inputmode="decimal" style="width:5rem;text-align:right"></td>
      <td><select data-path="${p}.einheit">
        <option value="H87">Stück</option><option value="KGM">kg</option><option value="GRM">g</option><option value="LTR">l</option>
        <option value="MTR">m</option><option value="MTK">m²</option><option value="HUR">Std.</option><option value="C62">Einheit</option><option value="XPK">Packung</option><option value="XCT">Karton</option>
      </select></td>
      <td class="num"><input data-path="${p}.einzelpreis" inputmode="decimal" style="width:6rem;text-align:right"></td>
      <td class="total" data-total="${i}"></td>
      <td><button type="button" class="ghost remove" data-remove="${i}" title="Position entfernen" ${inv.positionen.length === 1 ? "disabled" : ""}>×</button></td>`;
    tbody.appendChild(tr);
    for (const el of tr.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-path]")) {
      const key = el.dataset.path!.split(".").pop() as keyof typeof l;
      el.value = l[key];
    }
  });
}

form.addEventListener("input", (e) => {
  const el = e.target as HTMLInputElement | HTMLSelectElement;
  const path = el.dataset.path;
  if (!path) return;
  const value = el instanceof HTMLInputElement && el.type === "checkbox" ? el.checked : el.value;
  setPath(inv, path, value);
  save();
  refresh();
});

form.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-remove]");
  if (!btn) return;
  inv.positionen.splice(Number(btn.dataset.remove), 1);
  save(); renderLines(); refresh();
});

$("#add-line").addEventListener("click", () => {
  inv.positionen.push(emptyLine());
  save(); renderLines(); refresh();
  form.querySelector<HTMLInputElement>(`[data-path="positionen.${inv.positionen.length - 1}.beschreibung"]`)?.focus();
});

// ---------- Anzeige: Summen und Prüfung ----------
function refresh() {
  $<HTMLSelectElement>('[data-path="ustSatz"]').disabled = inv.kleinunternehmer;

  inv.positionen.forEach((l, i) => {
    const q = parseQuantity(l.menge), p = parseCents(l.einzelpreis);
    const cell = form.querySelector<HTMLTableCellElement>(`[data-total="${i}"]`);
    if (cell) cell.textContent = q !== null && p !== null ? centsToDe(lineTotal(q, p)) : "–";
  });

  const { errors, warnings } = validate(inv);
  const summary = $("#summary");
  try {
    const c = compute(inv);
    const taxLabel = c.category === "E" ? "USt (§ 19 UStG)" : `USt ${String(c.rate).replace(".", ",")} %`;
    summary.innerHTML = `<dt>Netto</dt><dd>${centsToDe(c.net)} €</dd><dt>${taxLabel}</dt><dd>${centsToDe(c.tax)} €</dd><dt class="gross">Brutto</dt><dd class="gross">${centsToDe(c.gross)} €</dd>`;
  } catch {
    summary.innerHTML = "<dt>Netto</dt><dd>–</dd>";
  }

  const list = $("#findings");
  list.innerHTML = "";
  const item = (f: Finding, cls: string) => {
    const li = document.createElement("li");
    li.className = cls; li.textContent = f.message; li.dataset.field = f.field;
    li.addEventListener("click", () => form.querySelector<HTMLElement>(`[data-path="${f.field}"]`)?.focus());
    list.appendChild(li);
  };
  errors.forEach((f) => item(f, "error"));
  warnings.forEach((f) => item(f, "warning"));
  if (!errors.length) { const li = document.createElement("li"); li.className = "ok"; li.textContent = warnings.length ? "Alle Pflichtfelder vorhanden. Warnungen prüfen." : "Alle Pflichtfelder vorhanden."; list.prepend(li); }

  const errorFields = new Set(errors.map((e) => e.field));
  for (const el of form.querySelectorAll<HTMLElement>("[data-path]")) el.classList.toggle("invalid", errorFields.has(el.dataset.path!));
  $<HTMLButtonElement>("#make-pdf").disabled = errors.length > 0;
}

// ---------- Erzeugen ----------
let assetsPromise: Promise<PdfAssets> | undefined;
const fetchBytes = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer());
const loadAssets = () => (assetsPromise ??= Promise.all([fetchBytes(fontRegularUrl), fetchBytes(fontBoldUrl), fetchBytes(iccUrl)])
  .then(([fontRegular, fontBold, iccProfile]) => ({ fontRegular, fontBold, iccProfile })));

function download(name: string, data: Uint8Array | string, type: string) {
  const blob = new Blob([data as BlobPart], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

const status = $("#status");
const setStatus = (msg: string, error = false) => { status.textContent = msg; status.classList.toggle("error", error); };

$("#make-pdf").addEventListener("click", async () => {
  setStatus("PDF wird erzeugt …");
  try {
    const { generate, ValidationError } = await import("./lib/generate"); // pdf-lib erst bei Bedarf laden
    const [assets] = await Promise.all([loadAssets()]);
    const r = await generate(inv, assets).catch((e: unknown) => { if (e instanceof ValidationError) throw new Error("Bitte zuerst die Fehler beheben."); throw e; });
    download(`${r.basename}.pdf`, r.pdf, "application/pdf");
    download(`${r.basename}.xml`, r.xml, "application/xml");
    setStatus(`Fertig: ${r.basename}.pdf und .xml heruntergeladen.`);
  } catch (e) {
    setStatus(`Fehler: ${(e as Error).message}`, true);
  }
});

$("#make-xml").addEventListener("click", () => {
  const { errors } = validate(inv);
  if (errors.length) { setStatus("Bitte zuerst die Fehler beheben.", true); return; }
  download(`Rechnung-${inv.nummer.trim().replace(/[^\w.-]+/g, "_")}-factur-x.xml`, buildXml(inv, compute(inv)), "application/xml");
  setStatus("XML heruntergeladen.");
});

// ---------- Werkzeuge ----------
$("#load-sample").addEventListener("click", () => {
  if (hasContent() && !confirm("Aktuelle Eingaben durch das Beispiel ersetzen?")) return;
  inv = structuredClone(sampleInvoice); save(); fillForm(); setStatus("Beispieldaten geladen (fiktiver Verkäufer).");
});
$("#reset").addEventListener("click", () => {
  if (!confirm("Wirklich alle Eingaben löschen?")) return;
  inv = emptyInvoice(); save(); fillForm(); setStatus("");
});
$("#export-json").addEventListener("click", () => {
  download(`rechnung-${inv.nummer.trim() || "entwurf"}.json`, JSON.stringify(inv, null, 2), "application/json");
});
$<HTMLInputElement>("#import-json").addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    inv = merge(emptyInvoice(), JSON.parse(await file.text()));
    if (!inv.positionen.length) inv.positionen = [emptyLine()];
    save(); fillForm(); setStatus(`Daten aus ${file.name} geladen.`);
  } catch { setStatus("Datei konnte nicht gelesen werden.", true); }
  (e.target as HTMLInputElement).value = "";
});

const hasContent = () => JSON.stringify(inv) !== JSON.stringify(emptyInvoice());

const repo = import.meta.env.VITE_REPO_URL as string | undefined;
if (repo) $<HTMLAnchorElement>("#repo-link").href = repo;

fillForm();
