-- Reapertura excepcional de un mes cerrado.
-- La contraseña se valida en la API; esta función deja el cambio y su auditoría en una sola transacción.
create or replace function public.reopen_closed_month(
  p_year integer,
  p_month smallint,
  p_reason text
)
returns table(statement_id uuid, reopened_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_statement public.bank_statements%rowtype;
  v_close_id uuid;
  v_now timestamptz := now();
begin
  if not (select private.is_treasurer()) then
    raise exception 'Solo la tesorera autorizada puede reabrir un mes';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Debe indicar el motivo de la reapertura';
  end if;

  select * into v_statement
  from public.bank_statements
  where period_year = p_year and period_month = p_month
  for update;
  if not found then raise exception 'No existe una cartola para el período solicitado'; end if;
  if v_statement.status <> 'CLOSED' then raise exception 'El mes no está cerrado'; end if;

  update public.monthly_closes
  set reopened_at = v_now
  where year = p_year and month = p_month
  returning id into v_close_id;
  if v_close_id is null then raise exception 'No existe el cierre mensual a reabrir'; end if;

  update public.bank_statements set status = 'RECONCILED' where id = v_statement.id;
  insert into public.audit_logs (entity_type, entity_id, action, before_value, after_value)
  values (
    'monthly_close', v_close_id, 'REOPENED_WITH_PASSWORD',
    jsonb_build_object('status', 'CLOSED', 'closed_at', (select closed_at from public.monthly_closes where id = v_close_id)),
    jsonb_build_object('status', 'RECONCILED', 'reopened_at', v_now, 'reason', trim(p_reason), 'authorized_by', auth.uid())
  );
  return query select v_statement.id, v_now;
end;
$$;

revoke all on function public.reopen_closed_month(integer, smallint, text) from public;
grant execute on function public.reopen_closed_month(integer, smallint, text) to authenticated;
