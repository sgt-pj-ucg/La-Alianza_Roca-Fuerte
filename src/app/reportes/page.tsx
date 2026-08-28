"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { AuthGate } from "@/components/auth-gate";
import { clp } from "@/lib/money";
import { supabase } from "@/lib/supabase/client";
import "./reportes.css";

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const COLORS = ["#174b3b", "#24865f", "#d89b38", "#6aa784", "#85b6aa", "#bc7652"];
const list = (value: unknown): any[] => Array.isArray(value) ? value : value ? [value] : [];
const first = (value: unknown): any => list(value)[0] ?? null;
const number = (value: unknown) => Number(value ?? 0);

type Detail = { date: string; member: string; description: string; concept: string; amount: number };
type PeriodPoint = { month: number; label: string; income: number; expense: number; balance: number; tithes: number; offerings: number; missions: number };
type Breakdown = { name: string; amount: number };

function transactionEntries(transaction: any, kind: "income" | "expense") {
  const classification = first(transaction.transaction_classifications);
  if (kind === "income") {
    const allocations = list(transaction.transaction_income_allocations);
    return allocations.length
      ? allocations.map((allocation: any) => ({ name: first(allocation.income_concepts)?.name ?? "Ingreso sin categoría", amount: number(allocation.amount_clp), description: allocation.description ?? transaction.description }))
      : classification ? [{ name: first(classification.income_concepts)?.name ?? "Ingreso sin categoría", amount: number(transaction.credit_clp), description: classification.note ?? transaction.description }] : [];
  }
  const allocations = list(transaction.transaction_expense_allocations);
  return allocations.length
    ? allocations.map((allocation: any) => ({ category: first(first(allocation.budget_items)?.budget_categories)?.name ?? "Otros", name: first(allocation.budget_items)?.name ?? "Otro egreso", amount: number(allocation.amount_clp) }))
    : classification ? [{ category: first(first(classification.budget_items)?.budget_categories)?.name ?? "Otros", name: first(classification.budget_items)?.name ?? "Otro egreso", amount: number(transaction.charge_clp) }] : [];
}

function periodPoint(payload: any, month: number): PeriodPoint {
  let income = 0; let expense = 0; let tithes = 0; let offerings = 0; let missions = 0;
  for (const transaction of list(payload?.statement?.bank_transactions)) {
    if (number(transaction.credit_clp) > 0) for (const entry of transactionEntries(transaction, "income") as any[]) {
      income += entry.amount;
      if (entry.name === "Diezmo") tithes += entry.amount;
      if (entry.name === "Ofrenda") offerings += entry.amount;
      if (entry.name === "Misiones") missions += entry.amount;
    }
    if (number(transaction.charge_clp) > 0) for (const entry of transactionEntries(transaction, "expense") as any[]) expense += entry.amount;
  }
  return { month, label: MONTHS[month - 1], income, expense, balance: income - expense, tithes, offerings, missions };
}

