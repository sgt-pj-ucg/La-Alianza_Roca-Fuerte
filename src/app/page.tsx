"use client";
import { useMemo, useState } from "react";
import { INITIAL_BUDGET, MONTHS, amountForMonth, annualAmount } from "@/lib/budget";
import { clp, sumClp } from "@/lib/money";
import { AuthGate } from "@/components/auth-gate";

const menu = ["Resumen", "Presupuesto", "Cartolas", "Clasificación", "Ingresos", "Diezmos y aportantes", "Egresos", "Cierre mensual", "Reportes", "Configuración"];
const periods = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre","Acumulado 2026"];

export default function Home() {
  const [active, setActive] = useState("Presupuesto");
  const [period, setPeriod] = useState("Enero");
  const isAnnual = period === "Acumulado 2026";
  const monthIndex = Math.max(0, MONTHS.indexOf(period.slice(0, 3) as typeof MONTHS[number]));
  const items = useMemo(() => INITIAL_BUDGET.map(item => ({ category: item.category, item: item.item, total: isAnnual ? annualAmount(item) : amountForMonth(item, monthIndex) })), [isAnnual, monthIndex]);
  const grouped = items.reduce<Record<string, typeof items>>((groups, line) => {
    (groups[line.category] ??= []).push(line);
    return groups;
  }, {});
  const total = sumClp(items.map(line => line.total));
  return <AuthGate><main className="app-shell">
    <aside className="sidebar"><div className="brand"><span>✦</span><div>TESORERÍA<small>Iglesia · 2026</small></div></div><nav>{menu.map(name => <button key={name} className={active === name ? "active" : ""} onClick={() => name === "Cartolas" ? window.location.assign("/cartolas") : setActive(name)}>{name}</button>)}</nav><div className="sidebar-foot">Datos financieros en CLP<br/><span>Fase 2 · Cartolas</span></div></aside>
    <section className="workspace"><header><div><p className="eyebrow">GESTIÓN FINANCIERA</p><h1>{active}</h1><p className="subhead">Presupuesto 2026 importado desde la fuente original.</p></div><div className="user"><i>MR</i><span>Miriam R.<small>Tesorería</small></span></div></header>
      <div className="notice"><b>✓</b><div><strong>Fuente inicial cargada</strong><br/>26 partidas operativas y sus montos mensuales se conservaron sin distribución uniforme.</div><button>Ver registro</button></div>
      <div className="toolbar"><div><h2>Plan presupuestario</h2><p>Consulta los montos autorizados por partida.</p></div><div className="actions"><select value={period} onChange={e => setPeriod(e.target.value)}>{periods.map(x => <option key={x}>{x}</option>)}</select><button className="primary">↥ Importar presupuesto</button></div></div>
      <div className="cards"><article><small>PRESUPUESTO {isAnnual ? "ANUAL" : "DEL MES"}</small><strong>{clp(total)}</strong><span>Valor planificado</span></article><article><small>PARTIDAS OPERATIVAS</small><strong>{items.length}</strong><span>En cinco categorías</span></article><article><small>EJECUTADO</small><strong>—</strong><span>Disponible después de Fase 2</span></article></div>
      <div className="table-card"><div className="table-head"><h3>Detalle por categoría y partida</h3><span>Los importes se expresan en CLP</span></div><div className="table-wrap"><table><thead><tr><th>Categoría</th><th>Partida</th><th>{isAnnual ? "Presupuesto anual" : `Presupuesto ${MONTHS[monthIndex]}`}</th><th>Ejecutado</th><th>Disponible</th></tr></thead><tbody>{Object.entries(grouped).flatMap(([category, lines]) => lines!.map((line, index) => <tr key={line.item}><td>{index === 0 && <b>{category}</b>}</td><td>{line.item}</td><td className="money">{clp(line.total)}</td><td className="pending">—</td><td className="pending">—</td></tr>))}</tbody><tfoot><tr><td colSpan={2}>Total presupuestado</td><td className="money">{clp(total)}</td><td>—</td><td>—</td></tr></tfoot></table></div></div>
    </section>
  </main></AuthGate>;
}
