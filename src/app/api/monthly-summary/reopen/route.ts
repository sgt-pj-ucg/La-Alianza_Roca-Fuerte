import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const authorization = request.headers.get("authorization");
    if (!url || !key || !authorization?.startsWith("Bearer ")) throw new Error("Tu sesión expiró. Vuelve a iniciar sesión.");
    const client = createClient(url, key, { global: { headers: { Authorization: authorization } } });
    const { data: current, error: currentError } = await client.auth.getUser(authorization.slice("Bearer ".length));
    if (currentError || !current.user?.email) throw new Error("Tu sesión expiró. Vuelve a iniciar sesión.");
    const { year, month, password, reason } = await request.json();
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) throw new Error("El período seleccionado no es válido.");
    if (typeof password !== "string" || password.length < 1) throw new Error("Ingresa la contraseña de la tesorera para autorizar la reapertura.");
    if (typeof reason !== "string" || reason.trim().length < 8) throw new Error("Indica un motivo de al menos 8 caracteres para dejar trazabilidad.");

    // Reautenticación puntual: la contraseña no se guarda ni se registra.
    const verifier = createClient(url, key);
    const { data: verified, error: verifyError } = await verifier.auth.signInWithPassword({ email: current.user.email, password });
    if (verifyError || verified.user?.id !== current.user.id) throw new Error("La contraseña no autoriza la reapertura.");
    const { error: reopenError } = await client.rpc("reopen_closed_month", { p_year: year, p_month: month, p_reason: reason.trim() });
    if (reopenError) throw new Error(reopenError.message);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible reabrir el mes." }, { status: 422, headers: { "Cache-Control": "no-store" } });
  }
}
