import { NextResponse } from "next/server";
import { extractBankStatement } from "@/lib/bank-statement-parser";
import { listStatements, saveStatement } from "@/lib/local-statement-store";

export const runtime = "nodejs";
export async function GET() { return NextResponse.json(await listStatements()); }
export async function POST(request: Request) {
  try {
    const form = await request.formData(); const file = form.get("statement");
    if (!(file instanceof File)) return NextResponse.json({ error: "Selecciona un archivo PDF." }, { status: 400 });
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) return NextResponse.json({ error: "Solo se aceptan archivos PDF." }, { status: 415 });
    if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "El PDF supera el límite de 10 MB." }, { status: 413 });
    const source = Buffer.from(await file.arrayBuffer()); const parsed = await extractBankStatement(source);
    const stored = await saveStatement(parsed, source, file.name);
    return NextResponse.json(stored, { status: 201 });
  } catch (error) {
    if ((error as Error).message === "DUPLICATE") return NextResponse.json({ error: "Esta cartola ya fue cargada; no se duplicaron movimientos." }, { status: 409 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible procesar la cartola." }, { status: 422 });
  }
}
