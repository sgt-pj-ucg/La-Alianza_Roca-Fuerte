import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const authorization = request.headers.get("authorization");
    if (!url || !key || !authorization?.startsWith("Bearer ")) throw new Error("Tu sesión expiró. Vuelve a iniciar sesión.");
    const client = createClient(url, key, { global: { headers: { Authorization: authorization } } });
    const { data: user, error: userError } = await client.auth.getUser(authorization.slice("Bearer ".length));
    if (userError || !user.user) throw new Error("Tu sesión expiró. Vuelve a iniciar sesión.");
    const { id } = await params; const { displayName } = await request.json();
    if (typeof displayName !== "string" || displayName.trim().length > 140) return NextResponse.json({ error: "El nombre debe tener entre 1 y 140 caracteres." }, { status: 400 });
    const { data: transaction, error: transactionError } = await client.from("bank_transactions").select("bank_statements(status)").eq("id", id).single();
    if (transactionError || !transaction) throw new Error(transactionError?.message ?? "No se encontró el movimiento.");
    const statement = Array.isArray((transaction as any).bank_statements) ? (transaction as any).bank_statements[0] : (transaction as any).bank_statements;
    if (statement?.status === "CLOSED") return NextResponse.json({ error: "El mes está cerrado. Solicita una reapertura controlada antes de modificar un nombre." }, { status: 400 });
    const { error } = await client.from("bank_transactions").update({ display_name: displayName.trim() || null }).eq("id", id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible guardar el nombre." }, { status: 422 }); }
}
