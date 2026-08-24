-- Solo para los pocos ingresos que deban distribuirse entre varias categorías.
create table if not exists public.transaction_income_allocations (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.bank_transactions(id) on delete cascade,
  income_concept_id uuid not null references public.income_concepts(id),
  amount_clp bigint not null check (amount_clp > 0),
  description text not null check (length(trim(description)) > 0),
  created_at timestamptz not null default now()
);

create index if not exists transaction_income_allocations_transaction_idx
  on public.transaction_income_allocations(transaction_id);
alter table public.transaction_income_allocations enable row level security;
grant select, insert, update, delete on public.transaction_income_allocations to authenticated;
drop policy if exists "treasurer manages income allocations" on public.transaction_income_allocations;
create policy "treasurer manages income allocations" on public.transaction_income_allocations
  for all to authenticated using ((select private.is_treasurer())) with check ((select private.is_treasurer()));
