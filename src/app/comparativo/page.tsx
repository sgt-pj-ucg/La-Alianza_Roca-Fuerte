"use client";

import { useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { clp } from "@/lib/money";
import { supabase } from "@/lib/supabase/client";
import "./comparativo.css";
import "./annual-bars.css";
import "./comparison-interactions.css";
import "./projection-highlight.css";

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const list = (value: unknown): any[] => Array.isArray(value) ? value : value ? [value] : [];
const first = (value: unknown): any => list(value)[0] ?? null;
const number = (value: unknown) => Number(value ?? 0);
const pct = (value: number) => `${Math.round(value * 100)}%`;

type MonthRecord = { month: number; label: string; income: number; expense: number; budget: number; cumulativeExpense: number; cumulativeBudget: number; byItem: Map<string, number>; byCategory: Map<string, number> };
type BudgetItem = { category: string; item: string; annual: number; toDate: number; actual: number };

function expenseEntries(transaction: any) {
  const allocations = list(transaction.transaction_expense_allocations);
  if (allocations.length) return allocations.map((allocation: any) => ({
    category: first(first(allocation.budget_items)?.budget_categories)?.name ?? "Otros",
    item: first(allocation.budget_items)?.name ?? "Otro egreso",
    amount: number(allocation.amount_clp)
  }));
  const classification = first(transaction.transaction_classifications);
  return classification ? [{
    category: first(first(classification.budget_items)?.budget_categories)?.name ?? "Otros",
    item: first(classification.budget_items)?.name ?? "Otro egreso",
    amount: number(transaction.charge_clp)
  }] : [];
}

function incomeTotal(transaction: any) {
  const allocations = list(transaction.transaction_income_allocations);
  if (allocations.length) return allocations.reduce((sum: number, allocation: any) => sum + number(allocation.amount_clp), 0);
  return first(transaction.transaction_classifications) ? number(transaction.credit_clp) : 0;
}

function budgetItems(payload: any) {
  return list(payload?.budget?.budget_categories).flatMap((category: any) => list(category.budget_items).map((item: any) => ({
    category: category.name,
    item: item.name,
    monthly: list(item.monthly_budgets).reduce((map: Map<number, number>, row: any) => map.set(number(row.month), number(row.amount_clp)), new Map<number, number>())
  })));
}

export default function ComparativoPage() {
  const [payloads, setPayloads] = useState<{ period: any; payload: any }[]>([]);
  const [periods, setPeriods] = useState<any[]>([]);
  const [selectedEnd, setSelectedEnd] = useState(12);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [itemFilter, setItemFilter] = useState<"all" | "over" | "watch">("all");

  async function request(path: string) {
    const session = await supabase?.auth.getSession();
    const token = session?.data.session?.access_token;
    if (!token) throw new Error("Tu sesión expiró. Vuelve a iniciar sesión.");
    return fetch(path, { cache: "no-store", headers: { Authorization: `Bearer ${token}` } });
  }

  async function load() {
    try {
      setLoading(true); setError("");
      const initialResponse = await request(`/api/monthly-summary?year=2026&month=1&comparison=${Date.now()}`);
      const initial = await initialResponse.json();
      if (!initialResponse.ok) throw new Error(initial.error ?? "No fue posible cargar el presupuesto.");
      const closed = list(initial.months)
        .filter((period: any) => number(period.period_year) === 2026 && period.status === "CLOSED")
        .sort((a: any, b: any) => number(a.period_month) - number(b.period_month));
      const snapshots = await Promise.all(closed.map(async (period: any) => {
        const response = await request(`/api/monthly-summary?year=2026&month=${period.period_month}&comparisonMonth=${Date.now()}`);
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? `No fue posible cargar ${MONTHS[number(period.period_month) - 1]}.`);
        return { period, payload };
      }));
      setPeriods(closed); setPayloads(snapshots);
      setSelectedEnd(number(closed.at(-1)?.period_month ?? 12));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible preparar el comparativo presupuestario.");
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  const model = useMemo(() => {
    const included = payloads.filter(({ period }) => number(period.period_month) <= selectedEnd);
    const reference = included[0]?.payload ?? payloads[0]?.payload;
    const annualItems = budgetItems(reference);
    const records: MonthRecord[] = [];
    let cumulativeExpense = 0; let cumulativeBudget = 0;
    for (const { period, payload } of included) {
      const month = number(period.period_month); let income = 0; let expense = 0;
      const byItem = new Map<string, number>(); const byCategory = new Map<string, number>();
      for (const transaction of list(payload?.statement?.bank_transactions)) {
        if (number(transaction.credit_clp) > 0) income += incomeTotal(transaction);
        if (number(transaction.charge_clp) > 0) for (const entry of expenseEntries(transaction)) {
          expense += entry.amount;
          const key = `${entry.category}|${entry.item}`;
          byItem.set(key, (byItem.get(key) ?? 0) + entry.amount);
          byCategory.set(entry.category, (byCategory.get(entry.category) ?? 0) + entry.amount);
        }
      }
      const budget = annualItems.reduce((sum: number, item: any) => sum + (item.monthly.get(month) ?? 0), 0);
      cumulativeExpense += expense; cumulativeBudget += budget;
      records.push({ month, label: MONTHS[month - 1], income, expense, budget, cumulativeExpense, cumulativeBudget, byItem, byCategory });
    }
    const annualBudget = annualItems.reduce((sum: number, item: any) => sum + [...item.monthly.values()].reduce((lineSum, value) => lineSum + value, 0), 0);
    const annualMonthlyBudgets = Array.from({ length: 12 }, (_, index) => annualItems.reduce((sum: number, item: any) => sum + (item.monthly.get(index + 1) ?? 0), 0));
    const itemRows: BudgetItem[] = annualItems.map((line: any) => {
      const key = `${line.category}|${line.item}`;
      return {
        category: line.category, item: line.item,
        annual: [...line.monthly.values()].reduce((sum, value) => sum + value, 0),
        toDate: records.reduce((sum, record) => sum + (line.monthly.get(record.month) ?? 0), 0),
        actual: records.reduce((sum, record) => sum + (record.byItem.get(key) ?? 0), 0)
      };
    }).filter(row => row.annual || row.actual);
    const categories = new Map<string, { name: string; annual: number; toDate: number; actual: number }>();
    for (const row of itemRows) {
      const current = categories.get(row.category) ?? { name: row.category, annual: 0, toDate: 0, actual: 0 };
      current.annual += row.annual; current.toDate += row.toDate; current.actual += row.actual; categories.set(row.category, current);
    }
    const totalExpense = records.reduce((sum, record) => sum + record.expense, 0);
    const totalIncome = records.reduce((sum, record) => sum + record.income, 0);
    const plannedToDate = records.reduce((sum, record) => sum + record.budget, 0);
    const monthsClosed = records.length;
    const projectedExpense = monthsClosed ? Math.round(totalExpense / monthsClosed * 12) : 0;
    const execution = plannedToDate ? totalExpense / plannedToDate : 0;
    const annualExecution = annualBudget ? totalExpense / annualBudget : 0;
    const calendarPace = monthsClosed / 12;
    const filteredItems = itemRows.filter(row => itemFilter === "all" || itemFilter === "over" && row.actual > row.toDate || itemFilter === "watch" && row.actual <= row.toDate && row.toDate > 0 && row.actual / row.toDate >= .85).sort((a, b) => (b.actual - b.toDate) - (a.actual - a.toDate));
    return { records, annualMonthlyBudgets, itemRows, categories: [...categories.values()].sort((a, b) => b.actual - a.actual), annualBudget, totalExpense, totalIncome, plannedToDate, monthsClosed, projectedExpense, execution, annualExecution, calendarPace, filteredItems };
  }, [payloads, selectedEnd, itemFilter]);

  const latest = model.records.at(-1);
  const accumulatedPeriod = model.records.length ? `${model.records[0].label} – ${latest?.label} 2026` : "Sin período cerrado";
  const paceDifference = model.annualExecution - model.calendarPace;
  return <AuthGate><main className="comparison-shell">
    <a href="/" className="comparison-back"><span>←</span> Volver al panel</a>
    <header className="comparison-header"><div><p className="eyebrow">CONTROL PRESUPUESTARIO 2026</p><h1>Comparativo y cumplimiento</h1><p>Seguimiento oficial de gasto, presupuesto y tendencia, basado exclusivamente en meses cerrados.</p></div><img src="/logo-la-alianza.png" alt="La Alianza Roca Fuerte" /></header>
    {loading ? <p className="comparison-state">Preparando comparativo anual…</p> : error ? <p className="comparison-error">{error}</p> : !periods.length ? <p className="comparison-error">Aún no existen meses cerrados para construir un comparativo oficial.</p> : <>
      <section className="comparison-controls"><div><b>Corte del análisis</b><span>El acumulado siempre comienza en enero y termina en el mes seleccionado.</span></div><select value={selectedEnd} onChange={event => setSelectedEnd(number(event.target.value))}>{periods.map(period => <option key={period.period_month} value={period.period_month}>Acumulado hasta {MONTHS[number(period.period_month) - 1]} 2026</option>)}</select><button onClick={() => void load()}>↻ Actualizar</button></section>
      <section className="comparison-official"><span>✓</span><div><b>Acumulado oficial · {accumulatedPeriod}</b><p>{model.monthsClosed} mes(es) cerrados, conciliados y clasificados. Los meses abiertos no se incorporan al cálculo.</p></div></section>
      <section className="comparison-kpis">
        <Kpi label={`Gasto acumulado · ${accumulatedPeriod}`} value={clp(model.totalExpense)} note={`de ${clp(model.plannedToDate)} presupuestado en el período`} status={model.execution <= 1 ? "good" : "alert"}/>
        <Kpi label={`Cumplimiento · ${accumulatedPeriod}`} value={pct(model.execution)} note={model.execution <= 1 ? "Dentro del presupuesto acumulado" : "Sobre el presupuesto acumulado"} status={model.execution <= 1 ? "good" : "alert"}/>
        <Kpi label="Presupuesto anual disponible" value={clp(Math.max(0, model.annualBudget - model.totalExpense))} note={`${pct(model.annualExecution)} del plan anual ejecutado`} status="neutral"/>
        <Kpi label="Ritmo versus calendario" value={`${paceDifference >= 0 ? "+" : ""}${Math.round(paceDifference * 100)} pp`} note={`Ejecución anual ${pct(model.annualExecution)} · calendario ${pct(model.calendarPace)}`} status={paceDifference <= 0 ? "good" : "alert"}/>
        <Kpi label="Proyección anual" value={clp(model.projectedExpense)} note="Promedio de meses cerrados × 12; referencial" status={model.projectedExpense <= model.annualBudget ? "good" : "alert"}/>
        <Kpi label="Saldo operativo" value={clp(model.totalIncome - model.totalExpense)} note="Ingresos menos egresos del período" status={model.totalIncome - model.totalExpense >= 0 ? "good" : "alert"}/>
      </section>
      <section className="comparison-summary"><div><p className="eyebrow">LECTURA EJECUTIVA</p><h2>Acumulado {accumulatedPeriod}: gasto versus presupuesto</h2><p>En este corte se han ejecutado <b>{clp(model.totalExpense)}</b> de <b>{clp(model.plannedToDate)}</b> presupuestados. El gasto representa <b>{pct(model.annualExecution)}</b> del plan anual.</p></div><div className="annual-meter" aria-label={`Ejecución anual ${pct(model.annualExecution)}`}><i style={{ width: `${Math.min(model.annualExecution * 100, 100)}%` }}/><b>{pct(model.annualExecution)} anual</b></div><div className="comparison-summary-value"><span>Plan anual</span><b>{clp(model.annualBudget)}</b></div><div className="comparison-summary-value"><span>Disponible acumulado</span><b className={model.totalExpense <= model.plannedToDate ? "good-text" : "alert-text"}>{clp(model.plannedToDate - model.totalExpense)}</b></div></section>
      <section className="comparison-card annual-bars-card"><ChartHead eyebrow="COMPARATIVO MENSUAL" title="Presupuesto 2026 versus gastos mensuales" text="Cada mes compara el presupuesto aprobado con el gasto real. Los meses sin cierre oficial se muestran sin gasto, no como cero."/><AnnualMonthlyBars budgets={model.annualMonthlyBudgets} records={model.records}/></section>
      <section className="comparison-grid"><article className="comparison-card comparison-wide"><ChartHead eyebrow="TENDENCIA ACUMULADA" title={`Acumulado ${accumulatedPeriod}: gasto versus presupuesto`} text="La línea compara la suma progresiva desde enero hasta el corte seleccionado."/><CumulativeChart records={model.records}/></article><article className="comparison-card"><ChartHead eyebrow="RITMO MENSUAL" title="Ejecución por mes cerrado" text="Barras alineadas para comparar el gasto real con el presupuesto mensual."/><MonthlyBars records={model.records}/></article></section>
      <section className="comparison-grid comparison-grid-secondary"><article className="comparison-card"><ChartHead eyebrow="DISTRIBUCIÓN" title="Ejecución por categoría" text="Selecciona una categoría para revisar su gasto y presupuesto acumulado."/><CategoryBars rows={model.categories}/></article><article className="comparison-card projection-card"><p className="eyebrow">PROYECCIÓN REFERENCIAL</p><h2>Escenario de continuidad</h2><b>{clp(model.projectedExpense)}</b><p>Si el promedio de los <strong>{model.monthsClosed}</strong> meses cerrados se mantuviera durante 2026.</p><div><span>Presupuesto anual</span><strong>{clp(model.annualBudget)}</strong></div><div className="projection-difference"><span>Diferencia proyectada</span><strong className={model.projectedExpense <= model.annualBudget ? "good-text" : "alert-text"}>{clp(model.annualBudget - model.projectedExpense)}</strong></div><small>Es una referencia de gestión, no una estimación garantizada.</small></article></section>
      <section className="comparison-table-card"><div className="comparison-table-head"><div><p className="eyebrow">SEGUIMIENTO POR PARTIDA</p><h2>Control de ejecución acumulada</h2><p>“Disponible a la fecha” compara el gasto real con el presupuesto de los meses incluidos, no con el presupuesto de todo el año.</p></div><div className="table-filter"><button className={itemFilter === "all" ? "selected" : ""} onClick={() => setItemFilter("all")}>Todas</button><button className={itemFilter === "watch" ? "selected" : ""} onClick={() => setItemFilter("watch")}>En observación</button><button className={itemFilter === "over" ? "selected" : ""} onClick={() => setItemFilter("over")}>Sobre presupuesto</button></div></div><ComparisonTable rows={model.filteredItems}/></section>
      <section className="comparison-note"><b>Definiciones de control</b><p><strong>Cumplimiento acumulado</strong> = gasto ejecutado ÷ presupuesto de los meses cerrados. <strong>Ritmo versus calendario</strong> compara la ejecución del presupuesto anual con la proporción de meses ya cerrados. Una desviación positiva indica un ritmo de gasto superior al avance del calendario.</p></section>
    </>}
  </main></AuthGate>;
}

function Kpi({ label, value, note, status }: { label: string; value: string; note: string; status: "good" | "alert" | "neutral" }) { return <article className={`comparison-kpi ${status}`}><small>{label}</small><strong>{value}</strong><span>{note}</span></article>; }
function ChartHead({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) { return <div className="comparison-chart-head"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2><p>{text}</p></div></div>; }

function CumulativeChart({ records }: { records: MonthRecord[] }) {
  const [selected, setSelected] = useState(Math.max(records.length - 1, 0));
  useEffect(() => setSelected(Math.max(records.length - 1, 0)), [records.length]);
  if (!records.length) return null;
  const max = Math.max(...records.flatMap(record => [record.cumulativeExpense, record.cumulativeBudget]), 1); const width = 760; const height = 270; const left = 44; const top = 22;
  const x = (index: number) => left + index * ((width - left * 2) / Math.max(records.length - 1, 1)); const y = (value: number) => height - top - value / max * (height - top * 2);
  const path = (key: "cumulativeExpense" | "cumulativeBudget") => records.map((record, index) => `${index ? "L" : "M"}${x(index)},${y(record[key])}`).join(" "); const active = records[Math.min(selected, records.length - 1)];
  return <div className="cumulative-chart"><div className="chart-legend"><span><i className="actual-dot"/> Gasto ejecutado</span><span><i className="plan-dot"/> Presupuesto acumulado</span></div><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Comparación acumulada entre gasto ejecutado y presupuesto">{[.25,.5,.75,1].map(tick => <line key={tick} x1={left} x2={width - left} y1={y(max * tick)} y2={y(max * tick)} />)}<path className="cumulative-plan" d={path("cumulativeBudget")}/><path className="cumulative-actual" d={path("cumulativeExpense")}/>{records.map((record, index) => <g key={record.month}><title>{`${record.label} 2026 · Ejecutado ${clp(record.cumulativeExpense)} · Plan ${clp(record.cumulativeBudget)} · Disponible ${clp(record.cumulativeBudget - record.cumulativeExpense)}`}</title><circle className="chart-hit" cx={x(index)} cy={y(record.cumulativeExpense)} r="15" tabIndex={0} onMouseEnter={() => setSelected(index)} onFocus={() => setSelected(index)}/><circle className="actual-point" cx={x(index)} cy={y(record.cumulativeExpense)} r="5"/><circle className="plan-point" cx={x(index)} cy={y(record.cumulativeBudget)} r="4"/><text x={x(index)} y={height - 5}>{record.label.slice(0, 3)}</text></g>)}</svg><div className="chart-readout"><span>{active.label} 2026</span><b>Ejecutado {clp(active.cumulativeExpense)}</b><b>Plan {clp(active.cumulativeBudget)}</b><strong className={active.cumulativeExpense <= active.cumulativeBudget ? "good-text" : "alert-text"}>Disponible {clp(active.cumulativeBudget - active.cumulativeExpense)}</strong></div></div>;
}

function MonthlyBars({ records }: { records: MonthRecord[] }) {
  const [selected, setSelected] = useState(Math.max(records.length - 1, 0)); useEffect(() => setSelected(Math.max(records.length - 1, 0)), [records.length]);
  const max = Math.max(...records.flatMap(record => [record.expense, record.budget]), 1); const active = records[Math.min(selected, records.length - 1)];
  return <div className="monthly-bars"><div className="month-bars-list">{records.map((record, index) => <button className={index === selected ? "selected" : ""} key={record.month} onClick={() => setSelected(index)} onMouseEnter={() => setSelected(index)} onFocus={() => setSelected(index)}><span>{record.label.slice(0, 3)}</span><i><em className="monthly-plan" style={{ width: `${record.budget / max * 100}%` }}/><em className="monthly-actual" style={{ width: `${record.expense / max * 100}%` }}/></i></button>)}</div><div className="month-bars-readout"><b>{active.label} 2026</b><span>Presupuesto <strong>{clp(active.budget)}</strong></span><span>Ejecutado <strong>{clp(active.expense)}</strong></span><small className={active.expense <= active.budget ? "good-text" : "alert-text"}>Disponible {clp(active.budget - active.expense)}</small></div></div>;
}

function AnnualMonthlyBars({ budgets, records }: { budgets: number[]; records: MonthRecord[] }) {
  const [selected, setSelected] = useState(Math.max(records.length - 1, 0));
  const actualByMonth = new Map(records.map(record => [record.month, record.expense]));
  const max = Math.max(...budgets, ...records.map(record => record.expense), 1);
  const activeMonth = Math.min(Math.max(selected + 1, 1), 12); const activeActual = actualByMonth.get(activeMonth); const activeBudget = budgets[activeMonth - 1] ?? 0;
  useEffect(() => setSelected(Math.max(records.length - 1, 0)), [records.length]);
  return <div className="annual-bars"><div className="annual-bars-legend"><span><i className="annual-plan-key"/> Presupuesto mensual</span><span><i className="annual-actual-key"/> Gasto ejecutado</span><span><i className="annual-pending-key"/> Sin cierre oficial</span></div><div className="annual-bars-plot">{budgets.map((budget, index) => { const month = index + 1; const actual = actualByMonth.get(month); const isSelected = selected === index; return <button key={month} className={isSelected ? "selected" : ""} onClick={() => setSelected(index)} onMouseEnter={() => setSelected(index)} onFocus={() => setSelected(index)} aria-label={`${MONTHS[index]}: presupuesto ${clp(budget)}${actual === undefined ? ", sin cierre oficial" : `, gasto ${clp(actual)}`} `}><span className="annual-bars-columns"><i className="annual-plan-bar" style={{ height: `${budget / max * 100}%` }}/>{actual === undefined ? <i className="annual-pending-bar"/> : <i className="annual-actual-bar" style={{ height: `${actual / max * 100}%` }}/>}</span><span className="annual-bar-tooltip"><b>{MONTHS[index]} 2026</b><span>Presupuesto <strong>{clp(budget)}</strong></span>{actual === undefined ? <small>Sin cierre oficial</small> : <><span>Gasto <strong>{clp(actual)}</strong></span><em className={actual <= budget ? "good-text" : "alert-text"}>Disponible {clp(budget - actual)}</em></>}</span><em>{MONTHS[index].slice(0, 3)}</em></button>; })}</div><div className="annual-bars-readout"><b>{MONTHS[activeMonth - 1]} 2026</b><span>Presupuesto <strong>{clp(activeBudget)}</strong></span>{activeActual === undefined ? <small>Este mes todavía no tiene un cierre oficial; el gasto no se considera cero.</small> : <><span>Gasto ejecutado <strong>{clp(activeActual)}</strong></span><small className={activeActual <= activeBudget ? "good-text" : "alert-text"}>Disponible {clp(activeBudget - activeActual)}</small></>}</div></div>;
}

function CategoryBars({ rows }: { rows: { name: string; annual: number; toDate: number; actual: number }[] }) {
  const [selected, setSelected] = useState(0); useEffect(() => setSelected(0), [rows]); const usable = rows.filter(row => row.toDate || row.actual).slice(0, 6); const active = usable[Math.min(selected, Math.max(usable.length - 1, 0))]; const max = Math.max(...usable.map(row => Math.max(row.actual, row.toDate)), 1);
  if (!usable.length) return <p className="comparison-empty">No hay categorías con ejecución para este período.</p>;
  return <div className="category-bars"><div>{usable.map((row, index) => <button key={row.name} className={index === selected ? "selected" : ""} onClick={() => setSelected(index)} onMouseEnter={() => setSelected(index)} onFocus={() => setSelected(index)}><span title={row.name}>{row.name}</span><i><em className="category-plan" style={{ width: `${row.toDate / max * 100}%` }}/><em className="category-actual" style={{ width: `${row.actual / max * 100}%` }}/></i></button>)}</div><aside><span>Categoría seleccionada</span><b>{active.name}</b><strong>{clp(active.actual)}</strong><small>Ejecutado de {clp(active.toDate)} presupuestado a la fecha.</small><em className={active.actual <= active.toDate ? "good-text" : "alert-text"}>{pct(active.toDate ? active.actual / active.toDate : 0)} de ejecución</em></aside></div>;
}

function ComparisonTable({ rows }: { rows: BudgetItem[] }) { return <div className="comparison-table-wrap"><table><thead><tr><th>Categoría</th><th>Partida</th><th>Presupuesto a la fecha</th><th>Ejecutado</th><th>Disponible a la fecha</th><th>Presupuesto anual</th></tr></thead><tbody>{rows.length ? rows.map(row => <tr key={`${row.category}|${row.item}`}><td>{row.category}</td><td>{row.item}</td><td className="money">{clp(row.toDate)}</td><td className="money">{clp(row.actual)}</td><td className={`money ${row.actual > row.toDate ? "alert-text" : "good-text"}`}>{clp(row.toDate - row.actual)}</td><td className="money">{clp(row.annual)}</td></tr>) : <tr><td colSpan={6} className="comparison-empty">No hay partidas para este filtro.</td></tr>}</tbody></table></div>; }
