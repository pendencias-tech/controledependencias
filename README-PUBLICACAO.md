# Sistema de Pendências — publicação e nuvem

**Site publicado:** https://pendencias-tech.github.io/controledependencias/
**Repositório:** https://github.com/pendencias-tech/controledependencias

Guia curto para colocar o sistema no ar com **GitHub Pages** e **Supabase**.

## 1. Supabase (banco de dados na nuvem)

1. Entre em <https://supabase.com/dashboard> e abra o projeto.
2. Menu lateral → **SQL Editor** → **New query**.
3. Cole todo o conteúdo de `supabase-schema.sql` e clique em **Run**.
4. Menu lateral → **Project Settings** (engrenagem) → **API**.
5. Copie:
   - **Project URL** (ex.: `https://abcdefghijk.supabase.co`)
   - **anon public** (a chave longa que começa com `eyJ...`)
6. Abra o arquivo `supabase-config.js` e cole os dois valores entre as aspas.
   - Use **somente** a chave `anon public`. Nunca a `service_role`.

### Confirmação de e-mail

No Supabase, em **Authentication → Providers → Email**:

- **Opção fácil:** desligue **Confirm email**. O cadastro entra direto.
- **Opção com confirmação:** mantenha ligado e, em
  **Authentication → URL Configuration**, adicione a URL do site publicado
  em **Site URL** e **Redirect URLs**:

  ```
  https://pendencias-tech.github.io/controledependencias/
  ```

## 2. GitHub Pages

O repositório deve se chamar `sistema-pendencias`.

1. Envie todos os arquivos desta pasta para o repositório (branch `main`).
2. No repositório: **Settings → Pages**.
3. Em **Source**, escolha **Deploy from a branch**.
4. Branch: `main`; pasta: `/ (root)`. Clique em **Save**.
5. Aguarde alguns minutos. O endereço será:
   `https://SEU-USUARIO.github.io/sistema-pendencias/`

## 3. Como o sistema funciona

- Os dados são salvos **imediatamente no navegador** (funciona até sem internet).
- Ao **entrar na nuvem** (menu **☰ Ações → ☁ Entrar na nuvem**), o sistema:
  - na primeira vez, envia os dados deste navegador para a nuvem;
  - nos próximos acessos (mesmo em outro computador), baixa os dados da nuvem.
- Cada alteração é reenviada automaticamente para a nuvem.
- **☁ Sincronizar agora** baixa os dados da nuvem e substitui os deste navegador
  (uma cópia local é guardada antes).
- **☁ Enviar dados para a nuvem** (menu ☰ Ações, com login feito) envia a lista
  deste navegador já sem duplicados, removendo da nuvem os registros repetidos.
- O sistema **não permite informações repetidas**: nota, AF ou registro com os
  mesmos dados (fornecedor, data e valores) é bloqueado no cadastro e ignorado na
  importação de CSV. Ao abrir, registros repetidos já salvos são removidos
  automaticamente e um aviso é exibido.
- Cada conta vê **apenas os próprios dados** (proteção RLS do Supabase).
- Por padrão o sistema abre sem exigir login e a nuvem é opcional. Para
  obrigar o login antes de usar, coloque `exigirLogin: true` em
  `supabase-config.js`.

## 4. Atualizar o site depois

Basta substituir os arquivos alterados no repositório e aguardar a publicação
automática do GitHub Pages.
