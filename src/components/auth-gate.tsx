"use client";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase/client";

export function AuthGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false); const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [signedIn, setSignedIn] = useState(false);
  useEffect(() => { if (!supabase) { setError("Falta configurar Supabase en .env.local."); setReady(true); return; } supabase.auth.getSession().then(({ data }) => { setSignedIn(Boolean(data.session)); setReady(true); }); const { data } = supabase.auth.onAuthStateChange((_event, session) => setSignedIn(Boolean(session))); return () => data.subscription.unsubscribe(); }, []);
  async function login() { if (!supabase) return; setError(""); const { error } = await supabase.auth.signInWithPassword({ email, password }); if (error) setError("No fue posible iniciar sesión. Revisa correo y contraseña."); }
  if (!ready) return <main className="auth-screen">Conectando con Tesorería…</main>;
  if (!signedIn) return <main className="auth-screen"><section><p className="eyebrow">TESORERÍA IGLESIA · 2026</p><h1>Acceso seguro</h1><p>Ingresa con el usuario autorizado de Supabase.</p><input placeholder="Correo" type="email" value={email} onChange={e => setEmail(e.target.value)} /><input placeholder="Contraseña" type="password" value={password} onChange={e => setPassword(e.target.value)} /><button className="primary" onClick={login}>Iniciar sesión</button>{error && <small>{error}</small>}</section></main>;
  return <><button className="sign-out" onClick={() => supabase?.auth.signOut()}>Cerrar sesión</button>{children}</>;
}
