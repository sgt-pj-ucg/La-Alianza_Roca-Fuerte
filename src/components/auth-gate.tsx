"use client";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase/client";

export function AuthGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false); const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [signedIn, setSignedIn] = useState(false);
  useEffect(() => { if (!supabase) { setError("Falta configurar Supabase en .env.local."); setReady(true); return; } supabase.auth.getSession().then(({ data }) => { setSignedIn(Boolean(data.session)); setReady(true); }); const { data } = supabase.auth.onAuthStateChange((_event, session) => setSignedIn(Boolean(session))); return () => data.subscription.unsubscribe(); }, []);
  async function login() { if (!supabase) return; setError(""); const { error } = await supabase.auth.signInWithPassword({ email, password }); if (error) setError("No fue posible iniciar sesión. Revisa correo y contraseña."); }
  if (!ready) return <main className="auth-screen">Conectando con Tesorería…</main>;
  if (!signedIn) return <main className="auth-screen"><div className="auth-glow one"/><div className="auth-glow two"/><section className="auth-card"><div className="auth-logo-wrap"><img className="auth-logo" src="/logo-la-alianza.png" alt="La Alianza Roca Fuerte"/></div><p className="eyebrow">TESORERÍA IGLESIA · 2026</p><h1>Bienvenida, Miriam</h1><p className="auth-copy">Ingresa con tus credenciales para acceder a la gestión financiera.</p><form onSubmit={event => { event.preventDefault(); void login(); }}><label>Correo electrónico<input placeholder="nombre@correo.cl" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></label><label>Contraseña<input placeholder="••••••••" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label><button className="primary auth-submit" type="submit">Iniciar sesión <span>→</span></button></form>{error && <p className="auth-error">{error}</p>}<p className="auth-foot">Acceso protegido · Tesorería La Alianza Roca Fuerte</p></section></main>;
  return <><button className="sign-out" onClick={() => supabase?.auth.signOut()}>Cerrar sesión</button>{children}</>;
}
