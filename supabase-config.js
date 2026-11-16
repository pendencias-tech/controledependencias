// ============================================================
//  CONFIGURAÇÃO DO SUPABASE
// ------------------------------------------------------------
//  COMO PREENCHER:
//   1. Abra https://supabase.com/dashboard e escolha seu projeto.
//   2. No menu lateral, clique em "Project Settings" (engrenagem).
//   3. Clique em "API".
//   4. Copie o valor de "Project URL" e cole em url, abaixo.
//   5. Copie a chave "anon public" e cole em anonKey, abaixo.
//   6. Salve este arquivo.
//
//  OPÇÃO "exigirLogin": defina true para obrigar o login na nuvem antes
//  de usar o sistema. Para o controle de acesso (administrador libera os
//  demais usuários), mantenha true. Defina false apenas se quiser abrir sem
//  login para qualquer pessoa.
//
//  CONTROLE DE ACESSO: o administrador (primeiro usuário do banco) libera ou
//  bloqueia usuários no menu "☰ Ações → 👥 Gerenciar acessos". Usuários
//  liberados acessam o sistema em modo somente leitura.
//
//  A chave "anon public" pode ficar no site: ela só permite o que
//  as regras de segurança (RLS) do banco autorizarem.
//  NUNCA use aqui a chave "service_role".
// ============================================================

window.SUPABASE_CONFIG = {
  url: 'https://sffbppytcygqvgwovfvq.supabase.co',
  anonKey: 'sb_publishable_SwLawCFOyciVYAQGJ1l5uw_r32AAnP1',

  // true = exige login na nuvem para usar o sistema.
  // Para o controle de acesso (administrador libera os demais usuários),
  // mantenha true. Defina false apenas se não quiser controlar acessos.
  exigirLogin: true,
};
