"use client";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase/client";

export function AuthGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false); const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    if (!supabase) { setError("Falta configurar Supabase en .env.local."); setReady(true); return; }
    const client = supabase as NonNullable<typeof supabase>;
    let active = true;
    async function syncSession() {
      const { data } = await client.auth.getSession();
      if (!active) return;
      if (data.session) { setSignedIn(true); setReady(true); return; }
      const refreshed = await client.auth.refreshSession();
      if (!active) return;
      setSignedIn(Boolean(refreshed.data.session));
      setReady(true);
    }
    void syncSession();
    const { data } = client.auth.onAuthStateChange((_event, session) => { if (active) { setSignedIn(Boolean(session)); setReady(true); } });
    const timer = window.setInterval(() => void syncSession(), 4 * 60 * 1000);
    window.addEventListener("focus", syncSession);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", syncSession); data.subscription.unsubscribe(); };
  }, []);
  async function login() { if (!supabase) return; setError(""); const { error } = await supabase.auth.signInWithPassword({ email, password }); if (error) setError("No fue posible iniciar sesión. Revisa correo y contraseña."); }
  async function logout() { setSignedIn(false); setError(""); await supabase?.auth.signOut({ scope: "local" }); }
  if (!ready) return <main className="auth-screen">Conectando con Tesorería…</main>;
  if (!signedIn) return <main className="auth-screen"><div className="auth-glow one"/><div className="auth-glow two"/><section className="auth-card"><div className="auth-logo-wrap"><img className="auth-logo" src="/logo-la-alianza.png" alt="La Alianza Roca Fuerte"/></div><p className="eyebrow">TESORERÍA IGLESIA · 2026</p><h1>Bienvenida, Miriam</h1><p className="auth-copy">Ingresa con tus credenciales para acceder a la gestión financiera.</p><form onSubmit={event => { event.preventDefault(); void login(); }}><label>Correo electrónico<input placeholder="nombre@correo.cl" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></label><label>Contraseña<input placeholder="••••••••" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label><button className="primary auth-submit" type="submit">Iniciar sesión <span>→</span></button></form>{error && <p className="auth-error">{error}</p>}<p className="auth-foot">Acceso protegido · Tesorería La Alianza Roca Fuerte</p></section></main>;
  return <><button className="sign-out" onClick={() => void logout()}>Cerrar sesión</button>{children}</>;
}
