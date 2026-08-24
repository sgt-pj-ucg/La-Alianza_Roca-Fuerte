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
    const [{ data: concepts, error: conceptsError }, { data: items, error: itemsError }, { data: statements, error: statementsError }] = await Promise.all([
      client.from("income_concepts").select("id,name").order("name"),
      client.from("budget_items").select("id,name,budget_categories(name)").order("name"),
      client.from("bank_statements").select("period_year,period_month,status,bank_transactions(id,booked_at,description,display_name,charge_clp,credit_clp,transaction_classifications(income_concept_id,budget_item_id),transaction_income_allocations(id,income_concept_id,amount_clp,description))").eq("period_year", 2026).eq("period_month", 1).maybeSingle()
    ]);
    if (conceptsError || itemsError || statementsError) throw new Error(conceptsError?.message ?? itemsError?.message ?? statementsError?.message);
    const transactions = (statements?.bank_transactions ?? []).sort((a: any, b: any) => b.booked_at.localeCompare(a.booked_at));
    return NextResponse.json({ concepts, items, transactions });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible cargar la clasificación." }, { status: 422 }); }
}

export async function POST(request: Request) {
  try {
    const client = await database(request);
    const body = await request.json();
    if (!body.transactionId || (!body.incomeConceptId && !body.budgetItemId && !body.allocations)) return NextResponse.json({ error: "Selecciona un concepto o partida." }, { status: 400 });
    if (Array.isArray(body.allocations)) {
      const { data: transaction, error: transactionError } = await client.from("bank_transactions").select("credit_clp").eq("id", body.transactionId).single();
      if (transactionError || !transaction?.credit_clp) throw new Error("Solo los ingresos pueden dividirse en partidas.");
      const allocations = body.allocations.map((row: any) => ({
        transaction_id: body.transactionId,
        income_concept_id: String(row.incomeConceptId ?? ""),
        amount_clp: Number(row.amountClp),
        description: String(row.description ?? "").trim()
      }));
      if (!allocations.length || allocations.some((row: any) => !row.income_concept_id || !Number.isInteger(row.amount_clp) || row.amount_clp <= 0 || !row.description)) {
        return NextResponse.json({ error: "Cada partida debe tener categoría, monto entero mayor que cero y descripción." }, { status: 400 });
      }
      if (allocations.reduce((sum: number, row: any) => sum + row.amount_clp, 0) !== Number(transaction.credit_clp)) {
        return NextResponse.json({ error: "La distribución debe sumar exactamente el 100% del ingreso." }, { status: 400 });
      }
      const { data: validConcepts, error: conceptsError } = await client.from("income_concepts").select("id").in("id", allocations.map((row: any) => row.income_concept_id));
      if (conceptsError || validConcepts?.length !== new Set(allocations.map((row: any) => row.income_concept_id)).size) throw new Error("Una categoría de ingreso no es válida.");
      const { error: deleteError } = await client.from("transaction_income_allocations").delete().eq("transaction_id", body.transactionId);
      if (deleteError) throw new Error(deleteError.message);
      const { error: insertError } = await client.from("transaction_income_allocations").insert(allocations);
      if (insertError) throw new Error(insertError.message);
      return NextResponse.json({ ok: true });
    }
    const { error } = await client.from("transaction_classifications").upsert({
      transaction_id: body.transactionId, income_concept_id: body.incomeConceptId ?? null, budget_item_id: body.budgetItemId ?? null,
      status: "CONFIRMED", confidence: 100, note: body.note?.trim() || null, validated_at: new Date().toISOString()
    }, { onConflict: "transaction_id" });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible guardar la clasificación." }, { status: 422 }); }
}
