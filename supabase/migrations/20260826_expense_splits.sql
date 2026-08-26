-- Permite dividir un egreso entre varias partidas; una partida sin presupuesto
-- representa "Otro egreso" y conserva la descripción manual.
create table if not exists public.transaction_expense_allocations (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.bank_transactions(id) on delete cascade,
  budget_item_id uuid references public.budget_items(id),
  amount_clp bigint not null check (amount_clp > 0),
  description text not null check (length(trim(description)) > 0),
  created_at timestamptz not null default now()
);

create index if not exists transaction_expense_allocations_transaction_idx
  on public.transaction_expense_allocations(transaction_id);

alter table public.transaction_expense_allocations enable row level security;
grant select, insert, update, delete on public.transaction_expense_allocations to authenticated;

drop policy if exists "treasurer manages expense allocations" on public.transaction_expense_allocations;
create policy "treasurer manages expense allocations" on public.transaction_expense_allocations
  for all to authenticated
  using ((select private.is_treasurer()))
  with check ((select private.is_treasurer()));
