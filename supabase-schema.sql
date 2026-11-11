-- ============================================================
--  CONTROLE DE PENDÊNCIAS — ESTRUTURA DO BANCO (SUPABASE)
-- ------------------------------------------------------------
--  COMO USAR:
--   1. Abra o painel do Supabase (https://supabase.com/dashboard).
--   2. Escolha o projeto.
--   3. No menu lateral, clique em "SQL Editor".
--   4. Clique em "New query", cole TODO este arquivo e clique em "Run".
--
--  Pode rodar mais de uma vez: nada é apagado (usa IF NOT EXISTS).
--
--  Segurança: cada usuário só enxerga e altera os próprios dados.
--  A chave "anon public" no site NÃO dá acesso aos dados sem login.
-- ============================================================

-- ---------- Tabela de pendências ----------
create table if not exists public.pendencias (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  numero integer,
  numero_nota text default '',
  af text default '',
  fornecedor text default '',
  data_pagamento date,
  valor_original numeric(14, 2) default 0,
  valor_liquido numeric(14, 2) default 0,
  motivo_pendencia text default '',
  setor text default '',
  responsavel text default '',
  banco text default '',
  status text default '',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists pendencias_user_id_idx on public.pendencias (user_id);
create index if not exists pendencias_data_pagamento_idx on public.pendencias (data_pagamento);

-- ---------- Tabela de opções personalizáveis ----------
create table if not exists public.opcoes (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  setores jsonb not null default '[]'::jsonb,
  bancos jsonb not null default '[]'::jsonb,
  status jsonb not null default '[]'::jsonb,
  atualizado_em timestamptz not null default now()
);

-- ---------- Atualiza automaticamente a data de alteração ----------
create or replace function public.marcar_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

drop trigger if exists pendencias_atualizado_em on public.pendencias;
create trigger pendencias_atualizado_em
  before update on public.pendencias
  for each row execute function public.marcar_atualizado_em();

drop trigger if exists opcoes_atualizado_em on public.opcoes;
create trigger opcoes_atualizado_em
  before update on public.opcoes
  for each row execute function public.marcar_atualizado_em();

-- ============================================================
--  SEGURANÇA (RLS) — cada conta acessa somente seus próprios dados
-- ============================================================
alter table public.pendencias enable row level security;
alter table public.opcoes enable row level security;

-- Pendências: leitura
drop policy if exists pendencias_select on public.pendencias;
create policy pendencias_select on public.pendencias
  for select to authenticated
  using (auth.uid() = user_id);

-- Pendências: inclusão
drop policy if exists pendencias_insert on public.pendencias;
create policy pendencias_insert on public.pendencias
  for insert to authenticated
  with check (auth.uid() = user_id);

-- Pendências: alteração
drop policy if exists pendencias_update on public.pendencias;
create policy pendencias_update on public.pendencias
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Pendências: exclusão
drop policy if exists pendencias_delete on public.pendencias;
create policy pendencias_delete on public.pendencias
  for delete to authenticated
  using (auth.uid() = user_id);

-- Opções: leitura
drop policy if exists opcoes_select on public.opcoes;
create policy opcoes_select on public.opcoes
  for select to authenticated
  using (auth.uid() = user_id);

-- Opções: inclusão
drop policy if exists opcoes_insert on public.opcoes;
create policy opcoes_insert on public.opcoes
  for insert to authenticated
  with check (auth.uid() = user_id);

-- Opções: alteração
drop policy if exists opcoes_update on public.opcoes;
create policy opcoes_update on public.opcoes
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Opções: exclusão
drop policy if exists opcoes_delete on public.opcoes;
create policy opcoes_delete on public.opcoes
  for delete to authenticated
  using (auth.uid() = user_id);

-- ---------- Permissões para usuários logados ----------
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.pendencias to authenticated;
grant select, insert, update, delete on public.opcoes to authenticated;

-- Usuários não logados (anon) não recebem permissão: os dados ficam protegidos.
