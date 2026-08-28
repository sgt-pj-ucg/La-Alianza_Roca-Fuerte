"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { AuthGate } from "@/components/auth-gate";
import { clp } from "@/lib/money";
import { supabase } from "@/lib/supabase/client";
import "./reportes.css";

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const list = (value: unknown): any[] => Array.isArray(value) ? value : value ? [value] : [];
const first = (value: unknown): any => list(value)[0] ?? null;
const number = (value: unknown) => Number(value ?? 0);

type Detail = { date: string; member: string; description: string; concept: string; amount: number };

export default function ReportesPage() {
  const [month, setMonth] = useState(1);
  const [data, setData] = useState<any>(null);
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
      const closed = list(payload.months).filter((period: any) => period.period_year === 2026 && period.status === "CLOSED");
      if (closed.length && !closed.some((period: any) => Number(period.period_month) === selectedMonth)) {
        setMonth(Number(closed[0].period_month));
        return;
      }
      setData(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible preparar los reportes.");
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(month); }, [month]);

  const model = useMemo(() => {
    const transactions = list(data?.statement?.bank_transactions);
    const income = new Map<string, number>();
    const expenses = new Map<string, number>();
    const memberDetails: Detail[] = [];
    const missionDetails: Detail[] = [];
    const unassigned: Detail[] = [];
    const budgetByItem = new Map<string, number>();
    for (const category of list(data?.budget?.budget_categories)) for (const item of list(category.budget_items)) {
      const monthly = list(item.monthly_budgets).find((row: any) => Number(row.month) === month);
      budgetByItem.set(`${category.name}|${item.name}`, number(monthly?.amount_clp));
    }
    for (const tx of transactions) {
      const classification = first(tx.transaction_classifications);
      const incomeAllocations = list(tx.transaction_income_allocations);
      const expenseAllocations = list(tx.transaction_expense_allocations);
      const member = String(tx.display_name ?? "").trim();
      if (number(tx.credit_clp) > 0) {
        const entries = incomeAllocations.length
          ? incomeAllocations.map((allocation: any) => ({ concept: first(allocation.income_concepts)?.name ?? "Ingreso sin categoría", amount: number(allocation.amount_clp), description: allocation.description ?? tx.description }))
          : classification ? [{ concept: first(classification.income_concepts)?.name ?? "Ingreso sin categoría", amount: number(tx.credit_clp), description: classification.note ?? tx.description }] : [];
        for (const entry of entries) {
          income.set(entry.concept, (income.get(entry.concept) ?? 0) + entry.amount);
          const detail = { date: tx.booked_at, member: member || "Sin nombre asignado", description: entry.description, concept: entry.concept, amount: entry.amount };
          if (["Diezmo", "Aporte", "Misiones", "Ofrenda"].includes(entry.concept)) memberDetails.push(detail);
          if (entry.concept === "Misiones") missionDetails.push(detail);
          if (["Diezmo", "Aporte", "Misiones", "Ofrenda"].includes(entry.concept) && !member) unassigned.push(detail);
        }
      }
      if (number(tx.charge_clp) > 0) {
        const entries = expenseAllocations.length
          ? expenseAllocations.map((allocation: any) => ({ category: first(first(allocation.budget_items)?.budget_categories)?.name ?? "Otros", item: first(allocation.budget_items)?.name ?? "Otro egreso", amount: number(allocation.amount_clp) }))
          : classification ? [{ category: first(first(classification.budget_items)?.budget_categories)?.name ?? "Otros", item: first(classification.budget_items)?.name ?? "Otro egreso", amount: number(tx.charge_clp) }] : [];
        for (const entry of entries) {
          const key = `${entry.category}|${entry.item}`;
          expenses.set(key, (expenses.get(key) ?? 0) + entry.amount);
        }
      }
    }
    const incomeRows = [...income.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
    const expenseRows = [...expenses.entries()].map(([key, amount]) => { const [category, item] = key.split("|"); const budget = budgetByItem.get(key) ?? 0; return { category, item, amount, budget, variance: budget - amount }; }).sort((a, b) => b.amount - a.amount);
    const totalIncome = incomeRows.reduce((sum, row) => sum + row.amount, 0);
    const totalExpense = expenseRows.reduce((sum, row) => sum + row.amount, 0);
    const tithes = income.get("Diezmo") ?? 0;
    const offerings = income.get("Ofrenda") ?? 0;
    const missions = income.get("Misiones") ?? 0;
    const taxableBase = tithes + offerings;
    const totalBudget = [...budgetByItem.values()].reduce((sum, value) => sum + value, 0);
    const memberSummary = new Map<string, { name: string; tithe: number; offering: number; missions: number; aporte: number; total: number }>();
    for (const row of memberDetails) {
      const current = memberSummary.get(row.member) ?? { name: row.member, tithe: 0, offering: 0, missions: 0, aporte: 0, total: 0 };
      if (row.concept === "Diezmo") current.tithe += row.amount;
      if (row.concept === "Ofrenda") current.offering += row.amount;
      if (row.concept === "Misiones") current.missions += row.amount;
      if (row.concept === "Aporte") current.aporte += row.amount;
      current.total += row.amount;
      memberSummary.set(row.member, current);
    }
    return { incomeRows, expenseRows, memberDetails, missionDetails, unassigned, members: [...memberSummary.values()].sort((a, b) => b.total - a.total), totalIncome, totalExpense, tithes, offerings, missions, taxableBase, payment15: Math.round(taxableBase * .15), payment1: Math.round(taxableBase * .01), totalBudget, budgetExecution: totalBudget ? totalExpense / totalBudget : 0, balance: totalIncome - totalExpense };
  }, [data, month]);

  const closedMonths = list(data?.months).filter((period: any) => period.period_year === 2026 && period.status === "CLOSED");
  const monthClosed = data?.statement?.status === "CLOSED";
  function downloadWorkbook(kind: "members" | "missions") {
    const rows = kind === "missions"
      ? model.missionDetails.map(row => ({ Mes: `${MONTHS[month - 1]} 2026`, Fecha: row.date, Nombre: row.member, Concepto: row.concept, Descripción: row.description, Monto_CLP: row.amount }))
      : model.members.map(row => ({ Mes: `${MONTHS[month - 1]} 2026`, Nombre: row.name, Diezmos_CLP: row.tithe, Ofrendas_CLP: row.offering, Misiones_CLP: row.missions, Aportes_CLP: row.aporte, Total_CLP: row.total }));
    const worksheet = XLSX.utils.json_to_sheet(rows);
    worksheet["!cols"] = [{ wch: 15 }, { wch: 15 }, { wch: 34 }, { wch: 18 }, { wch: 46 }, { wch: 18 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, kind === "missions" ? "Misiones" : "Miembros");
    XLSX.writeFile(workbook, `${kind === "missions" ? "Aportes_Misiones" : "Miembros"}_${MONTHS[month - 1]}_2026.xlsx`);
  }

  return <AuthGate><main className="reports-shell"><a href="/" className="reports-back"><span>←</span> Volver al panel</a><header className="reports-header"><div><p className="eyebrow">REPORTABILIDAD FINANCIERA</p><h1>Informes de tesorería</h1><p>Indicadores oficiales, trazables y listos para apoyar la gestión mensual.</p></div><img src="/logo-la-alianza.png" alt="La Alianza Roca Fuerte"/></header>
    <section className="reports-control"><div><b>Período de informe</b><span>Solo se muestran meses cerrados oficialmente.</span></div><select value={month} onChange={event => setMonth(Number(event.target.value))}>{closedMonths.map((period: any) => <option key={period.period_month} value={period.period_month}>{MONTHS[period.period_month - 1]} {period.period_year}</option>)}</select></section>
    {loading ? <p className="reports-state">Preparando cifras oficiales…</p> : error ? <p className="reports-error">{error}</p> : !monthClosed ? <p className="reports-error">Este período no está cerrado. No se emiten reportes oficiales hasta completar y cerrar el mes.</p> : <><section className="official-band"><span>✓</span><div><b>Informe oficial · {MONTHS[month - 1]} 2026</b><p>Fuente: cartola conciliada, clasificaciones confirmadas y cierre mensual protegido.</p></div><button onClick={() => void load(month)}>Actualizar cifras</button></section>
      <section className="reports-kpis"><Kpi label="Ingresos totales" value={clp(model.totalIncome)} note="Abonos confirmados"/><Kpi label="Gastos totales" value={clp(model.totalExpense)} note="Cargos clasificados"/><Kpi label="Saldo operativo" value={clp(model.balance)} note="Ingresos menos gastos" positive={model.balance >= 0}/><Kpi label="Aporte a misiones" value={clp(model.missions)} note="Ingresos clasificados como Misiones"/><Kpi label="Diezmos" value={clp(model.tithes)} note="Base principal"/><Kpi label="Ofrendas" value={clp(model.offerings)} note="Parte del total imponible"/></section>
      <section className="tax-card"><div><p className="eyebrow">CÁLCULO DE APORTES</p><h2>Total imponible</h2><p>Diezmos + ofrendas. El cálculo se realiza solo sobre ingresos confirmados del período cerrado.</p></div><div className="tax-amount"><span>Base imponible</span><b>{clp(model.taxableBase)}</b></div><div className="tax-amount"><span>15% a pagar</span><b>{clp(model.payment15)}</b></div><div className="tax-amount"><span>1% a pagar</span><b>{clp(model.payment1)}</b></div><div className="tax-total"><span>Total 16%</span><b>{clp(model.payment15 + model.payment1)}</b></div></section>
      <section className="charts-layout"><article className="chart-card"><div className="chart-head"><div><p className="eyebrow">DISTRIBUCIÓN</p><h2>{chart === "income" ? "Ingresos por concepto" : "Egresos por partida"}</h2></div><div className="chart-toggle"><button className={chart === "income" ? "selected" : ""} onClick={() => setChart("income")}>Ingresos</button><button className={chart === "expense" ? "selected" : ""} onClick={() => setChart("expense")}>Egresos</button></div></div><BarChart rows={(chart === "income" ? model.incomeRows.map(row => ({ label: row.name, value: row.amount })) : model.expenseRows.slice(0, 8).map(row => ({ label: row.item, value: row.amount })))} /></article><article className="chart-card budget-card"><p className="eyebrow">PRESUPUESTO</p><h2>Ejecución del mes</h2><b>{Math.round(model.budgetExecution * 100)}%</b><p>{clp(model.totalExpense)} ejecutado de {clp(model.totalBudget)} presupuestado.</p><div className="progress"><i style={{ width: `${Math.min(model.budgetExecution * 100, 100)}%` }}/></div><small>{model.budgetExecution > 1 ? "Hay partidas que requieren revisión por sobre-ejecución." : "Ejecución dentro del presupuesto total mensual."}</small></article></section>
      <section className="reports-table-card"><div className="reports-table-head"><div><p className="eyebrow">DIEZMOS</p><h2>Informe de miembros diezmadores</h2><p>Nómina de quienes registran al menos un diezmo confirmado durante el mes.</p></div></div><ReportTable headings={["Nombre", "Diezmos", "Ofrendas", "Total entregado"]} rows={model.members.filter(row => row.tithe > 0).map(row => [row.name, clp(row.tithe), clp(row.offering), clp(row.total)])} empty="No hay diezmos identificados en este período." /></section>
      <section className="reports-table-card"><div className="reports-table-head"><div><p className="eyebrow">MIEMBROS Y APORTANTES</p><h2>Listado de miembros por mes</h2><p>La identificación usa el nombre validado en cada movimiento. “Sin nombre asignado” requiere completar “Editar nombre” antes de usarlo como nómina oficial.</p></div><button onClick={() => downloadWorkbook("members")}>↓ Exportar Excel</button></div><ReportTable headings={["Nombre", "Diezmos", "Ofrendas", "Misiones", "Aportes", "Total"]} rows={model.members.map(row => [row.name, clp(row.tithe), clp(row.offering), clp(row.missions), clp(row.aporte), clp(row.total)])} empty="No hay aportantes identificados en este período." /></section>
      <section className="reports-table-card"><div className="reports-table-head"><div><p className="eyebrow">MISIONES</p><h2>Aportantes a misiones por mes</h2><p>Detalle listo para Excel con nombre, fecha, descripción y monto entregado.</p></div><button onClick={() => downloadWorkbook("missions")}>↓ Exportar Excel</button></div><ReportTable headings={["Fecha", "Nombre", "Descripción", "Monto"]} rows={model.missionDetails.map(row => [row.date, row.member, row.description, clp(row.amount)])} empty="No hay aportes a misiones en este período." /></section>
      <section className="reports-table-card"><div className="reports-table-head"><div><p className="eyebrow">CONTROL</p><h2>Egresos, presupuesto y desviación</h2><p>La desviación negativa indica que el gasto supera el presupuesto asignado.</p></div></div><ReportTable headings={["Categoría", "Partida", "Presupuesto", "Ejecutado", "Disponible"]} rows={model.expenseRows.map(row => [row.category, row.item, clp(row.budget), clp(row.amount), clp(row.variance)])} empty="No hay egresos clasificados en este período." /></section>
      {model.unassigned.length > 0 && <section className="data-warning"><b>Atención de calidad de datos</b><p>Hay {model.unassigned.length} aporte(s) de miembro sin nombre validado. Los totales financieros son correctos, pero esas filas no deben interpretarse como una nómina final hasta identificar al aportante.</p></section>}
    </>}</main></AuthGate>;
}

function Kpi({ label, value, note, positive }: { label: string; value: string; note: string; positive?: boolean }) { return <article className={positive ? "kpi-positive" : ""}><small>{label}</small><strong>{value}</strong><span>{note}</span></article>; }
function BarChart({ rows }: { rows: { label: string; value: number }[] }) { const max = Math.max(...rows.map(row => row.value), 1); return <div className="bar-chart">{rows.length ? rows.map(row => <div className="bar-row" key={row.label}><div><span>{row.label}</span><b>{clp(row.value)}</b></div><i><em style={{ width: `${(row.value / max) * 100}%` }}/></i></div>) : <p>Sin movimientos confirmados para este gráfico.</p>}</div>; }
function ReportTable({ headings, rows, empty }: { headings: string[]; rows: string[][]; empty: string }) { return <div className="reports-table-wrap"><table><thead><tr>{headings.map(heading => <th key={heading}>{heading}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td className={cellIndex >= row.length - 2 ? "money" : ""} key={cellIndex}>{cell}</td>)}</tr>) : <tr><td colSpan={headings.length} className="empty">{empty}</td></tr>}</tbody></table></div>; }
