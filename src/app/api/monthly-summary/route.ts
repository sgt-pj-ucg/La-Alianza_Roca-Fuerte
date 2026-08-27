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
  const { data, error } = await client.auth.getUser(authorization.slice(7));
  if (error || !data.user) throw new Error("Tu sesión expiró. Vuelve a iniciar sesión.");
  return client;
}

const list = (value: unknown) => Array.isArray(value) ? value : value ? [value] : [];
const first = (value: unknown): any => list(value)[0] ?? null;
const noStore = { headers: { "Cache-Control": "no-store, max-age=0" } };

// Completa solo los meses ausentes desde el Excel original; nunca sobrescribe una cifra ya registrada.
async function ensureMonthlyBudgets(client: any) {
  const [{ data: budget, error: budgetError }, { data: items, error: itemsError }, { data: existing, error: existingError }] = await Promise.all([
    client.from("budgets").select("id").eq("year", 2026).maybeSingle(),
    client.from("budget_items").select("id,name,budget_categories!inner(name,budget_id)"),
    client.from("monthly_budgets").select("budget_item_id,month,amount_clp")
  ]);
  if (budgetError || itemsError || existingError) throw new Error(budgetError?.message ?? itemsError?.message ?? existingError?.message);
  if (!budget) throw new Error("Integridad presupuestaria bloqueada: no existe el presupuesto base 2026.");
  const itemIds = new Map(list(items).filter((item: any) => first(item.budget_categories)?.budget_id === budget.id).map((item: any) => [`${first(item.budget_categories)?.name}|${item.name}`, item.id]));
  const present = new Map(list(existing).map((row: any) => [`${row.budget_item_id}|${row.month}`, Number(row.amount_clp)]));
  const mismatches: string[] = [];
  const missing = INITIAL_BUDGET.flatMap(line => line.amounts.map((amount, index) => {
    const budgetItemId = itemIds.get(`${line.category}|${line.item}`);
    const expected = amount ?? 0;
    if (!budgetItemId) { mismatches.push(`No existe la partida ${line.item}`); return null; }
    const actual = present.get(`${budgetItemId}|${index + 1}`);
    if (actual !== undefined && actual !== expected) { mismatches.push(`${line.item} · mes ${index + 1}: esperado ${expected}, encontrado ${actual}`); return null; }
    return actual === undefined ? { budget_item_id: budgetItemId, month: index + 1, amount_clp: expected } : null;
  }).filter(Boolean));
  if (mismatches.length) throw new Error(`Integridad presupuestaria bloqueada: ${mismatches.slice(0, 3).join("; ")}${mismatches.length > 3 ? ` y ${mismatches.length - 3} diferencia(s) más` : ""}.`);
  if (missing.length) {
    const { error } = await client.from("monthly_budgets").insert(missing);
    if (error) throw new Error(error.message);
  }
  return { checkedEntries: INITIAL_BUDGET.length * 12, completedEntries: missing.length };
}

export async function GET(request: Request) {
  try {
    const client = await database(request);
    const integrity = await ensureMonthlyBudgets(client);
    const url = new URL(request.url);
    const year = Number(url.searchParams.get("year") ?? 2026);
    const month = Number(url.searchParams.get("month") ?? 1);
    const [{ data: statement, error: statementError }, { data: months, error: monthsError }, { data: budgets, error: budgetsError }] = await Promise.all([
      client.from("bank_statements").select("id,status,period_year,period_month,bank_transactions(id,booked_at,description,display_name,charge_clp,credit_clp,transaction_classifications(income_concept_id,budget_item_id,note,status,validated_at,income_concepts(name),budget_items(name,budget_categories(name))),transaction_income_allocations(amount_clp,description,income_concept_id,income_concepts(name)),transaction_expense_allocations(amount_clp,description,budget_item_id,budget_items(name,budget_categories(name))) )").eq("period_year", year).eq("period_month", month).maybeSingle(),
      client.from("bank_statements").select("period_year,period_month,status").order("period_year").order("period_month"),
      client.from("budgets").select("id,year,budget_categories(name,budget_items(id,name,monthly_budgets(month,amount_clp)))").eq("year", year).maybeSingle()
    ]);
    if (statementError || monthsError || budgetsError) throw new Error(statementError?.message ?? monthsError?.message ?? budgetsError?.message);
    const transactions = list(statement?.bank_transactions).map((row: any) => ({
      ...row,
      transaction_classifications: list(row.transaction_classifications),
      transaction_income_allocations: list(row.transaction_income_allocations),
      transaction_expense_allocations: list(row.transaction_expense_allocations)
    }));
    return NextResponse.json({ statement: statement ? { ...statement, bank_transactions: transactions } : null, months: months ?? [], budget: budgets ?? null, integrity }, noStore);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible cargar el resumen mensual." }, { status: 422, ...noStore });
  }
}

export async function POST(request: Request) {
  try {
    const client = await database(request);
    const { year, month } = await request.json();
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) throw new Error("El período seleccionado no es válido.");
    // Un mes jamás se puede cerrar si el presupuesto base presenta diferencias.
    await ensureMonthlyBudgets(client);
    const { data: statement, error } = await client.from("bank_statements").select("id,status,bank_transactions(id,transaction_classifications(id),transaction_income_allocations(id),transaction_expense_allocations(id))").eq("period_year", year).eq("period_month", month).single();
    if (error || !statement) throw new Error(error?.message ?? "No existe una cartola para este mes.");
    const pending = list(statement.bank_transactions).filter((row: any) => !list(row.transaction_classifications).length && !list(row.transaction_income_allocations).length && !list(row.transaction_expense_allocations).length);
    if (pending.length) throw new Error(`No se puede cerrar: hay ${pending.length} movimiento(s) pendiente(s) de clasificación.`);
    const now = new Date().toISOString();
    const [{ error: closeError }, { error: statementError }] = await Promise.all([
      client.from("monthly_closes").upsert({ year, month, closed_at: now, reopened_at: null }, { onConflict: "year,month" }),
      client.from("bank_statements").update({ status: "CLOSED" }).eq("id", statement.id)
    ]);
    if (closeError || statementError) throw new Error(closeError?.message ?? statementError?.message);
    return NextResponse.json({ ok: true, closedAt: now }, noStore);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible cerrar el mes." }, { status: 422, ...noStore });
  }
}
