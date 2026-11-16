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

-- ---------- Perfis e controle de acesso ----------
-- Cada conta tem um perfil. O administrador libera ou bloqueia o acesso
-- dos demais usuários. Usuários liberados têm acesso somente leitura.
create table if not exists public.perfis (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  nome text default '',
  papel text not null default 'usuario' check (papel in ('admin', 'usuario')),
  status text not null default 'pendente' check (status in ('pendente', 'liberado', 'bloqueado')),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists perfis_papel_idx on public.perfis (papel);
create index if not exists perfis_status_idx on public.perfis (status);

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
--  PERFIS / ACESSOS
-- ============================================================

-- Cria o perfil automaticamente quando uma conta é criada.
-- O primeiro usuário do sistema vira administrador e já entra liberado.
create or replace function public.criar_perfil_do_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  primeiro boolean;
begin
  select not exists (select 1 from public.perfis where papel = 'admin') into primeiro;

  insert into public.perfis (user_id, email, nome, papel, status)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'nome', split_part(coalesce(new.email, ''), '@', 1)),
    case when primeiro then 'admin' else 'usuario' end,
    case when primeiro then 'liberado' else 'pendente' end
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists ao_criar_usuario on auth.users;
create trigger ao_criar_usuario
  after insert on auth.users
  for each row execute function public.criar_perfil_do_usuario();

-- Funções de apoio (security definer: não entram em conflito com o RLS)
create or replace function public.perfil_liberado(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.perfis
    where user_id = uid and status = 'liberado'
  );
$$;

create or replace function public.eh_admin(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.perfis
    where user_id = uid and papel = 'admin' and status = 'liberado'
  );
$$;

create or replace function public.id_admin()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select user_id from public.perfis
  where papel = 'admin'
  order by criado_em asc
  limit 1;
$$;

-- Cria perfis para contas que já existiam antes deste controle
insert into public.perfis (user_id, email, nome)
select
  u.id,
  coalesce(u.email, ''),
  coalesce(u.raw_user_meta_data ->> 'nome', split_part(coalesce(u.email, ''), '@', 1))
from auth.users u
on conflict (user_id) do nothing;

-- Se ainda não existe administrador, o usuário mais antigo assume o papel.
-- Para escolher outro administrador, use (trocando o e-mail):
--   update public.perfis set papel = 'admin', status = 'liberado'
--   where email = 'SEU_EMAIL@EXEMPLO.COM';
do $$
begin
  if not exists (select 1 from public.perfis where papel = 'admin') then
    update public.perfis
    set papel = 'admin', status = 'liberado'
    where user_id = (select user_id from public.perfis order by criado_em asc limit 1);
  end if;

  update public.perfis
  set status = 'liberado'
  where papel = 'admin' and status <> 'liberado';
end;
$$;

-- ============================================================
--  SEGURANÇA (RLS)
--  - Administrador: vê e altera os próprios dados.
--  - Usuário liberado: vê somente os dados do administrador (leitura).
--  - Pendente/bloqueado: não vê nem altera nada.
-- ============================================================
alter table public.pendencias enable row level security;
alter table public.opcoes enable row level security;
alter table public.perfis enable row level security;

-- Perfis: cada um vê o próprio; administrador vê todos e pode liberar/bloquear
drop policy if exists perfis_select on public.perfis;
create policy perfis_select on public.perfis
  for select to authenticated
  using (auth.uid() = user_id or public.eh_admin());

drop policy if exists perfis_update on public.perfis;
create policy perfis_update on public.perfis
  for update to authenticated
  using (public.eh_admin())
  with check (public.eh_admin());

-- Pendências: leitura (administrador ou usuário liberado)
drop policy if exists pendencias_select on public.pendencias;
create policy pendencias_select on public.pendencias
  for select to authenticated
  using (
    (auth.uid() = user_id and public.eh_admin())
    or (public.perfil_liberado() and user_id = public.id_admin())
  );

-- Pendências: inclusão (somente administrador)
drop policy if exists pendencias_insert on public.pendencias;
create policy pendencias_insert on public.pendencias
  for insert to authenticated
  with check (public.eh_admin() and auth.uid() = user_id);

-- Pendências: alteração (somente administrador)
drop policy if exists pendencias_update on public.pendencias;
create policy pendencias_update on public.pendencias
  for update to authenticated
  using (public.eh_admin() and auth.uid() = user_id)
  with check (public.eh_admin() and auth.uid() = user_id);

-- Pendências: exclusão (somente administrador)
drop policy if exists pendencias_delete on public.pendencias;
create policy pendencias_delete on public.pendencias
  for delete to authenticated
  using (public.eh_admin() and auth.uid() = user_id);

-- Opções: leitura (administrador ou usuário liberado)
drop policy if exists opcoes_select on public.opcoes;
create policy opcoes_select on public.opcoes
  for select to authenticated
  using (
    (auth.uid() = user_id and public.eh_admin())
    or (public.perfil_liberado() and user_id = public.id_admin())
  );

-- Opções: inclusão (somente administrador)
drop policy if exists opcoes_insert on public.opcoes;
create policy opcoes_insert on public.opcoes
  for insert to authenticated
  with check (public.eh_admin() and auth.uid() = user_id);

-- Opções: alteração (somente administrador)
drop policy if exists opcoes_update on public.opcoes;
create policy opcoes_update on public.opcoes
  for update to authenticated
  using (public.eh_admin() and auth.uid() = user_id)
  with check (public.eh_admin() and auth.uid() = user_id);

-- Opções: exclusão (somente administrador)
drop policy if exists opcoes_delete on public.opcoes;
create policy opcoes_delete on public.opcoes
  for delete to authenticated
  using (public.eh_admin() and auth.uid() = user_id);

-- ---------- Permissões para usuários logados ----------
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.pendencias to authenticated;
grant select, insert, update, delete on public.opcoes to authenticated;
grant select, update on public.perfis to authenticated;
grant execute on function public.perfil_liberado(uuid) to authenticated;
grant execute on function public.eh_admin(uuid) to authenticated;
grant execute on function public.id_admin() to authenticated;

-- Usuários não logados (anon) não recebem permissão: os dados ficam protegidos.
