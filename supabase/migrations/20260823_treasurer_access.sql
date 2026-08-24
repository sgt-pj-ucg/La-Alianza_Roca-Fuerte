-- Reemplace SOLO el texto entre comillas por el UID del usuario de tesorería
-- que aparece en Authentication > Users. No comparta ese UID en chat.
create schema if not exists private;
revoke all on schema private from public;

create or replace function private.is_treasurer()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() = 'REEMPLAZAR_CON_UID_DE_TESORERIA'::uuid;
$$;

revoke all on function private.is_treasurer() from public;
grant execute on function private.is_treasurer() to authenticated;
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.budgets, public.budget_categories, public.budget_items, public.monthly_budgets, public.bank_statements, public.bank_transactions, public.income_concepts, public.contributors, public.contributor_aliases, public.transaction_classifications, public.classification_rules, public.monthly_closes to authenticated;
grant select on public.audit_logs to authenticated;

create policy "treasurer manages budgets" on public.budgets for all to authenticated using ((select private.is_treasurer())) with check ((select private.is_treasurer()));
create policy "treasurer manages categories" on public.budget_categories for all to authenticated using ((select private.is_treasurer())) with check ((select private.is_treasurer()));
create policy "treasurer manages budget items" on public.budget_items for all to authenticated using ((select private.is_treasurer())) with check ((select private.is_treasurer()));
create policy "treasurer manages monthly budgets" on public.monthly_budgets for all to authenticated using ((select private.is_treasurer())) with check ((select private.is_treasurer()));
create policy "treasurer manages statements" on public.bank_statements for all to authenticated using ((select private.is_treasurer())) with check ((select private.is_treasurer()));
create policy "treasurer manages transactions" on public.bank_transactions for all to authenticated using ((select private.is_treasurer())) with check ((select private.is_treasurer()));
create policy "treasurer manages income concepts" on public.income_concepts for all to authenticated using ((select private.is_treasurer())) with check ((select private.is_treasurer()));
create policy "treasurer manages contributors" on public.contributors for all to authenticated using ((select private.is_treasurer())) with check ((select private.is_treasurer()));
create policy "treasurer manages contributor aliases" on public.contributor_aliases for all to authenticated using ((select private.is_treasurer())) with check ((select private.is_treasurer()));
create policy "treasurer manages classifications" on public.transaction_classifications for all to authenticated using ((select private.is_treasurer())) with check ((select private.is_treasurer()));
create policy "treasurer manages rules" on public.classification_rules for all to authenticated using ((select private.is_treasurer())) with check ((select private.is_treasurer()));
create policy "treasurer manages closes" on public.monthly_closes for all to authenticated using ((select private.is_treasurer())) with check ((select private.is_treasurer()));
create policy "treasurer reads audit" on public.audit_logs for select to authenticated using ((select private.is_treasurer()));

create policy "treasurer manages private statements" on storage.objects for all to authenticated using (bucket_id = 'bank-statements' and (select private.is_treasurer())) with check (bucket_id = 'bank-statements' and (select private.is_treasurer()));
