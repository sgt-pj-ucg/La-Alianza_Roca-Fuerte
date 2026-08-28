"use client";

import { useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { clp } from "@/lib/money";
import { supabase } from "@/lib/supabase/client";
import "./dashboard.css";

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const menu = ["Resumen", "Presupuesto", "Cartolas", "Clasificación", "Ingresos", "Diezmos y aportantes", "Egresos", "Cierre mensual", "Reportes", "Configuración"];
const asList = (value: unknown): any[] => Array.isArray(value) ? value : value ? [value] : [];
const first = (value: unknown): any => asList(value)[0] ?? null;
type Item = { name: string; category: string; budget: number; executed: number };

export default function Home() {
  const [active, setActive] = useState("Resumen"); const [month, setMonth] = useState(1); const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [reopenForm, setReopenForm] = useState(false); const [reopenPassword, setReopenPassword] = useState(""); const [reopenReason, setReopenReason] = useState("");
  async function request(path: string, init?: RequestInit) {
    const session = await supabase?.auth.getSession(); const token = session?.data.session?.access_token;
    if (!token) throw new Error("Tu sesión expiró. Vuelve a iniciar sesión.");
    return fetch(path, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) } });
  }
  async function load() {
    try { setLoading(true); setError(""); const response = await request(`/api/monthly-summary?year=2026&month=${month}&check=${Date.now()}`); const payload = await response.json(); if (!response.ok) throw new Error(payload.error); setData(payload); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible cargar el resumen."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [month]);
  const model = useMemo(() => {
    const transactions = asList(data?.statement?.bank_transactions); const income = new Map<string, number>(); const incomeDetails = new Map<string, any[]>(); const expenses = new Map<string, number>(); const contributors: any[] = []; const expenseItems = new Map<string, number>();
    for (const tx of transactions) {
      const classification = first(tx.transaction_classifications); const incomeAllocations = asList(tx.transaction_income_allocations); const expenseAllocations = asList(tx.transaction_expense_allocations);
      if (tx.credit_clp) {
        const entries = incomeAllocations.length ? incomeAllocations.map(allocation => ({ name: first(allocation.income_concepts)?.name ?? "Ingreso sin nombre", amount: Number(allocation.amount_clp), description: allocation.description })) : classification ? [{ name: first(classification.income_concepts)?.name ?? "Ingreso sin categoría", amount: Number(tx.credit_clp), description: classification.note ?? tx.display_name ?? tx.description }] : [];
        entries.forEach(entry => { income.set(entry.name, (income.get(entry.name) ?? 0) + entry.amount); incomeDetails.set(entry.name, [...(incomeDetails.get(entry.name) ?? []), { bookedAt: tx.booked_at, description: entry.description ?? tx.display_name ?? tx.description, amount: entry.amount }]); if (["Diezmo", "Aporte"].includes(entry.name)) contributors.push({ ...entry, bookedAt: tx.booked_at }); });
      } else if (tx.charge_clp) {
        const entries = expenseAllocations.length ? expenseAllocations.map(allocation => ({ name: first(allocation.budget_items)?.name ?? "Otro egreso", category: first(first(allocation.budget_items)?.budget_categories)?.name ?? "Otros", amount: Number(allocation.amount_clp) })) : classification ? [{ name: first(classification.budget_items)?.name ?? (classification.note ? "Otro egreso" : "Egreso sin categoría"), category: first(first(classification.budget_items)?.budget_categories)?.name ?? "Otros", amount: Number(tx.charge_clp) }] : [];
        entries.forEach(entry => { expenses.set(entry.category, (expenses.get(entry.category) ?? 0) + entry.amount); expenseItems.set(`${entry.category}|${entry.name}`, (expenseItems.get(`${entry.category}|${entry.name}`) ?? 0) + entry.amount); });
      }
    }
    const budgetItems: Item[] = asList(data?.budget?.budget_categories).flatMap(category => asList(category.budget_items).map((item: any) => {
      const monthlyValue = asList(item.monthly_budgets).find((row: any) => Number(row.month) === month);
      return { name: item.name, category: category.name, budget: Number(monthlyValue?.amount_clp ?? 0), executed: expenseItems.get(`${category.name}|${item.name}`) ?? 0 };
    }));
    const totalIncome = [...income.values()].reduce((sum, value) => sum + value, 0); const totalExpense = [...expenses.values()].reduce((sum, value) => sum + value, 0);
    const confirmed = transactions.filter((tx: any) => asList(tx.transaction_classifications).length || asList(tx.transaction_income_allocations).length || asList(tx.transaction_expense_allocations).length).length;
    return { transactions, income, incomeDetails, expenses, expenseItems, contributors, budgetItems, totalIncome, totalExpense, confirmed, pending: transactions.length - confirmed };
  }, [data]);
  async function closeMonth() {
    if (model.pending) { setError(`No se puede cerrar: quedan ${model.pending} movimiento(s) sin clasificar.`); return; }
    if (!window.confirm(`¿Confirmas el cierre definitivo de ${MONTHS[month - 1]} 2026?`)) return;
    try { setError(""); setNotice(""); const response = await request("/api/monthly-summary", { method: "POST", body: JSON.stringify({ year: 2026, month }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error); setNotice(`${MONTHS[month - 1]} 2026 quedó cerrado y protegido contra nuevas clasificaciones.`); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible cerrar el mes."); }
  }
  async function reopenMonth() {
    try {
      setError(""); setNotice("");
      const response = await request("/api/monthly-summary/reopen", { method: "POST", body: JSON.stringify({ year: 2026, month, password: reopenPassword, reason: reopenReason }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error);
      setReopenPassword(""); setReopenReason(""); setReopenForm(false);
      setNotice(`${MONTHS[month - 1]} 2026 fue reabierto de forma controlada. El ajuste queda registrado en auditoría.`); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible reabrir el mes."); }
  }
  function navigate(name: string) { if (name === "Cartolas") return window.location.assign("/cartolas"); if (name === "Clasificación") return window.location.assign("/clasificacion"); if (name === "Reportes") return window.location.assign("/reportes"); setActive(name); setNotice(""); setError(""); }
  const monthClosed = data?.statement?.status === "CLOSED"; const rows = [...model.income.entries()].sort((a, b) => b[1] - a[1]);
  const expenditure = [...model.expenseItems.entries()].map(([key, executed]) => { const [category, name] = key.split("|"); const budget = model.budgetItems.find(item => item.category === category && item.name === name)?.budget ?? 0; return { category, name, executed, budget }; }).sort((a, b) => b.executed - a.executed);
  return <AuthGate><main className="app-shell"><aside className="sidebar"><div className="sidebar-profile"><i>MV</i><span>Miriam Véliz Cortés<small>Tesorería</small></span></div><div className="brand"><div>TESORERÍA<small>Iglesia · 2026</small></div></div><nav>{menu.map(name => <button key={name} className={active === name ? "active" : ""} onClick={() => navigate(name)}>{name}</button>)}</nav><div className="sidebar-foot">Datos financieros en CLP<br/><span>Gestión mensual</span></div></aside>
    <section className="workspace"><header><div><p className="eyebrow">GESTIÓN FINANCIERA</p><h1>{active}</h1><p className="subhead">Resumen basado en los movimientos confirmados de la cartola.</p></div><img className="header-logo" src="/logo-la-alianza.png" alt="La Alianza Roca Fuerte"/></header>
      <div className="toolbar report-toolbar"><div><h2>{MONTHS[month - 1]} 2026</h2><p>{monthClosed ? "Mes cerrado: los registros quedan protegidos." : "Información actualizada desde Supabase."}</p></div><select value={month} onChange={event => setMonth(Number(event.target.value))}>{asList(data?.months).map((period: any) => <option key={`${period.period_year}-${period.period_month}`} value={period.period_month}>{MONTHS[period.period_month - 1]} {period.period_year}</option>)}</select></div>
      {loading ? <p className="report-state">Actualizando información financiera…</p> : error ? <p className="classification-error">{error}</p> : <>{notice && <p className="classification-notice">✓ {notice}</p>}<p className="classification-notice">✓ Presupuesto fuente validado: {data?.integrity?.checkedEntries ?? 0} valores mensuales revisados contra el presupuesto 2026{data?.integrity?.completedEntries ? ` · ${data.integrity.completedEntries} valor(es) faltante(s) completado(s) desde la fuente.` : "."}</p>
        {active === "Resumen" && <><div className="cards"><article><small>INGRESOS CONFIRMADOS</small><strong>{clp(model.totalIncome)}</strong><span>Abonos clasificados</span></article><article><small>EGRESOS CONFIRMADOS</small><strong>{clp(model.totalExpense)}</strong><span>Cargos clasificados</span></article><article><small>SALDO DEL MES</small><strong>{clp(model.totalIncome - model.totalExpense)}</strong><span>{model.pending ? `${model.pending} pendiente(s)` : "Todo clasificado"}</span></article></div><section className="notice"><b>{model.pending ? "!" : "✓"}</b><div><strong>{model.pending ? "Aún hay movimientos pendientes" : "Clasificación completa"}</strong><br/>{model.pending ? `Faltan ${model.pending} movimiento(s) antes del cierre.` : `${model.confirmed} movimientos están listos para revisión y cierre.`}</div></section></>}
        {active === "Presupuesto" && <BudgetTable rows={model.budgetItems} />}
        {active === "Ingresos" && <IncomeBreakdown rows={rows.map(([name, amount]) => ({ name, amount, details: model.incomeDetails.get(name) ?? [] }))} total={model.totalIncome} />}
        {active === "Diezmos y aportantes" && <section className="table-card"><div className="table-head"><h3>Diezmos y aportes</h3><span>Según las clasificaciones confirmadas</span></div><Table rows={model.contributors.map(row => [row.bookedAt, row.name, row.description, clp(row.amount)])} headings={["Fecha", "Concepto", "Descripción", "Monto"]} empty="No hay diezmos o aportes clasificados para este mes." /></section>}
        {active === "Egresos" && <section className="table-card"><div className="table-head"><h3>Egresos ejecutados por partida</h3><span>Total: {clp(model.totalExpense)}</span></div><Table rows={expenditure.map(row => [row.category, row.name, clp(row.budget), clp(row.executed), clp(row.budget - row.executed)])} headings={["Categoría", "Partida", "Presupuesto", "Ejecutado", "Disponible"]} empty="No hay egresos clasificados para este mes." /></section>}
        {active === "Cierre mensual" && <section className="close-card"><p className="eyebrow">CONTROL DE CIERRE</p><h2>{MONTHS[month - 1]} 2026</h2><div className="close-grid"><div><small>MOVIMIENTOS</small><b>{model.transactions.length}</b></div><div><small>CLASIFICADOS</small><b>{model.confirmed}</b></div><div><small>PENDIENTES</small><b>{model.pending}</b></div><div><small>SALDO</small><b>{clp(model.totalIncome - model.totalExpense)}</b></div></div>{monthClosed ? <><p className="close-ok">✓ Este mes está cerrado y protegido. Una corrección excepcional requiere autorización de la tesorera.</p>{!reopenForm ? <button className="secondary" onClick={() => setReopenForm(true)}>Solicitar reapertura controlada</button> : <div className="reopen-form"><h3>Autorizar ajuste excepcional</h3><p>Ingresa la contraseña de la tesorera y explica el motivo. La contraseña no se guarda; la reapertura y su motivo quedan en auditoría.</p><input type="password" autoComplete="current-password" placeholder="Contraseña de la tesorera" value={reopenPassword} onChange={event => setReopenPassword(event.target.value)} /><textarea placeholder="Motivo del ajuste (mínimo 8 caracteres)" value={reopenReason} onChange={event => setReopenReason(event.target.value)} /><div><button className="primary" onClick={() => void reopenMonth()}>Autorizar y reabrir</button><button className="secondary" onClick={() => { setReopenForm(false); setReopenPassword(""); setReopenReason(""); }}>Cancelar</button></div></div>}</> : <><p className="subhead">Al cerrar, el sistema bloqueará nuevas clasificaciones para este período.</p><button className="primary" disabled={Boolean(model.pending)} onClick={() => void closeMonth()}>{model.pending ? "Completa la clasificación para cerrar" : `Cerrar ${MONTHS[month - 1]} definitivamente`}</button></>}</section>}
        {["Reportes", "Configuración"].includes(active) && <section className="report-state">Esta sección se habilitará después de consolidar los cierres mensuales.</section>}</>}
    </section></main></AuthGate>;
}

function Table({ headings, rows, empty = "No hay registros para mostrar." }: { headings: string[]; rows: (string | number)[][]; empty?: string }) { return <div className="table-wrap"><table><thead><tr>{headings.map(heading => <th key={heading}>{heading}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row, index) => <tr key={index}>{row.map((value, cell) => <td key={cell} className={cell >= row.length - 2 ? "money" : ""}>{value}</td>)}</tr>) : <tr><td colSpan={headings.length} className="empty-cell">{empty}</td></tr>}</tbody></table></div>; }
function IncomeBreakdown({ rows, total }: { rows: { name: string; amount: number; details: any[] }[]; total: number }) { return <section className="table-card"><div className="table-head"><h3>Ingresos confirmados por concepto</h3><span>Total: {clp(total)}</span></div><div className="table-wrap"><table><thead><tr><th>Concepto</th><th>Monto recibido</th></tr></thead><tbody>{rows.map(row => <tr key={row.name}><td><details className="income-detail"><summary>{row.name}<small>Ver {row.details.length} movimiento(s)</small></summary><div className="movement-list">{row.details.map((detail, index) => <div key={`${detail.bookedAt}-${index}`}><span>{detail.bookedAt}</span><span>{detail.description}</span><b>{clp(detail.amount)}</b></div>)}</div></details></td><td className="money">{clp(row.amount)}</td></tr>)}</tbody></table></div></section>; }
function BudgetTable({ rows }: { rows: Item[] }) { const totalBudget = rows.reduce((sum, row) => sum + row.budget, 0); const totalExecuted = rows.reduce((sum, row) => sum + row.executed, 0); return <section className="table-card"><div className="table-head"><h3>Presupuesto versus ejecución</h3><span>Montos en CLP</span></div><div className="table-wrap"><table><thead><tr><th>Categoría</th><th>Partida</th><th>Presupuesto</th><th>Ejecutado</th><th>Disponible</th></tr></thead><tbody>{rows.map(row => <tr key={`${row.category}-${row.name}`}><td>{row.category}</td><td>{row.name}</td><td className="money">{clp(row.budget)}</td><td className="money">{clp(row.executed)}</td><td className="money">{clp(row.budget - row.executed)}</td></tr>)}</tbody><tfoot><tr><td colSpan={2}>Total del mes</td><td className="money">{clp(totalBudget)}</td><td className="money">{clp(totalExecuted)}</td><td className="money">{clp(totalBudget - totalExecuted)}</td></tr></tfoot></table></div></section>; }
