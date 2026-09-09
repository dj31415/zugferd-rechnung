/** "2024-07-08" -> "20240708" (UN/CEFACT Format 102) */
export const toFormat102 = (iso: string): string => iso.replaceAll("-", "");
/** "2024-07-08" -> "08.07.2024" */
export const toGerman = (iso: string): string => { const [y, m, d] = iso.split("-"); return `${d}.${m}.${y}`; };
