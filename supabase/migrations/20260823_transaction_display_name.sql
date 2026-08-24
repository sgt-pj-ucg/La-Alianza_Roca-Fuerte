-- Alias editable para mejorar la lectura sin alterar la descripción original del banco.
alter table public.bank_transactions add column if not exists display_name text;
