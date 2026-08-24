"use client";
import { useEffect, useState } from "react";
import type { StoredStatement } from "@/lib/local-statement-store";
import { clp } from "@/lib/money";
import { AuthGate } from "@/components/auth-gate";

export default function CartolasPage() {
  const [file, setFile] = useState<File | null>(null); const [result, setResult] = useState<StoredStatement | null>(null);
  const [history, setHistory] = useState<StoredStatement[]>([]); const [error, setError] = useState(""); const [loading, setLoading] = useState(false);
  const load = () => fetch("/api/statements").then(r => r.json()).then(setHistory).catch(() => setHistory([]));
  useEffect(() => { void load(); }, []);
  async function upload() {
    if (!file) return; setLoading(true); setError(""); setResult(null);
    const form = new FormData(); form.append("statement", file);
    const response = await fetch("/api/statements", { method: "POST", body: form }); const data = await response.json(); setLoading(false);
    if (!response.ok) { setError(data.error); return; } setResult(data); load();
  }
  return <AuthGate><main className="statement-page"><header className="statement-header"><a href="/">← Presupuesto 2026</a><div><p className="eyebrow">CARTOLAS BANCARIAS</p><h1>Cargar y conciliar</h1></div></header>
    <section className="upload-card"><div className="upload-icon">↥</div><h2>Sube la cartola bancaria</h2><p>El documento original se conserva. Solo aceptamos PDF por ahora.</p><input id="statement" type="file" accept="application/pdf,.pdf" onChange={e => setFile(e.target.files?.[0] ?? null)} /><label htmlFor="statement">Seleccionar PDF</label><span>{file ? file.name : "Máximo 10 MB"}</span><button className="primary" disabled={!file || loading} onClick={upload}>{loading ? "Extrayendo y conciliando…" : "Procesar cartola"}</button>{error && <p className="error">{error}</p>}</section>
    {result && <section className={`reconciliation ${result.reconciled ? "success" : "failed"}`}><div><b>{result.reconciled ? "✓ Conciliación correcta" : "● Error de conciliación"}</b><p>{result.reconciled ? "La cartola fue procesada y puede continuar a clasificación." : "El mes queda bloqueado hasta resolver la diferencia."}</p></div><dl><div><dt>Cargos cartola</dt><dd>{clp(result.declaredChargesClp)}</dd></div><div><dt>Cargos extraídos</dt><dd>{clp(result.extractedChargesClp)}</dd></div><div><dt>Abonos cartola</dt><dd>{clp(result.declaredCreditsClp)}</dd></div><div><dt>Abonos extraídos</dt><dd>{clp(result.extractedCreditsClp)}</dd></div><div><dt>Movimientos</dt><dd>{result.transactions.length}</dd></div></dl>{result.issues.length > 0 && <ul>{result.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}</section>}
    <section className="history"><div><h2>Biblioteca de cartolas</h2><p>Las cargas duplicadas se rechazan por hash del documento.</p></div>{history.length === 0 ? <p className="empty">Aún no hay cartolas cargadas.</p> : <div className="history-grid">{history.map(statement => <article key={statement.id}><small>{statement.periodMonth.toString().padStart(2,"0")}/{statement.periodYear}</small><h3>{statement.fileName}</h3><p>{statement.reconciled ? "✓ Conciliada" : "● Requiere revisión"}</p><span>{statement.transactions.length} movimientos</span></article>)}</div>}</section>
  </main></AuthGate>;
}
