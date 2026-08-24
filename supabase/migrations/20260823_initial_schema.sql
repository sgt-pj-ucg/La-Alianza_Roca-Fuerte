create extension if not exists pgcrypto;

create type statement_status as enum ('PENDING','RECONCILED','FAILED','CLOSED');
create type classification_status as enum ('PENDING','SUGGESTED','CONFIRMED','REVIEW');

create table budgets (id uuid primary key default gen_random_uuid(), year integer not null unique, source_file text not null, imported_at timestamptz not null default now());
create table budget_categories (id uuid primary key default gen_random_uuid(), budget_id uuid not null references budgets(id) on delete cascade, name text not null, unique(budget_id,name));
create table budget_items (id uuid primary key default gen_random_uuid(), category_id uuid not null references budget_categories(id) on delete cascade, name text not null, unique(category_id,name));
create table monthly_budgets (id uuid primary key default gen_random_uuid(), budget_item_id uuid not null references budget_items(id) on delete cascade, month smallint not null check(month between 1 and 12), amount_clp bigint not null check(amount_clp >= 0), unique(budget_item_id,month));

create table bank_statements (id uuid primary key default gen_random_uuid(), period_year integer not null, period_month smallint not null check(period_month between 1 and 12), source_path text not null, source_hash text not null unique, declared_charges_clp bigint not null, declared_credits_clp bigint not null, extracted_charges_clp bigint not null, extracted_credits_clp bigint not null, status statement_status not null default 'PENDING', uploaded_at timestamptz not null default now(), unique(period_year,period_month));
create table bank_transactions (id uuid primary key default gen_random_uuid(), statement_id uuid not null references bank_statements(id) on delete restrict, fingerprint text not null unique, booked_at date not null, description text not null, document_number text, channel text, charge_clp bigint check(charge_clp is null or charge_clp >= 0), credit_clp bigint check(credit_clp is null or credit_clp >= 0), balance_clp bigint not null, check((charge_clp is null) <> (credit_clp is null)));

create table income_concepts (id uuid primary key default gen_random_uuid(), name text not null unique);
create table contributors (id uuid primary key default gen_random_uuid(), normalized_name text not null unique, active boolean not null default true, note text);
create table contributor_aliases (id uuid primary key default gen_random_uuid(), contributor_id uuid not null references contributors(id) on delete cascade, alias text not null unique);
create table transaction_classifications (id uuid primary key default gen_random_uuid(), transaction_id uuid not null unique references bank_transactions(id) on delete cascade, income_concept_id uuid references income_concepts(id), budget_item_id uuid references budget_items(id), contributor_id uuid references contributors(id), status classification_status not null default 'PENDING', confidence smallint check(confidence between 0 and 100), note text, validated_at timestamptz);
create table classification_rules (id uuid primary key default gen_random_uuid(), match_text text not null, income_concept_id uuid references income_concepts(id), budget_item_id uuid references budget_items(id), confidence smallint not null check(confidence between 0 and 100), active boolean not null default true, created_at timestamptz not null default now());
create table monthly_closes (id uuid primary key default gen_random_uuid(), year integer not null, month smallint not null check(month between 1 and 12), closed_at timestamptz, reopened_at timestamptz, unique(year,month));
create table audit_logs (id uuid primary key default gen_random_uuid(), entity_type text not null, entity_id uuid not null, action text not null, before_value jsonb, after_value jsonb, created_at timestamptz not null default now());

create index bank_transactions_statement_id_idx on bank_transactions(statement_id);
create index bank_transactions_booked_at_idx on bank_transactions(booked_at);
create index audit_logs_entity_idx on audit_logs(entity_type,entity_id);

alter table budgets enable row level security;
alter table budget_categories enable row level security;
alter table budget_items enable row level security;
alter table monthly_budgets enable row level security;
alter table bank_statements enable row level security;
alter table bank_transactions enable row level security;
alter table income_concepts enable row level security;
alter table contributors enable row level security;
alter table contributor_aliases enable row level security;
alter table transaction_classifications enable row level security;
alter table classification_rules enable row level security;
alter table monthly_closes enable row level security;
alter table audit_logs enable row level security;

revoke all on all tables in schema public from anon, authenticated;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bank-statements', 'bank-statements', false, 10485760, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = array['application/pdf'];
