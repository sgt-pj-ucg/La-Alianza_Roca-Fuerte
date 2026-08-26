-- Confirmación atómica: o se guarda íntegramente o no se modifica nada.
create or replace function public.confirm_transaction_classification(
  p_transaction_id uuid,
  p_income_concept_id uuid default null,
  p_budget_item_id uuid default null,
  p_note text default null,
  p_manual_expense boolean default false
)
returns table(transaction_id uuid, status public.classification_status, validated_at timestamptz)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_credit bigint;
  v_charge bigint;
begin
  select credit_clp, charge_clp into v_credit, v_charge
  from public.bank_transactions where id = p_transaction_id;
  if not found then raise exception 'Movimiento bancario no encontrado'; end if;
  if v_credit is not null and (p_income_concept_id is null or p_budget_item_id is not null) then
    raise exception 'Un ingreso requiere un concepto de ingreso válido';
  end if;
  if v_charge is not null and p_income_concept_id is not null then
    raise exception 'Un egreso no puede usar un concepto de ingreso';
  end if;
  if v_charge is not null and p_budget_item_id is null and not p_manual_expense then
    raise exception 'Un egreso requiere una partida o una descripción manual';
  end if;
  if p_manual_expense and nullif(trim(coalesce(p_note, '')), '') is null then
    raise exception 'Otro egreso requiere una descripción';
  end if;

  delete from public.transaction_income_allocations where transaction_id = p_transaction_id;
  delete from public.transaction_expense_allocations where transaction_id = p_transaction_id;

  return query
  insert into public.transaction_classifications (
    transaction_id, income_concept_id, budget_item_id, status, confidence, note, validated_at
  ) values (
    p_transaction_id, p_income_concept_id, p_budget_item_id, 'CONFIRMED', 100,
    nullif(trim(coalesce(p_note, '')), ''), now()
  ) on conflict (transaction_id) do update set
    income_concept_id = excluded.income_concept_id,
    budget_item_id = excluded.budget_item_id,
    status = excluded.status,
    confidence = excluded.confidence,
    note = excluded.note,
    validated_at = excluded.validated_at
  returning transaction_classifications.transaction_id, transaction_classifications.status, transaction_classifications.validated_at;
end;
$$;

grant execute on function public.confirm_transaction_classification(uuid, uuid, uuid, text, boolean) to authenticated;
