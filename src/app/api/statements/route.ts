import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { extractBankStatement } from "@/lib/bank-statement-parser";
import type { StoredStatement } from "@/lib/statement-types";

export const runtime = "nodejs";

function responseError(error: unknown, fallback: string) {
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status: 422 });
}

async function userDatabase(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const authorization = request.headers.get("authorization");
  if (!url || !key) throw new Error("Falta configurar Supabase en el servidor.");
  if (!authorization?.startsWith("Bearer ")) throw new Error("Tu sesión expiró. Vuelve a iniciar sesión.");
  const client = createClient(url, key, { global: { headers: { Authorization: authorization } } });
  const { data, error } = await client.auth.getUser(authorization.slice("Bearer ".length));
  if (error || !data.user) throw new Error("Tu sesión expiró. Vuelve a iniciar sesión.");
  return client;
}

function mapStatement(row: any): StoredStatement {
  const transactions = (row.bank_transactions ?? []).map((transaction: any) => ({
    fingerprint: transaction.fingerprint, bookedAt: transaction.booked_at, description: transaction.description,
    channel: transaction.channel, documentNumber: transaction.document_number, chargeClp: transaction.charge_clp,
    creditClp: transaction.credit_clp, balanceClp: transaction.balance_clp
  }));
  const reconciled = row.status === "RECONCILED";
  const issues = reconciled ? [] : ["Esta cartola requiere revisión antes del cierre mensual."];
  const uploadedFile = row.source_path.split("/").at(-1) ?? "Cartola.pdf";
  return {
    id: row.id, fileName: uploadedFile.replace(/^[a-f0-9]{64}-/, ""), sourcePath: row.source_path,
    sourceHash: row.source_hash, periodYear: row.period_year, periodMonth: row.period_month,
    declaredChargesClp: row.declared_charges_clp, declaredCreditsClp: row.declared_credits_clp,
    extractedChargesClp: row.extracted_charges_clp, extractedCreditsClp: row.extracted_credits_clp,
    reconciled, transactions, issues, uploadedAt: row.uploaded_at
  };
}

export async function GET(request: Request) {
  try {
    const client = await userDatabase(request);
    const { data, error } = await client.from("bank_statements").select("*, bank_transactions(*)").order("period_year", { ascending: false }).order("period_month", { ascending: false });
    if (error) throw new Error(error.message);
    return NextResponse.json((data ?? []).map(mapStatement));
  } catch (error) { return responseError(error, "No fue posible cargar las cartolas."); }
}

export async function POST(request: Request) {
  try {
    const client = await userDatabase(request);
    const form = await request.formData(); const file = form.get("statement");
    if (!(file instanceof File)) return NextResponse.json({ error: "Selecciona un archivo PDF." }, { status: 400 });
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) return NextResponse.json({ error: "Solo se aceptan archivos PDF." }, { status: 415 });
    if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "El PDF supera el límite de 10 MB." }, { status: 413 });
    const source = Buffer.from(await file.arrayBuffer()); const parsed = await extractBankStatement(source);
    const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
    const sourcePath = `${parsed.periodYear}/${String(parsed.periodMonth).padStart(2, "0")}/${parsed.sourceHash}-${safeFileName}`;
    // Permite reintentar una carga fallida con el mismo PDF; la tabla conserva la protección contra duplicados confirmados.
    const upload = await client.storage.from("bank-statements").upload(sourcePath, source, { contentType: "application/pdf", upsert: true });
    if (upload.error) throw new Error(upload.error.message);
    const { data: statement, error: statementError } = await client.from("bank_statements").insert({
      period_year: parsed.periodYear, period_month: parsed.periodMonth, source_path: sourcePath, source_hash: parsed.sourceHash,
      declared_charges_clp: parsed.declaredChargesClp, declared_credits_clp: parsed.declaredCreditsClp,
      extracted_charges_clp: parsed.extractedChargesClp, extracted_credits_clp: parsed.extractedCreditsClp,
      status: parsed.reconciled ? "RECONCILED" : "FAILED"
    }).select().single();
    if (statementError) { await client.storage.from("bank-statements").remove([sourcePath]); throw new Error(statementError.message.includes("source_hash") || statementError.message.includes("period_year") ? "Esta cartola o este mes ya fue cargado." : statementError.message); }
    const { error: transactionError } = await client.from("bank_transactions").insert(parsed.transactions.map(transaction => ({
      statement_id: statement.id, fingerprint: transaction.fingerprint, booked_at: transaction.bookedAt,
      description: transaction.description, document_number: transaction.documentNumber, channel: transaction.channel,
      charge_clp: transaction.chargeClp, credit_clp: transaction.creditClp, balance_clp: transaction.balanceClp
    })));
    if (transactionError) {
      await client.from("bank_statements").delete().eq("id", statement.id);
      await client.storage.from("bank-statements").remove([sourcePath]);
      throw new Error(transactionError.message);
    }
    const stored: StoredStatement = { ...parsed, id: statement.id, fileName: file.name, sourcePath, uploadedAt: statement.uploaded_at };
    return NextResponse.json(stored, { status: 201 });
  } catch (error) {
    return responseError(error, "No fue posible procesar la cartola.");
  }
}
