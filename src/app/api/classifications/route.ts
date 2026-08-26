import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { INITIAL_BUDGET } from "@/lib/budget";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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
  const { data: existing, error } = await client.from("budgets").select("id").eq("year", 2026).maybeSingle();
  if (error) throw new Error(error.message);
  const concepts = ["Diezmo", "Ofrenda", "Aporte", "Misiones", "Transferencia interna", "Otro ingreso"];
  if (!existing) {
    const { data: budget, error: budgetError } = await client.from("budgets").insert({ year: 2026, source_file: "Presupuesto año 2026.xlsx" }).select("id").single();
    if (budgetError) throw new Error(budgetError.message);
    const { error: categoriesError } = await client.from("budget_categories").upsert([...new Set(INITIAL_BUDGET.map(item => item.category))].map(name => ({ budget_id: budget.id, name })), { onConflict: "budget_id,name" });
    if (categoriesError) throw new Error(categoriesError.message);
    const { data: categories, error: categoryError } = await client.from("budget_categories").select("id,name").eq("budget_id", budget.id);
    if (categoryError) throw new Error(categoryError.message);
    const ids = new Map((categories ?? []).map((row: any) => [row.name, row.id]));
    const { error: itemsError } = await client.from("budget_items").upsert(INITIAL_BUDGET.map(item => ({ category_id: ids.get(item.category), name: item.item })), { onConflict: "category_id,name" });
    if (itemsError) throw new Error(itemsError.message);
  }
  const { error: conceptsError } = await client.from("income_concepts").upsert(concepts.map(name => ({ name })), { onConflict: "name" });
  if (conceptsError) throw new Error(conceptsError.message);
}

export async function GET(request: Request) {
  try {
    const client = await database(request);
    await ensureCatalogs(client);
    const url = new URL(request.url);
    const year = Number(url.searchParams.get("year") ?? 2026);
    const month = Number(url.searchParams.get("month") ?? 1);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return NextResponse.json({ error: "El período seleccionado no es válido." }, { status: 400 });
    const [{ data: concepts, error: conceptsError }, { data: items, error: itemsError }, { data: statement, error: statementError }, { data: months, error: monthsError }] = await Promise.all([
      client.from("income_concepts").select("id,name").order("name"),
      client.from("budget_items").select("id,name,budget_categories(name)").order("name"),
      client.from("bank_statements").select("period_year,period_month,status,bank_transactions(id,booked_at,description,display_name,charge_clp,credit_clp,transaction_classifications(income_concept_id,budget_item_id,note),transaction_income_allocations(id,income_concept_id,amount_clp,description),transaction_expense_allocations(id,budget_item_id,amount_clp,description))").eq("period_year", year).eq("period_month", month).maybeSingle(),
      client.from("bank_statements").select("period_year,period_month,status").order("period_year").order("period_month")
    ]);
    if (conceptsError || itemsError || statementError || monthsError) throw new Error(conceptsError?.message ?? itemsError?.message ?? statementError?.message ?? monthsError?.message);
    const transactions = (statement?.bank_transactions ?? []).sort((a: any, b: any) => b.booked_at.localeCompare(a.booked_at));
    return NextResponse.json({ concepts, items, transactions, months: months ?? [], period: { year, month } }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible cargar la clasificación." }, { status: 422 });
  }
}

const invalid = (error: string) => NextResponse.json({ error }, { status: 400 });

export async function POST(request: Request) {
  try {
    const client = await database(request);
    const body = await request.json();
    if (!body.transactionId) return invalid("Falta el movimiento a clasificar.");
    const { data: transaction, error: transactionError } = await client.from("bank_transactions").select("id,credit_clp,charge_clp").eq("id", body.transactionId).single();
    if (transactionError || !transaction) throw new Error(transactionError?.message ?? "No se encontró el movimiento.");
    const income = Boolean(transaction.credit_clp);
    const expected = Number(transaction.credit_clp ?? transaction.charge_clp);
    const allocations = Array.isArray(body.allocations) ? body.allocations : null;

    if (allocations) {
      const rows = allocations.map((row: any) => ({
        income_concept_id: income ? String(row.incomeConceptId ?? "") : null,
        budget_item_id: income ? null : (row.budgetItemId ? String(row.budgetItemId) : null),
        amount_clp: Number(row.amountClp),
        description: String(row.description ?? "").trim()
      }));
      if (!rows.length || rows.some((row: any) => !Number.isInteger(row.amount_clp) || row.amount_clp <= 0 || !row.description || (income && !row.income_concept_id))) return invalid("Cada división necesita categoría, descripción y monto.");
      if (rows.reduce((sum: number, row: any) => sum + row.amount_clp, 0) !== expected) return invalid("Las divisiones deben sumar exactamente el total del movimiento.");
      const [{ error: classificationError }, { error: incomeClearError }, { error: expenseClearError }] = await Promise.all([
        client.from("transaction_classifications").delete().eq("transaction_id", body.transactionId),
        client.from("transaction_income_allocations").delete().eq("transaction_id", body.transactionId),
        client.from("transaction_expense_allocations").delete().eq("transaction_id", body.transactionId)
      ]);
      if (classificationError || incomeClearError || expenseClearError) throw new Error(classificationError?.message ?? incomeClearError?.message ?? expenseClearError?.message);
      const table = income ? "transaction_income_allocations" : "transaction_expense_allocations";
      const values = rows.map((row: any) => income ? { transaction_id: body.transactionId, income_concept_id: row.income_concept_id, amount_clp: row.amount_clp, description: row.description } : { transaction_id: body.transactionId, budget_item_id: row.budget_item_id, amount_clp: row.amount_clp, description: row.description });
      const { data: saved, error: saveError } = await client.from(table).insert(values).select("id");
      if (saveError) throw new Error(saveError.message);
      if ((saved?.length ?? 0) !== values.length) throw new Error("No se pudo comprobar el guardado de todas las partidas.");
      return NextResponse.json({ ok: true, saved: saved.length }, { headers: { "Cache-Control": "no-store" } });
    }

    const incomeConceptId = income ? body.incomeConceptId ?? null : null;
    const budgetItemId = income ? null : body.budgetItemId ?? null;
    const note = String(body.note ?? "").trim() || null;
    const manualExpense = !income && Boolean(body.manualExpense);
    if (income && !incomeConceptId) return invalid("Selecciona un concepto de ingreso.");
    if (!income && !budgetItemId && !manualExpense) return invalid("Selecciona una partida o elige Otro egreso.");
    if (income && body.incomeConceptName === "Otro ingreso" && !note) return invalid("Describe este otro ingreso antes de confirmar.");
    if (manualExpense && !note) return invalid("Describe este otro egreso antes de confirmar.");
    const { data: savedRows, error: saveError } = await client.rpc("confirm_transaction_classification", {
      p_transaction_id: body.transactionId,
      p_income_concept_id: incomeConceptId,
      p_budget_item_id: budgetItemId,
      p_note: note,
      p_manual_expense: manualExpense
    });
    if (saveError) throw new Error(saveError.message);
    const saved = savedRows?.[0];
    if (!saved || saved.status !== "CONFIRMED" || !saved.validated_at) throw new Error("No se pudo comprobar el guardado de la clasificación.");
    return NextResponse.json({ ok: true, saved }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible guardar la clasificación." }, { status: 422 });
  }
}
