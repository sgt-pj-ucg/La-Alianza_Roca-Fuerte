"use client";

import { useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { supabase } from "@/lib/supabase/client";
import { clp } from "@/lib/money";
import "./split-actions.css";

type Choice = { id: string; name: string; budget_categories?: { name: string } | null };
type Allocation = { categoryId: string; amountClp: number; description: string };
type Month = { period_year: number; period_month: number; status: string };
type Classification = { income_concept_id: string | null; budget_item_id: string | null; note: string | null };
type StoredAllocation = { income_concept_id?: string | null; budget_item_id?: string | null; amount_clp: number; description: string };
type Transaction = {
  id: string; booked_at: string; description: string; display_name: string | null; charge_clp: number | null; credit_clp: number | null;
  transaction_classifications: Classification[]; transaction_income_allocations: StoredAllocation[]; transaction_expense_allocations: StoredAllocation[];
};

const OTHER_EXPENSE = "__other_expense__";
const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

export default function ClassificationPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [concepts, setConcepts] = useState<Choice[]>([]);
  const [items, setItems] = useState<Choice[]>([]);
  const [months, setMonths] = useState<Month[]>([]);
  const [periodMonth, setPeriodMonth] = useState(1);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [splits, setSplits] = useState<Record<string, Allocation[]>>({});
  const [splitOpen, setSplitOpen] = useState<Record<string, boolean>>({});
  const [aliases, setAliases] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [filter, setFilter] = useState("pending");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState<string | null>(null);

  async function request(url: string, init?: RequestInit) {
    let { data } = await supabase!.auth.getSession();
    if (!data.session) data = (await supabase!.auth.refreshSession()).data;
    if (!data.session) {
      await supabase!.auth.signOut({ scope: "local" });
      throw new Error("Tu sesión expiró. Vuelve a iniciar sesión.");
    }
    const response = await fetch(url, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", ...init?.headers, Authorization: `Bearer ${data.session.access_token}` } });
    if (response.status === 401) {
      await supabase!.auth.signOut({ scope: "local" });
      throw new Error("Tu sesión expiró. Vuelve a iniciar sesión.");
    }
    return response;
  }

  async function load() {
    try {
      setError("");
      const response = await request(`/api/classifications?year=2026&month=${periodMonth}&check=${Date.now()}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      const next = data.transactions as Transaction[];
      setTransactions(next); setConcepts(data.concepts); setItems(data.items); setMonths(data.months ?? []);
      const selected: Record<string, string> = {}, savedNotes: Record<string, string> = {}, savedSplits: Record<string, Allocation[]> = {}, opened: Record<string, boolean> = {};
      next.forEach(row => {
        const income = Boolean(row.credit_clp);
        const classification = row.transaction_classifications?.[0];
        const classificationId = income ? classification?.income_concept_id : classification?.budget_item_id;
        if (classificationId) selected[row.id] = classificationId;
        if (!income && classification && !classification.budget_item_id && classification.note) selected[row.id] = OTHER_EXPENSE;
        if (classification?.note) savedNotes[row.id] = classification.note;
        const saved = income ? row.transaction_income_allocations : row.transaction_expense_allocations;
        if (saved?.length) {
          savedSplits[row.id] = saved.map(part => ({ categoryId: income ? String(part.income_concept_id) : (part.budget_item_id ? String(part.budget_item_id) : OTHER_EXPENSE), amountClp: Number(part.amount_clp), description: part.description }));
          opened[row.id] = true;
        }
      });
      setChoices(selected); setNotes(savedNotes); setSplits(savedSplits); setSplitOpen(opened);
      return next;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible cargar los movimientos."); return null; }
  }

  useEffect(() => { void load(); }, [periodMonth]);

  const confirmed = (row: Transaction) => Boolean(row.transaction_classifications?.length || row.transaction_income_allocations?.length || row.transaction_expense_allocations?.length);
  async function verifyPersisted(transactionId: string) {
    const refreshed = await load();
    const stored = refreshed?.find(row => row.id === transactionId);
    if (!stored || !confirmed(stored)) throw new Error("No se pudo comprobar el guardado en la base de datos. El movimiento sigue pendiente.");
  }
  const visible = useMemo(() => transactions.filter(row => filter === "all" || (filter === "pending" ? !confirmed(row) : row.credit_clp ? filter === "income" : filter === "expense")), [transactions, filter]);
  const isOtherIncome = (id: string) => concepts.find(concept => concept.id === choices[id])?.name === "Otro ingreso";
  const isOtherExpense = (id: string) => choices[id] === OTHER_EXPENSE;

  function openSplit(row: Transaction) {
    const income = Boolean(row.credit_clp);
    const amount = Number(row.credit_clp ?? row.charge_clp);
    setSplitOpen(current => ({ ...current, [row.id]: true }));
    setSplits(current => current[row.id] ? current : { ...current, [row.id]: [{ categoryId: "", amountClp: amount, description: "" }] });
    if (!income) setNotes(current => ({ ...current, [row.id]: "" }));
  }
  function cancelSplit(row: Transaction) {
    setSplitOpen(current => ({ ...current, [row.id]: false }));
    const saved = row.transaction_income_allocations?.length || row.transaction_expense_allocations?.length;
    if (!saved) setSplits(current => { const next = { ...current }; delete next[row.id]; return next; });
  }
  function updateSplit(id: string, index: number, change: Partial<Allocation>) {
    setSplits(current => ({ ...current, [id]: (current[id] ?? []).map((part, position) => position === index ? { ...part, ...change } : part) }));
  }
  function addSplit(id: string) { setSplits(current => ({ ...current, [id]: [...(current[id] ?? []), { categoryId: "", amountClp: 0, description: "" }] })); }
  function removeSplit(id: string, index: number) { setSplits(current => ({ ...current, [id]: (current[id] ?? []).filter((_, position) => position !== index) })); }

  async function save(row: Transaction) {
    const income = Boolean(row.credit_clp);
    const amount = Number(row.credit_clp ?? row.charge_clp);
    const parts = splits[row.id] ?? [];
    setError(""); setNotice("");
    if (splitOpen[row.id]) {
      const total = parts.reduce((sum, part) => sum + Number(part.amountClp || 0), 0);
      if (!parts.length || parts.some(part => !part.categoryId || !part.description.trim() || !Number.isInteger(Number(part.amountClp)) || Number(part.amountClp) <= 0) || total !== amount) {
        setError("Cada división requiere categoría, descripción y monto; la suma debe coincidir exactamente con el movimiento."); return;
      }
      setSaving(row.id);
      try {
        const allocations = parts.map(part => income ? { incomeConceptId: part.categoryId, amountClp: Number(part.amountClp), description: part.description.trim() } : { budgetItemId: part.categoryId === OTHER_EXPENSE ? null : part.categoryId, amountClp: Number(part.amountClp), description: part.description.trim() });
        const response = await request("/api/classifications", { method: "POST", body: JSON.stringify({ transactionId: row.id, allocations }) });
        const data = await response.json(); if (!response.ok) throw new Error(data.error);
        await verifyPersisted(row.id); setNotice("División confirmada y guardada correctamente.");
      } catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible guardar."); }
      finally { setSaving(null); }
      return;
    }
    const choice = choices[row.id];
    const note = notes[row.id]?.trim() || "";
    if (!choice) return;
    if ((income && isOtherIncome(row.id) || !income && isOtherExpense(row.id)) && !note) { setError("Escribe la descripción antes de confirmar."); return; }
    setSaving(row.id);
    try {
      const payload = income
        ? { transactionId: row.id, incomeConceptId: choice, incomeConceptName: concepts.find(concept => concept.id === choice)?.name, note }
        : { transactionId: row.id, budgetItemId: choice === OTHER_EXPENSE ? null : choice, manualExpense: choice === OTHER_EXPENSE, note };
      const response = await request("/api/classifications", { method: "POST", body: JSON.stringify(payload) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      await verifyPersisted(row.id); setNotice("Clasificación confirmada y guardada correctamente.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible guardar."); }
    finally { setSaving(null); }
  }

  async function saveAlias(row: Transaction) {
    setSaving(row.id); setError("");
    try {
      const response = await request(`/api/transactions/${row.id}`, { method: "PATCH", body: JSON.stringify({ displayName: aliases[row.id] ?? row.display_name ?? row.description }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setEditing(null); await load(); setNotice("Nombre actualizado correctamente.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible guardar el nombre."); }
    finally { setSaving(null); }
  }

  const confirmedCount = transactions.filter(confirmed).length;
  return <AuthGate><main className="classification-page">
    <header><a href="/" className="back-link" aria-label="Volver al panel de tesorería"><span className="back-link-icon" aria-hidden="true">←</span><span><small>Panel de tesorería</small>Presupuesto 2026</span></a><div><p className="eyebrow">CLASIFICACIÓN · {MONTHS[periodMonth - 1].toUpperCase()} 2026</p><h1>Ingresos y egresos</h1><p>Confirma cada movimiento antes del cierre mensual.</p><select className="month-selector" value={periodMonth} onChange={event => setPeriodMonth(Number(event.target.value))}>{months.map(month => <option key={`${month.period_year}-${month.period_month}`} value={month.period_month}>{MONTHS[month.period_month - 1]} {month.period_year}{month.status !== "RECONCILED" ? " · revisión" : ""}</option>)}</select></div></header>
    <section className="classification-summary"><div><b>{transactions.length}</b><span>Movimientos conciliados</span></div><div><b>{confirmedCount}</b><span>Clasificados</span></div><div><b>{transactions.length - confirmedCount}</b><span>Pendientes</span></div></section>
    <div className="classification-toolbar"><div><h2>Movimientos bancarios · {MONTHS[periodMonth - 1]}</h2><p>El movimiento solo queda definitivo cuando aparece el mensaje de guardado.</p></div><select value={filter} onChange={event => setFilter(event.target.value)}><option value="pending">Pendientes</option><option value="income">Solo ingresos</option><option value="expense">Solo egresos</option><option value="all">Todos</option></select></div>
    {notice && <p className="classification-notice">✓ {notice}</p>}{error && <p className="classification-error">{error}</p>}
    <section className="classification-list">{visible.map(row => {
      const income = Boolean(row.credit_clp); const options = income ? concepts : items; const parts = splits[row.id] ?? []; const total = parts.reduce((sum, part) => sum + Number(part.amountClp || 0), 0); const amount = Number(row.credit_clp ?? row.charge_clp); const other = income ? isOtherIncome(row.id) : isOtherExpense(row.id);
      return <article key={row.id} className={splitOpen[row.id] ? "split-row" : ""}><div className="movement"><small>{row.booked_at}</small><strong title={`Original: ${row.description}`}>{row.display_name || row.description}</strong><button className="alias-toggle" onClick={() => { setAliases(current => ({ ...current, [row.id]: current[row.id] ?? row.display_name ?? row.description })); setEditing(editing === row.id ? null : row.id); }}>Editar nombre</button>{editing === row.id && <div className="alias-editor"><input value={aliases[row.id] ?? row.description} onChange={event => setAliases(current => ({ ...current, [row.id]: event.target.value }))}/><button onClick={() => void saveAlias(row)} disabled={saving === row.id}>Guardar</button></div>}<span className={income ? "income" : "expense"}>{income ? "+" : "−"}{clp(amount)}</span>{!splitOpen[row.id] && <button className="split-link" onClick={() => openSplit(row)}>Dividir {income ? "ingreso" : "egreso"}</button>}</div>
      {splitOpen[row.id] ? <div className="split-editor"><div className="split-title"><span>Distribución del {income ? "ingreso" : "egreso"}</span><button onClick={() => addSplit(row.id)}>+ Agregar partida</button></div>{parts.map((part, index) => <div className="split-line" key={`${row.id}-${index}`}><select value={part.categoryId} onChange={event => updateSplit(row.id, index, { categoryId: event.target.value })}><option value="">{income ? "Categoría" : "Partida presupuestaria"}</option>{options.map(option => <option key={option.id} value={option.id}>{income ? option.name : `${option.budget_categories?.name ?? "Sin categoría"} · ${option.name}`}</option>)}{!income && <option value={OTHER_EXPENSE}>Otro egreso</option>}</select><input placeholder={part.categoryId === OTHER_EXPENSE ? "Describe este otro egreso" : "Descripción"} value={part.description} onChange={event => updateSplit(row.id, index, { description: event.target.value })}/><input type="number" min="1" step="1" value={part.amountClp || ""} onChange={event => updateSplit(row.id, index, { amountClp: Number(event.target.value) })}/>{parts.length > 1 && <button className="remove-split" onClick={() => removeSplit(row.id, index)}>×</button>}</div>)}<div className={total === amount ? "split-total ok" : "split-total"}>{total === amount ? "100% listo · " : "Pendiente · "}{clp(total)} de {clp(amount)}</div><div className="split-actions"><button className="cancel-split" onClick={() => cancelSplit(row)}>Cancelar</button><button className="primary" disabled={saving === row.id || total !== amount} onClick={() => void save(row)}>{saving === row.id ? "Guardando…" : "Guardar y confirmar división"}</button></div></div> : <div className="classification-action"><select value={choices[row.id] ?? ""} onChange={event => setChoices(current => ({ ...current, [row.id]: event.target.value }))}><option value="">{income ? "Selecciona concepto de ingreso" : "Selecciona partida presupuestaria"}</option>{options.map(option => <option key={option.id} value={option.id}>{income ? option.name : `${option.budget_categories?.name ?? "Sin categoría"} · ${option.name}`}</option>)}{!income && <option value={OTHER_EXPENSE}>Otro egreso</option>}</select>{other && <input className="otro-ingreso-descripcion" placeholder={income ? "Describe este otro ingreso" : "Describe este otro egreso"} value={notes[row.id] ?? ""} onChange={event => setNotes(current => ({ ...current, [row.id]: event.target.value }))}/>}<button className="primary" disabled={!choices[row.id] || saving === row.id} onClick={() => void save(row)}>{saving === row.id ? "Guardando…" : "Confirmar y guardar"}</button></div>}</article>;
    })}{visible.length === 0 && <p className="empty">No hay movimientos en este filtro.</p>}</section>
  </main></AuthGate>;
}
