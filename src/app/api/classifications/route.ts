import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { INITIAL_BUDGET } from "@/lib/budget";

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

async function ensureCatalogs(client: any) {
  const { data: existingBudget, error: budgetError } = await client.from("budgets").select("id").eq("year", 2026).maybeSingle();
  if (budgetError) throw new Error(budgetError.message);
  let budgetId = existingBudget?.id;
  if (!budgetId) {
    const { data, error } = await client.from("budgets").insert({ year: 2026, source_file: "Presupuesto año 2026.xlsx" }).select("id").single();
    if (error) throw new Error(error.message);
    budgetId = data.id;
  }
  const categories = [...new Set(INITIAL_BUDGET.map(item => item.category))];
  for (const name of categories) {
    const { error } = await client.from("budget_categories").upsert({ budget_id: budgetId, name }, { onConflict: "budget_id,name" });
    if (error) throw new Error(error.message);
  }
  const { data: categoryRows, error: categoryError } = await client.from("budget_categories").select("id,name").eq("budget_id", budgetId);
  if (categoryError) throw new Error(categoryError.message);
  const byName = new Map((categoryRows ?? []).map((row: any) => [row.name, row.id]));
  for (const item of INITIAL_BUDGET) {
    const { error } = await client.from("budget_items").upsert({ category_id: byName.get(item.category), name: item.item }, { onConflict: "category_id,name" });
    if (error) throw new Error(error.message);
  }
  for (const name of ["Diezmo", "Ofrenda", "Aporte", "Transferencia interna", "Otro ingreso"]) {
    const { error } = await client.from("income_concepts").upsert({ name }, { onConflict: "name" });
    if (error) throw new Error(error.message);
  }
}

export async function GET(request: Request) {
  try {
    const client = await database(request); await ensureCatalogs(client);
    const [{ data: concepts, error: conceptsError }, { data: items, error: itemsError }, { data: transactions, error: transactionsError }] = await Promise.all([
      client.from("income_concepts").select("id,name").order("name"),
      client.from("budget_items").select("id,name,budget_categories(name)").order("name"),
      client.from("bank_transactions").select("*, bank_statements!inner(period_year,period_month,status), transaction_classifications(id,income_concept_id,budget_item_id,status,note)").eq("bank_statements.period_year", 2026).eq("bank_statements.period_month", 1).order("booked_at", { ascending: false })
    ]);
    if (conceptsError || itemsError || transactionsError) throw new Error(conceptsError?.message ?? itemsError?.message ?? transactionsError?.message);
    return NextResponse.json({ concepts, items, transactions });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible cargar la clasificación." }, { status: 422 }); }
}

export async function POST(request: Request) {
  try {
    const client = await database(request);
    const body = await request.json();
    if (!body.transactionId || (!body.incomeConceptId && !body.budgetItemId)) return NextResponse.json({ error: "Selecciona un concepto o partida." }, { status: 400 });
    const { error } = await client.from("transaction_classifications").upsert({
      transaction_id: body.transactionId, income_concept_id: body.incomeConceptId ?? null, budget_item_id: body.budgetItemId ?? null,
      status: "CONFIRMED", confidence: 100, note: body.note?.trim() || null, validated_at: new Date().toISOString()
    }, { onConflict: "transaction_id" });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible guardar la clasificación." }, { status: 422 }); }
}
