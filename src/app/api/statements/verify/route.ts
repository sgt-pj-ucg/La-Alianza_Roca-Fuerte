import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { extractBankStatement } from "@/lib/bank-statement-parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function database(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const authorization = request.headers.get("authorization");
  if (!url || !key || !authorization?.startsWith("Bearer ")) throw new Error("Tu sesión expiró. Vuelve a iniciar sesión.");
  const client = createClient(url, key, { global: { headers: { Authorization: authorization } } });
  const { data, error } = await client.auth.getUser(authorization.slice("Bearer ".length));
  if (error || !data.user) throw new Error("Tu sesión expiró. Vuelve a iniciar sesión.");
  return client;
}

const rowForInsert = (statementId: string, transaction: any) => ({
  statement_id: statementId, fingerprint: transaction.fingerprint, booked_at: transaction.bookedAt,
  description: transaction.description, document_number: transaction.documentNumber, channel: transaction.channel,
  charge_clp: transaction.chargeClp, credit_clp: transaction.creditClp, balance_clp: transaction.balanceClp
});

export async function POST(request: Request) {
  try {
    const client = await database(request);
    const { year, month } = await request.json();
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) throw new Error("El período seleccionado no es válido.");
    const { data: statement, error: statementError } = await client
      .from("bank_statements")
      .select("id,status,source_path,source_hash,bank_transactions(id,fingerprint,charge_clp,credit_clp)")
      .eq("period_year", year).eq("period_month", month).single();
    if (statementError || !statement) throw new Error(statementError?.message ?? "No existe una cartola para este mes.");
    if (statement.status === "CLOSED") throw new Error("El mes está cerrado. Solicita una reapertura controlada antes de verificar su cartola.");

    const { data: source, error: sourceError } = await client.storage.from("bank-statements").download(statement.source_path);
    if (sourceError || !source) throw new Error(sourceError?.message ?? "No se pudo leer el PDF original de la cartola.");
    const parsed = await extractBankStatement(Buffer.from(await source.arrayBuffer()));
    if (parsed.sourceHash !== statement.source_hash) throw new Error("El PDF recuperado no coincide con la cartola registrada; no se hicieron cambios.");
    if (!parsed.reconciled) throw new Error(`La lectura actual del PDF aún no concilia: ${parsed.issues.join(" ")}`);

    const stored = statement.bank_transactions ?? [];
    const storedFingerprints = new Set(stored.map((transaction: any) => transaction.fingerprint));
    const parsedFingerprints = new Set(parsed.transactions.map(transaction => transaction.fingerprint));
    const unexpected = stored.filter((transaction: any) => !parsedFingerprints.has(transaction.fingerprint));
    if (unexpected.length) throw new Error("La verificación detectó movimientos almacenados que no aparecen en el PDF actual. Por seguridad no se modificó la cartola.");
    const missing = parsed.transactions.filter(transaction => !storedFingerprints.has(transaction.fingerprint));

    if (missing.length) {
      const { data: inserted, error: insertError } = await client.from("bank_transactions").insert(missing.map(transaction => rowForInsert(statement.id, transaction))).select("id");
      if (insertError) throw new Error(insertError.message);
      if ((inserted?.length ?? 0) !== missing.length) throw new Error("No se pudo comprobar la incorporación de todos los movimientos faltantes.");
    }
    const { error: updateError } = await client.from("bank_statements").update({
      declared_charges_clp: parsed.declaredChargesClp, declared_credits_clp: parsed.declaredCreditsClp,
      extracted_charges_clp: parsed.extractedChargesClp, extracted_credits_clp: parsed.extractedCreditsClp, status: "RECONCILED"
    }).eq("id", statement.id);
    if (updateError) throw new Error(updateError.message);
    return NextResponse.json({ ok: true, added: missing.length, transactions: parsed.transactions.length, reconciled: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible verificar la cartola." }, { status: 422 });
  }
}