export default function ReportesPage() {
  const [month, setMonth] = useState(1);
  const [data, setData] = useState<any>(null);
  const [history, setHistory] = useState<PeriodPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [chart, setChart] = useState<"income" | "expense">("income");

  async function request(path: string) {
    const session = await supabase?.auth.getSession();
    const token = session?.data.session?.access_token;
    if (!token) throw new Error("Tu sesión expiró. Vuelve a iniciar sesión.");
    return fetch(path, { cache: "no-store", headers: { Authorization: `Bearer ${token}` } });
  }

  async function load(selectedMonth: number) {
    try {
      setLoading(true); setError("");
      const response = await request(`/api/monthly-summary?year=2026&month=${selectedMonth}&report=${Date.now()}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      const closed = list(payload.months).filter((period: any) => period.period_year === 2026 && period.status === "CLOSED").sort((a: any, b: any) => Number(a.period_month) - Number(b.period_month));
      if (closed.length && !closed.some((period: any) => Number(period.period_month) === selectedMonth)) { setMonth(Number(closed[0].period_month)); return; }
      const snapshots: { payload: any; periodMonth: number }[] = [{ payload, periodMonth: selectedMonth }];
      for (const period of closed) {
        const periodMonth = Number(period.period_month);
        if (periodMonth === selectedMonth) continue;
        const otherResponse = await request(`/api/monthly-summary?year=2026&month=${periodMonth}&reportHistory=${Date.now()}`);
        const otherPayload = await otherResponse.json();
        if (!otherResponse.ok) throw new Error(otherPayload.error ?? "No fue posible cargar el histórico oficial.");
        snapshots.push({ payload: otherPayload, periodMonth });
      }
      setData(payload);
      setHistory(snapshots.map(snapshot => periodPoint(snapshot.payload, snapshot.periodMonth)).sort((a, b) => a.month - b.month));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible preparar los reportes."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(month); }, [month]);

  const model = useMemo(() => {
    const income = new Map<string, number>(); const expenses = new Map<string, number>();
    const memberDetails: Detail[] = []; const missionDetails: Detail[] = []; const unassigned: Detail[] = [];
    const budgetByItem = new Map<string, number>();
    for (const category of list(data?.budget?.budget_categories)) for (const item of list(category.budget_items)) {
      const monthly = list(item.monthly_budgets).find((row: any) => Number(row.month) === month);
      budgetByItem.set(`${category.name}|${item.name}`, number(monthly?.amount_clp));
    }
    for (const transaction of list(data?.statement?.bank_transactions)) {
      const member = String(transaction.display_name ?? "").trim();
      if (number(transaction.credit_clp) > 0) for (const entry of transactionEntries(transaction, "income") as any[]) {
        income.set(entry.name, (income.get(entry.name) ?? 0) + entry.amount);
        const detail = { date: transaction.booked_at, member: member || "Sin nombre asignado", description: entry.description, concept: entry.name, amount: entry.amount };
        if (["Diezmo", "Aporte", "Misiones", "Ofrenda"].includes(entry.name)) memberDetails.push(detail);
        if (entry.name === "Misiones") missionDetails.push(detail);
        if (["Diezmo", "Aporte", "Misiones", "Ofrenda"].includes(entry.name) && !member) unassigned.push(detail);
      }
      if (number(transaction.charge_clp) > 0) for (const entry of transactionEntries(transaction, "expense") as any[]) {
        const key = `${entry.category}|${entry.name}`;
        expenses.set(key, (expenses.get(key) ?? 0) + entry.amount);
      }
    }
    const incomeRows = [...income.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
    const expenseRows = [...expenses.entries()].map(([key, amount]) => { const [category, item] = key.split("|"); const budget = budgetByItem.get(key) ?? 0; return { category, item, amount, budget, variance: budget - amount }; }).sort((a, b) => b.amount - a.amount);
    const totalIncome = incomeRows.reduce((sum, row) => sum + row.amount, 0); const totalExpense = expenseRows.reduce((sum, row) => sum + row.amount, 0);
    const tithes = income.get("Diezmo") ?? 0; const offerings = income.get("Ofrenda") ?? 0; const missions = income.get("Misiones") ?? 0; const taxableBase = tithes + offerings;
    const totalBudget = [...budgetByItem.values()].reduce((sum, value) => sum + value, 0);
    const memberSummary = new Map<string, { name: string; tithe: number; offering: number; missions: number; aporte: number; total: number }>();
    for (const row of memberDetails) {
      const current = memberSummary.get(row.member) ?? { name: row.member, tithe: 0, offering: 0, missions: 0, aporte: 0, total: 0 };
      if (row.concept === "Diezmo") current.tithe += row.amount; if (row.concept === "Ofrenda") current.offering += row.amount; if (row.concept === "Misiones") current.missions += row.amount; if (row.concept === "Aporte") current.aporte += row.amount;
      current.total += row.amount; memberSummary.set(row.member, current);
    }
    return { incomeRows, expenseRows, memberDetails, missionDetails, unassigned, members: [...memberSummary.values()].sort((a, b) => b.total - a.total), totalIncome, totalExpense, tithes, offerings, missions, taxableBase, payment15: Math.round(taxableBase * .15), payment1: Math.round(taxableBase * .01), totalBudget, budgetExecution: totalBudget ? totalExpense / totalBudget : 0, balance: totalIncome - totalExpense };
  }, [data, month]);

  const closedMonths = list(data?.months).filter((period: any) => period.period_year === 2026 && period.status === "CLOSED");
  const monthClosed = data?.statement?.status === "CLOSED";
  function downloadWorkbook(kind: "members" | "missions") {
    const rows = kind === "missions" ? model.missionDetails.map(row => ({ Mes: `${MONTHS[month - 1]} 2026`, Fecha: row.date, Nombre: row.member, Concepto: row.concept, Descripción: row.description, Monto_CLP: row.amount })) : model.members.map(row => ({ Mes: `${MONTHS[month - 1]} 2026`, Nombre: row.name, Diezmos_CLP: row.tithe, Ofrendas_CLP: row.offering, Misiones_CLP: row.missions, Aportes_CLP: row.aporte, Total_CLP: row.total }));
    const worksheet = XLSX.utils.json_to_sheet(rows); worksheet["!cols"] = [{ wch: 15 }, { wch: 15 }, { wch: 34 }, { wch: 18 }, { wch: 46 }, { wch: 18 }];
    const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, worksheet, kind === "missions" ? "Misiones" : "Miembros"); XLSX.writeFile(workbook, `${kind === "missions" ? "Aportes_Misiones" : "Miembros"}_${MONTHS[month - 1]}_2026.xlsx`);
  }

  return <AuthGate><main className="reports-shell"><a href="/" className="reports-back"><span>←</span> Volver al panel</a><header className="reports-header"><div><p className="eyebrow">REPORTABILIDAD FINANCIERA</p><h1>Informes de tesorería</h1><p>Indicadores oficiales, trazables y listos para apoyar la gestión mensual.</p></div><img src="/logo-la-alianza.png" alt="La Alianza Roca Fuerte"/></header>
    <section className="reports-control"><div><b>Período de informe</b><span>Solo se muestran meses cerrados oficialmente.</span></div><select value={month} onChange={event => setMonth(Number(event.target.value))}>{closedMonths.map((period: any) => <option key={period.period_month} value={period.period_month}>{MONTHS[period.period_month - 1]} {period.period_year}</option>)}</select></section>
    {loading ? <p className="reports-state">Preparando cifras oficiales…</p> : error ? <p className="reports-error">{error}</p> : !monthClosed ? <p className="reports-error">Este período no está cerrado. No se emiten reportes oficiales hasta completar y cerrar el mes.</p> : <><section className="official-band"><span>✓</span><div><b>Informe oficial · {MONTHS[month - 1]} 2026</b><p>Fuente: cartola conciliada, clasificaciones confirmadas y cierre mensual protegido.</p></div><button onClick={() => void load(month)}>Actualizar cifras</button></section>
      <section className="reports-kpis"><Kpi label="Ingresos totales" value={clp(model.totalIncome)} note="Abonos confirmados"/><Kpi label="Gastos totales" value={clp(model.totalExpense)} note="Cargos clasificados"/><Kpi label="Saldo operativo" value={clp(model.balance)} note="Ingresos menos gastos" positive={model.balance >= 0}/><Kpi label="Aporte a misiones" value={clp(model.missions)} note="Ingresos clasificados como Misiones"/><Kpi label="Diezmos" value={clp(model.tithes)} note="Base principal"/><Kpi label="Ofrendas" value={clp(model.offerings)} note="Parte del total imponible"/></section>
      <section className="tax-card"><div><p className="eyebrow">CÁLCULO DE APORTES</p><h2>Total imponible</h2><p>Diezmos + ofrendas. El cálculo se realiza solo sobre ingresos confirmados del período cerrado.</p></div><div className="tax-amount"><span>Base imponible</span><b>{clp(model.taxableBase)}</b></div><div className="tax-amount"><span>15% a pagar</span><b>{clp(model.payment15)}</b></div><div className="tax-amount"><span>1% a pagar</span><b>{clp(model.payment1)}</b></div><div className="tax-total"><span>Total 16%</span><b>{clp(model.payment15 + model.payment1)}</b></div></section>
      <section className="visual-grid"><article className="chart-card trend-card"><div className="chart-head"><div><p className="eyebrow">EVOLUCIÓN OFICIAL</p><h2>Ingresos, gastos y saldo mensual</h2><p>Interactúa con los puntos para revisar cada cierre.</p></div></div><TrendChart points={history}/></article><article className="chart-card"><div className="chart-head"><div><p className="eyebrow">COMPOSICIÓN</p><h2>Origen de los ingresos</h2><p>Selecciona un concepto para conocer su participación.</p></div></div><DonutChart rows={model.incomeRows}/></article></section>
      <section className="visual-grid visual-grid-secondary"><article className="chart-card"><div className="chart-head"><div><p className="eyebrow">RANKING INTERACTIVO</p><h2>{chart === "income" ? "Ingresos por concepto" : "Egresos por partida"}</h2><p>Haz clic en una barra para resaltar su valor exacto.</p></div><div className="chart-toggle"><button className={chart === "income" ? "selected" : ""} onClick={() => setChart("income")}>Ingresos</button><button className={chart === "expense" ? "selected" : ""} onClick={() => setChart("expense")}>Egresos</button></div></div><InteractiveBars rows={chart === "income" ? model.incomeRows : model.expenseRows.slice(0, 8).map(row => ({ name: row.item, amount: row.amount }))}/></article><article className="chart-card budget-card"><p className="eyebrow">PRESUPUESTO</p><h2>Ejecución del mes</h2><b>{Math.round(model.budgetExecution * 100)}%</b><p>{clp(model.totalExpense)} ejecutado de {clp(model.totalBudget)} presupuestado.</p><div className="progress"><i style={{ width: `${Math.min(model.budgetExecution * 100, 100)}%` }}/></div><small>{model.budgetExecution > 1 ? "Hay partidas que requieren revisión por sobre-ejecución." : "Ejecución dentro del presupuesto total mensual."}</small><BudgetBars rows={model.expenseRows}/></article></section>
      <section className="reports-table-card"><div className="reports-table-head"><div><p className="eyebrow">DIEZMOS</p><h2>Informe de miembros diezmadores</h2><p>Nómina de quienes registran al menos un diezmo confirmado durante el mes.</p></div></div><ReportTable headings={["Nombre", "Diezmos", "Ofrendas", "Total entregado"]} rows={model.members.filter(row => row.tithe > 0).map(row => [row.name, clp(row.tithe), clp(row.offering), clp(row.total)])} empty="No hay diezmos identificados en este período." /></section>
      <section className="reports-table-card"><div className="reports-table-head"><div><p className="eyebrow">MIEMBROS Y APORTANTES</p><h2>Listado de miembros por mes</h2><p>La identificación usa el nombre validado en cada movimiento. “Sin nombre asignado” requiere completar “Editar nombre” antes de usarlo como nómina oficial.</p></div><button onClick={() => downloadWorkbook("members")}>↓ Exportar Excel</button></div><ReportTable headings={["Nombre", "Diezmos", "Ofrendas", "Misiones", "Aportes", "Total"]} rows={model.members.map(row => [row.name, clp(row.tithe), clp(row.offering), clp(row.missions), clp(row.aporte), clp(row.total)])} empty="No hay aportantes identificados en este período." /></section>
      <section className="reports-table-card"><div className="reports-table-head"><div><p className="eyebrow">MISIONES</p><h2>Aportantes a misiones por mes</h2><p>Detalle listo para Excel con nombre, fecha, descripción y monto entregado.</p></div><button onClick={() => downloadWorkbook("missions")}>↓ Exportar Excel</button></div><ReportTable headings={["Fecha", "Nombre", "Descripción", "Monto"]} rows={model.missionDetails.map(row => [row.date, row.member, row.description, clp(row.amount)])} empty="No hay aportes a misiones en este período." /></section>
      <section className="reports-table-card"><div className="reports-table-head"><div><p className="eyebrow">CONTROL</p><h2>Egresos, presupuesto y desviación</h2><p>La desviación negativa indica que el gasto supera el presupuesto asignado.</p></div></div><ReportTable headings={["Categoría", "Partida", "Presupuesto", "Ejecutado", "Disponible"]} rows={model.expenseRows.map(row => [row.category, row.item, clp(row.budget), clp(row.amount), clp(row.variance)])} empty="No hay egresos clasificados en este período." /></section>
      {model.unassigned.length > 0 && <section className="data-warning"><b>Atención de calidad de datos</b><p>Hay {model.unassigned.length} aporte(s) de miembro sin nombre validado. Los totales financieros son correctos, pero esas filas no deben interpretarse como una nómina final hasta identificar al aportante.</p></section>}
    </>}</main></AuthGate>;
}

function Kpi({ label, value, note, positive }: { label: string; value: string; note: string; positive?: boolean }) { return <article className={positive ? "kpi-positive" : ""}><small>{label}</small><strong>{value}</strong><span>{note}</span></article>; }
function TrendChart({ points }: { points: PeriodPoint[] }) {
  const [selected, setSelected] = useState(Math.max(points.length - 1, 0)); const [showIncome, setShowIncome] = useState(true); const [showExpense, setShowExpense] = useState(true);
  useEffect(() => setSelected(Math.max(points.length - 1, 0)), [points.length]);
  if (!points.length) return <p className="chart-empty">No hay cierres oficiales para mostrar.</p>;
  if (points.length === 1) return <div className="trend-empty"><b>{points[0].label} 2026 es el primer cierre oficial</b><span>La tendencia comparativa aparecerá automáticamente al cerrar un segundo mes. Mientras tanto, la composición y ejecución de este período están disponibles.</span><div><strong>{clp(points[0].income)}</strong><small>ingresos del período</small><strong>{clp(points[0].expense)}</strong><small>gastos del período</small></div></div>;
  const max = Math.max(...points.flatMap(point => [point.income, point.expense]), 1); const w = 720; const h = 230; const px = 42; const py = 24;
  const x = (index: number) => px + index * ((w - px * 2) / Math.max(points.length - 1, 1)); const y = (value: number) => h - py - value / max * (h - py * 2);
  const path = (field: "income" | "expense") => points.map((point, index) => `${index ? "L" : "M"}${x(index)},${y(point[field])}`).join(" "); const active = points[Math.min(selected, points.length - 1)];
  return <div className="trend-wrap"><div className="trend-controls"><button className={showIncome ? "active-income" : ""} onClick={() => setShowIncome(value => !value)}><i/>Ingresos</button><button className={showExpense ? "active-expense" : ""} onClick={() => setShowExpense(value => !value)}><i/>Gastos</button></div><svg className="trend-svg" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Comparación mensual de ingresos y gastos">{[.25,.5,.75,1].map(tick => <line key={tick} x1={px} x2={w - px} y1={y(max * tick)} y2={y(max * tick)} />)}{showIncome && <path className="income-line" d={path("income")}/>} {showExpense && <path className="expense-line" d={path("expense")}/>} {points.map((point,index) => <g key={point.month}><circle className="trend-point-hit" cx={x(index)} cy={y(showIncome ? point.income : point.expense)} r="13" onMouseEnter={() => setSelected(index)} onFocus={() => setSelected(index)} tabIndex={0}/>{showIncome && <circle className="income-dot" cx={x(index)} cy={y(point.income)} r="5"/>}{showExpense && <circle className="expense-dot" cx={x(index)} cy={y(point.expense)} r="5"/>}<text x={x(index)} y={h - 4}>{point.label.slice(0, 3)}</text></g>)}</svg><div className="trend-readout"><span>{active.label} 2026</span><b>Ingresos {clp(active.income)}</b><b>Gastos {clp(active.expense)}</b><strong className={active.balance >= 0 ? "good" : "bad"}>Saldo {clp(active.balance)}</strong></div></div>;
}
function DonutChart({ rows }: { rows: Breakdown[] }) {
  const [selected, setSelected] = useState(0); const usable = rows.filter(row => row.amount > 0).slice(0, 6); const total = usable.reduce((sum, row) => sum + row.amount, 0);
  useEffect(() => setSelected(0), [rows]); if (!total) return <p className="chart-empty">Sin ingresos confirmados para mostrar.</p>;
  let offset = 0; const circumference = 2 * Math.PI * 48; const current = usable[Math.min(selected, usable.length - 1)];
  return <div className="donut-layout"><div className="donut-graphic"><svg viewBox="0 0 140 140" role="img" aria-label="Distribución de ingresos"><circle className="donut-base" cx="70" cy="70" r="48"/>{usable.map((row, index) => { const length = row.amount / total * circumference; const segment = <circle key={row.name} className={index === selected ? "donut-segment selected" : "donut-segment"} cx="70" cy="70" r="48" stroke={COLORS[index]} strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-offset} onMouseEnter={() => setSelected(index)} onFocus={() => setSelected(index)} tabIndex={0}/>; offset += length; return segment; })}</svg><div><b>{Math.round(current.amount / total * 100)}%</b><span>{current.name}</span></div></div><div className="donut-legend">{usable.map((row, index) => <button key={row.name} className={index === selected ? "selected" : ""} onClick={() => setSelected(index)}><i style={{ background: COLORS[index] }}/><span>{row.name}</span><b>{clp(row.amount)}</b></button>)}</div></div>;
}
function InteractiveBars({ rows }: { rows: Breakdown[] }) {
  const [selected, setSelected] = useState(0); const max = Math.max(...rows.map(row => row.amount), 1); const current = rows[Math.min(selected, Math.max(rows.length - 1, 0))];
  useEffect(() => setSelected(0), [rows]); if (!rows.length) return <p className="chart-empty">Sin movimientos confirmados para este gráfico.</p>;
  return <div className="ranking"><div className="bar-chart">{rows.map((row, index) => <button className={index === selected ? "bar-row selected" : "bar-row"} key={row.name} onClick={() => setSelected(index)}><div><span>{row.name}</span><b>{clp(row.amount)}</b></div><i><em style={{ width: `${row.amount / max * 100}%` }}/></i></button>)}</div><aside><span>Selección</span><b>{current.name}</b><strong>{clp(current.amount)}</strong><small>{Math.round(current.amount / rows.reduce((sum, row) => sum + row.amount, 0) * 100)}% del total mostrado</small></aside></div>;
}
function BudgetBars({ rows }: { rows: { item: string; amount: number; budget: number }[] }) {
  const [selected, setSelected] = useState(0); const usable = rows.filter(row => row.amount || row.budget).slice(0, 5); const current = usable[Math.min(selected, Math.max(usable.length - 1, 0))];
  if (!usable.length) return null; return <div className="budget-bars"><b>Partidas con ejecución</b>{usable.map((row, index) => <button key={row.item} onClick={() => setSelected(index)} className={index === selected ? "selected" : ""}><span>{row.item}</span><i><em style={{ width: `${Math.min(row.budget ? row.amount / row.budget * 100 : 100, 100)}%` }}/></i></button>)}<small>{current.item}: {clp(current.amount)} ejecutado de {clp(current.budget)} presupuestado.</small></div>;
}
function ReportTable({ headings, rows, empty }: { headings: string[]; rows: string[][]; empty: string }) { return <div className="reports-table-wrap"><table><thead><tr>{headings.map(heading => <th key={heading}>{heading}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td className={cellIndex >= row.length - 2 ? "money" : ""} key={cellIndex}>{cell}</td>)}</tr>) : <tr><td colSpan={headings.length} className="empty">{empty}</td></tr>}</tbody></table></div>; }
