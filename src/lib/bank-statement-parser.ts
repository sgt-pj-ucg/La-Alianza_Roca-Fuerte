import { createHash } from "crypto";
import pdf from "pdf-parse/lib/pdf-parse";

export type ExtractedTransaction = {
  fingerprint: string; bookedAt: string; description: string; channel: string | null;
  documentNumber: string | null; chargeClp: number | null; creditClp: number | null; balanceClp: number;
};
export type ParsedStatement = {
  sourceHash: string; periodYear: number; periodMonth: number; declaredChargesClp: number; declaredCreditsClp: number;
  extractedChargesClp: number; extractedCreditsClp: number; reconciled: boolean; transactions: ExtractedTransaction[]; issues: string[];
};

const toClp = (text: string) => Number(text.replaceAll(".", ""));
const lastAmountPair = (text: string) => {
  const values = [...text.matchAll(/\b(?:\d{1,3}(?:\.\d{3})+|\d+)\b/g)].map(match => match[0]);
  return values.length >= 2 ? [toClp(values.at(-2)!), toClp(values.at(-1)!)] as const : null;
};
const declared = (text: string, label: string) => {
  const match = text.match(new RegExp(`${label}\\s+([\\d.]+)`));
  if (!match) throw new Error(`No se encontró “${label}” en el PDF.`);
  return toClp(match[1]);
};

export async function extractBankStatement(pdfBuffer: Buffer): Promise<ParsedStatement> {
  const sourceHash = createHash("sha256").update(pdfBuffer).digest("hex");
  const parsed = await pdf(pdfBuffer, { pagerender: async (page: { getTextContent: () => Promise<{ items: Array<{ str: string; width: number; transform: number[] }> }> }) => {
    const content = await page.getTextContent(); let text = ""; let lastY: number | null = null; let lastRight = 0;
    for (const item of content.items) {
      const x = item.transform[4]; const y = item.transform[5];
      if (lastY !== null && y !== lastY) text += "\n";
      else if (lastY !== null && x > lastRight + 1) text += " ";
      text += item.str; lastY = y; lastRight = x + item.width;
    }
    return text;
  } });
  const raw = parsed.text.replace(/\r/g, "").replace(/Infórmese[\s\S]*?Todos los Derechos Reservados/g, "");
  const declaredChargesClp = declared(raw, "Total Cargos");
  const declaredCreditsClp = declared(raw, "Total Abonos");
  const start = raw.search(/Fecha\s*Descripción/);
  if (start < 0) throw new Error("No se detectó la tabla de movimientos del banco.");
  const chunks = raw.slice(start).split(/(?=\d{2}\/\d{2}\/\d{4})/).slice(1);
  const transactions: ExtractedTransaction[] = [];
  const issues: string[] = [];

  for (const [rowIndex, chunk] of chunks.entries()) {
    const date = chunk.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (!date) continue;
    const channelMatch = chunk.match(/\b(Internet|La Serena)\b/);
    const values = lastAmountPair(chunk);
    if (!channelMatch || !values) { issues.push(`Fila ${date[0]} no pudo leerse completamente.`); continue; }
    const description = chunk.slice(date[0].length, channelMatch.index).replace(/\s+/g, " ").trim();
    const tail = chunk.slice((channelMatch.index ?? 0) + channelMatch[0].length);
    const doc = tail.match(/^\s*(\d{6,})\b/)?.[1] ?? null;
    const [amount, balanceClp] = values;
    const isCharge = /\bTraspaso\s+A(?::|\s+Cuenta)/i.test(description);
    const isCredit = /\bTraspaso\s+De:|\bDepos\.?\s+Efectivo/i.test(description);
    if (!isCharge && !isCredit) { issues.push(`No se pudo determinar cargo/abono para ${date[0]}.`); continue; }
    const bookedAt = `${date[3]}-${date[2]}-${date[1]}`;
    // El índice de fila evita colisiones incluso cuando dos movimientos tienen los mismos datos visibles.
    const fingerprint = createHash("sha256").update([sourceHash, rowIndex, bookedAt, description, isCharge ? "C" : "A", amount, balanceClp, doc ?? ""].join("|"), "utf8").digest("hex");
    transactions.push({ fingerprint, bookedAt, description, channel: channelMatch[1], documentNumber: doc, chargeClp: isCharge ? amount : null, creditClp: isCredit ? amount : null, balanceClp });
  }
  if (!transactions.length) throw new Error("No se extrajeron movimientos válidos.");
  const extractedChargesClp = transactions.reduce((sum, row) => sum + (row.chargeClp ?? 0), 0);
  const extractedCreditsClp = transactions.reduce((sum, row) => sum + (row.creditClp ?? 0), 0);
  if (extractedChargesClp !== declaredChargesClp) issues.push(`Cargos extraídos ${extractedChargesClp}; cartola ${declaredChargesClp}.`);
  if (extractedCreditsClp !== declaredCreditsClp) issues.push(`Abonos extraídos ${extractedCreditsClp}; cartola ${declaredCreditsClp}.`);
  return { sourceHash, periodYear: Number(transactions[0].bookedAt.slice(0,4)), periodMonth: Number(transactions[0].bookedAt.slice(5,7)), declaredChargesClp, declaredCreditsClp, extractedChargesClp, extractedCreditsClp, reconciled: issues.length === 0, transactions, issues };
}
