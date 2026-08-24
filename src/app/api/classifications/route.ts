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
  } else {
    const { error } = await client.from("income_concepts").upsert(
      ["Diezmo", "Ofrenda", "Aporte", "Misiones", "Transferencia interna", "Otro ingreso"].map(name => ({ name })),
      { onConflict: "name" }
    );
    if (error) throw new Error(error.message);
    return budgetId;
  }

  const categories = [...new Set(INITIAL_BUDGET.map(item => item.category))];
  const { error: categoriesUpsertError } = await client.from("budget_categories").upsert(
    categories.map(name => ({ budget_id: budgetId, name })),
    { onConflict: "budget_id,name" }
  );
  if (categoriesUpsertError) throw new Error(categoriesUpsertError.message);
  const { data: categoryRows, error: categoryError } = await client.from("budget_categories").select("id,name").eq("budget_id", budgetId);
  if (categoryError) throw new Error(categoryError.message);
  const byName = new Map((categoryRows ?? []).map((row: any) => [row.name, row.id]));
  const [{ error: itemsUpsertError }, { error: conceptsUpsertError }] = await Promise.all([
    client.from("budget_items").upsert(
      INITIAL_BUDGET.map(item => ({ category_id: byName.get(item.category), name: item.item })),
      { onConflict: "category_id,name" }
    ),
    client.from("income_concepts").upsert(
      ["Diezmo", "Ofrenda", "Aporte", "Misiones", "Transferencia interna", "Otro ingreso"].map(name => ({ name })),
      { onConflict: "name" }
    )
  ]);
  if (itemsUpsertError || conceptsUpsertError) throw new Error(itemsUpsertError?.message ?? conceptsUpsertError?.message);
  return budgetId;
}

export async function GET(request: Request) {
  try {
    const client = await database(request); await ensureCatalogs(client);
    const url = new URL(request.url); const year = Number(url.searchParams.get("year") ?? 2026); const month = Number(url.searchParams.get("month") ?? 1);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return NextResponse.json({ error: "El período seleccionado no es válido." }, { status: 400 });
    const [{ data: concepts, error: conceptsError }, { data: items, error: itemsError }, { data: statement, error: statementError }, { data: months, error: monthsError }] = await Promise.all([
      client.from("income_concepts").select("id,name").order("name"),
      client.from("budget_items").select("id,name,budget_categories(name)").order("name"),
      client.from("bank_statements").select("period_year,period_month,status,bank_transactions(id,booked_at,description,display_name,charge_clp,credit_clp,transaction_classifications(income_concept_id,budget_item_id,note),transaction_income_allocations(id,income_concept_id,amount_clp,description))").eq("period_year", year).eq("period_month", month).maybeSingle(),
      client.from("bank_statements").select("period_year,period_month,status").order("period_year", { ascending: true }).order("period_month", { ascending: true })
    ]);
    if (conceptsError || itemsError || statementError || monthsError) throw new Error(conceptsError?.message ?? itemsError?.message ?? statementError?.message ?? monthsError?.message);
    const transactions = (statement?.bank_transactions ?? []).sort((a: any, b: any) => b.booked_at.localeCompare(a.booked_at));
    return NextResponse.json({ concepts, items, transactions, months: months ?? [], period: { year, month } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible cargar la clasificación." }, { status: 422 }); }
}

export async function POST(request: Request) {
  try {
    const client = await database(request);
    const body = await request.json();
    if (!body.transactionId || (!body.incomeConceptId && !body.budgetItemId && !Array.isArray(body.allocations))) return NextResponse.json({ error: "Selecciona un concepto o partida." }, { status: 400 });
    if (Array.isArray(body.allocations)) {
      const { data: transaction, error: transactionError } = await client.from("bank_transactions").select("credit_clp").eq("id", body.transactionId).single();
      if (transactionError || !transaction?.credit_clp) throw new Error("Solo los ingresos pueden dividirse.");
      const allocations = body.allocations.map((row: any) => ({ transaction_id: body.transactionId, income_concept_id: String(row.incomeConceptId ?? ""), amount_clp: Number(row.amountClp), description: String(row.description ?? "").trim() }));
      if (!allocations.length || allocations.some((row: any) => !row.income_concept_id || !Number.isInteger(row.amount_clp) || row.amount_clp <= 0 || !row.description)) return NextResponse.json({ error: "Cada división necesita categoría, descripción y monto." }, { status: 400 });
      if (allocations.reduce((sum: number, row: any) => sum + row.amount_clp, 0) !== Number(transaction.credit_clp)) return NextResponse.json({ error: "Las divisiones deben sumar exactamente el total del ingreso." }, { status: 400 });
      const { error: deleteClassificationsError } = await client.from("transaction_classifications").delete().eq("transaction_id", body.transactionId);
      if (deleteClassificationsError) throw new Error(deleteClassificationsError.message);
      const { error: deleteAllocationsError } = await client.from("transaction_income_allocations").delete().eq("transaction_id", body.transactionId);
      if (deleteAllocationsError) throw new Error(deleteAllocationsError.message);
      const { error: insertAllocationsError } = await client.from("transaction_income_allocations").insert(allocations);
      if (insertAllocationsError) throw new Error(insertAllocationsError.message);
      return NextResponse.json({ ok: true });
    }
    if (body.incomeConceptId) {
      const { data: concept, error: conceptError } = await client.from("income_concepts").select("name").eq("id", body.incomeConceptId).single();
      if (conceptError) throw new Error(conceptError.message);
      if (concept?.name === "Otro ingreso" && !String(body.note ?? "").trim()) return NextResponse.json({ error: "Describe este otro ingreso antes de confirmar." }, { status: 400 });
    }
    if (body.incomeConceptId) {
      const { error: deleteAllocationsError } = await client.from("transaction_income_allocations").delete().eq("transaction_id", body.transactionId);
      if (deleteAllocationsError) throw new Error(deleteAllocationsError.message);
    }
    const { error } = await client.from("transaction_classifications").upsert({
      transaction_id: body.transactionId, income_concept_id: body.incomeConceptId ?? null, budget_item_id: body.budgetItemId ?? null,
      status: "CONFIRMED", confidence: 100, note: body.note?.trim() || null, validated_at: new Date().toISOString()
    }, { onConflict: "transaction_id" });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible guardar la clasificación." }, { status: 422 }); }
}
