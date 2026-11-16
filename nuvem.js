// ============================================================
//  NUVEM (SUPABASE)
//  Login por e-mail/senha e sincronização dos dados.
//
//  Regra de ouro: o navegador (localStorage) continua sendo o
//  armazenamento imediato. A nuvem funciona como espelho:
//   - ao entrar, os dados da nuvem são baixados;
//   - a cada alteração, tudo é reenviado para a nuvem.
//  Sem internet, o app segue funcionando com os dados locais.
// ============================================================

(function () {
  'use strict';

  const config = window.SUPABASE_CONFIG || {};
  const configurada = Boolean(
    typeof config.url === 'string' && /^https?:\/\//.test(config.url.trim()) &&
    typeof config.anonKey === 'string' && config.anonKey.trim().length > 40
  );

  let cliente = null;
  let usuario = null;
  let modoCadastro = false;
  let processando = false;
  let usuarioSincronizado = null;
  let sincronizando = false;

  // Perfil do usuário logado (papel e status de acesso)
  let perfil = null;
  let perfilUsuarioId = null;
  let perfilCarregando = false;
  const CHAVE_PERFIL = 'pendencias_perfil_v1';

  // Quando exigirLogin = true em supabase-config.js, o sistema só é liberado
  // após o login. Por padrão o uso local é permitido (funciona até sem internet).
  const exigirLogin = Boolean(config.exigirLogin);

  // Fila dos envios: evita que duas sincronizações se atropelem
  let fila = Promise.resolve();
  let pendenciasPendentes = null;
  let opcoesPendentes = null;

  // Ids que já existem na nuvem (para detectar exclusões)
  let idsNaNuvem = new Set();

  // Marca que existem alterações locais ainda não confirmadas na nuvem
  const CHAVE_ENVIO_PENDENTE = 'pendencias_envio_pendente_v1';

  function marcarEnvioPendente() {
    try { localStorage.setItem(CHAVE_ENVIO_PENDENTE, '1'); } catch { /* sem espaço */ }
  }

  function limparEnvioPendente() {
    try { localStorage.removeItem(CHAVE_ENVIO_PENDENTE); } catch { /* ignora */ }
  }

  function temEnvioPendente() {
    try { return localStorage.getItem(CHAVE_ENVIO_PENDENTE) === '1'; } catch { return false; }
  }

  let statusEnvio = 'inativo'; // inativo | enviando | ok | erro
  let temporizadorAviso = null;

  // ---------- Utilitários ----------

  function criarCliente() {
    if (!configurada) return null;
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      console.error('[nuvem] Biblioteca do Supabase não carregada.');
      return null;
    }
    if (!cliente) {
      cliente = window.supabase.createClient(config.url.trim(), config.anonKey.trim(), {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });
    }
    return cliente;
  }

  function paraApp(linha) {
    return {
      id: linha.id,
      numero: linha.numero === null || linha.numero === undefined ? 0 : Number(linha.numero),
      numeroNota: linha.numero_nota ?? '',
      af: linha.af ?? '',
      fornecedor: linha.fornecedor ?? '',
      dataPagamento: linha.data_pagamento ?? '',
      valorOriginal: linha.valor_original === null || linha.valor_original === undefined ? 0 : Number(linha.valor_original),
      valorLiquido: linha.valor_liquido === null || linha.valor_liquido === undefined ? 0 : Number(linha.valor_liquido),
      motivoPendencia: linha.motivo_pendencia ?? '',
      setor: linha.setor ?? '',
      responsavel: linha.responsavel ?? '',
      banco: linha.banco ?? '',
      status: linha.status ?? '',
    };
  }

  function paraBanco(p) {
    return {
      id: p.id,
      user_id: usuario.id,
      numero: Number(p.numero) > 0 ? Math.trunc(Number(p.numero)) : null,
      numero_nota: p.numeroNota ?? '',
      af: p.af ?? '',
      fornecedor: p.fornecedor ?? '',
      data_pagamento: p.dataPagamento || null,
      valor_original: Number(p.valorOriginal) || 0,
      valor_liquido: Number(p.valorLiquido) || 0,
      motivo_pendencia: p.motivoPendencia ?? '',
      setor: p.setor ?? '',
      responsavel: p.responsavel ?? '',
      banco: p.banco ?? '',
      status: p.status ?? '',
      atualizado_em: new Date().toISOString(),
    };
  }

  // ---------- Perfil e permissões ----------

  function acessoLiberado() {
    return Boolean(perfil && perfil.status === 'liberado');
  }

  function ehAdmin() {
    return Boolean(perfil && perfil.papel === 'admin' && perfil.status === 'liberado');
  }

  function modoSomenteLeitura() {
    return Boolean(usuario && perfil && perfil.status === 'liberado' && perfil.papel !== 'admin');
  }

  function salvarPerfilCache(p) {
    if (!usuario || !p) return;
    try {
      localStorage.setItem(CHAVE_PERFIL, JSON.stringify({ user_id: usuario.id, perfil: p }));
    } catch { /* sem espaço */ }
  }

  function lerPerfilCache(userId) {
    try {
      const salvo = JSON.parse(localStorage.getItem(CHAVE_PERFIL) || 'null');
      if (salvo && salvo.user_id === userId && salvo.perfil) return salvo.perfil;
    } catch { /* cache inválido */ }
    return null;
  }

  function limparPerfilCache() {
    try { localStorage.removeItem(CHAVE_PERFIL); } catch { /* ignora */ }
  }

  async function carregarPerfil() {
    if (!usuario) {
      perfil = null;
      perfilUsuarioId = null;
      return null;
    }

    perfilCarregando = true;
    atualizarAreaApp();

    try {
      const c = criarCliente();
      const { data, error } = await c
        .from('perfis')
        .select('*')
        .eq('user_id', usuario.id)
        .maybeSingle();

      if (error) throw error;
      perfil = data || null;
      perfilUsuarioId = usuario.id;
      if (perfil) salvarPerfilCache(perfil);
      return perfil;
    } catch (erro) {
      // Sem internet: usa a última permissão confirmada deste usuário
      const cache = lerPerfilCache(usuario.id);
      if (cache) {
        perfil = cache;
        perfilUsuarioId = usuario.id;
        console.warn('[nuvem] sem conexão: usando permissão salva', erro);
        return perfil;
      }
      perfil = null;
      perfilUsuarioId = usuario.id;
      throw erro;
    } finally {
      perfilCarregando = false;
      atualizarAreaApp();
      atualizarInterface();
    }
  }

  function definirStatus(novo) {
    statusEnvio = novo;
    atualizarInterface();
  }

  function atualizarTelas() {
    if (typeof atualizarSelectsFiltros === 'function') atualizarSelectsFiltros();
    if (typeof atualizarSelectsModal === 'function') atualizarSelectsModal();
    if (typeof renderizarListaOpcoes === 'function') renderizarListaOpcoes();
    if (typeof renderizar === 'function') renderizar();
  }

  function mostrarAviso(texto, tipo) {
    let el = document.getElementById('avisoNuvem');
    if (!el) {
      el = document.createElement('div');
      el.id = 'avisoNuvem';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.textContent = texto;
    el.className = 'aviso-nuvem aviso-' + (tipo || 'ok');
    // Força o navegador a perceber a mudança antes de animar
    void el.offsetWidth;
    el.classList.add('visivel');

    clearTimeout(temporizadorAviso);
    temporizadorAviso = setTimeout(() => el.classList.remove('visivel'), 4500);
  }

  function escNuvem(valor) {
    return String(valor ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function traduzirErro(erro) {
    const texto = String((erro && (erro.message || erro.error_description)) || erro || '');
    const minusculo = texto.toLowerCase();
    if (minusculo.includes('invalid login credentials')) return 'E-mail ou senha incorretos.';
    if (minusculo.includes('email not confirmed')) return 'Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.';
    if (minusculo.includes('user already registered')) return 'Esta conta já existe. Use a opção "Entrar".';
    if (minusculo.includes('password should be at least')) return 'A senha precisa ter pelo menos 6 caracteres.';
    if (minusculo.includes('unable to validate email') || minusculo.includes('invalid email')) return 'Informe um e-mail válido.';
    if (minusculo.includes('failed to fetch') || minusculo.includes('networkerror')) return 'Sem conexão com a internet. Tente novamente.';
    if (minusculo.includes('invalid api key') || minusculo.includes('supabasekey')) return 'Configuração do Supabase inválida. Confira a Project URL e a chave anon em supabase-config.js.';
    if (minusculo.includes('rate limit') || minusculo.includes('too many requests')) return 'Muitas tentativas. Aguarde alguns minutos.';
    if (minusculo.includes('relation') && minusculo.includes('does not exist')) return 'As tabelas ainda não foram criadas no Supabase. Rode o arquivo supabase-schema.sql no SQL Editor.';
    if (minusculo.includes('row-level security')) return 'Sem permissão no banco. Confira as regras (RLS) criadas pelo supabase-schema.sql.';

    return texto || 'Não foi possível concluir a operação. Tente novamente.';
  }

  // ---------- Interface ----------

  function atualizarInterface() {
    const entrar = document.getElementById('menuEntrarNuvem');
    const sincronizar = document.getElementById('menuSincronizarNuvem');
    const enviar = document.getElementById('menuEnviarNuvem');
    const acessos = document.getElementById('menuAcessos');
    const nova = document.getElementById('menuNovaPendencia');
    const importar = document.getElementById('menuImportarCSV');
    const opcoesMenu = document.getElementById('menuOpcoes');
    const sair = document.getElementById('menuSairNuvem');
    const info = document.getElementById('menuUsuarioNuvem');
    const badge = document.getElementById('badgeAcesso');

    const liberado = acessoLiberado();
    const admin = ehAdmin();
    const soLeitura = modoSomenteLeitura();

    if (entrar) {
      entrar.hidden = Boolean(usuario);
      if (!configurada) {
        entrar.textContent = '☁ Nuvem não configurada';
      } else {
        entrar.textContent = '☁ Entrar na nuvem';
      }
    }

    if (sincronizar) {
      sincronizar.hidden = !usuario || !liberado;
      const rotulos = {
        enviando: '⏳ Sincronizando...',
        erro: '⚠ Falha ao sincronizar — tentar de novo',
        ok: '☁ Sincronizado — baixar da nuvem',
        inativo: '☁ Sincronizar agora',
      };
      sincronizar.textContent = rotulos[statusEnvio] || rotulos.inativo;
    }

    if (enviar) enviar.hidden = !usuario || !admin;
    if (acessos) acessos.hidden = !admin;
    if (nova) nova.hidden = !liberado || soLeitura;
    if (importar) importar.hidden = !liberado || soLeitura;
    if (opcoesMenu) opcoesMenu.hidden = !liberado || soLeitura;
    if (sair) sair.hidden = !usuario;

    if (info) {
      info.hidden = !usuario;
      info.textContent = usuario ? '👤 ' + (usuario.email || 'conectado') : '';
    }

    if (badge) {
      if (usuario && liberado) {
        badge.hidden = false;
        badge.textContent = admin ? '👑 Administrador' : '👁 Somente leitura';
        badge.className = 'badge-acesso ' + (admin ? 'admin' : 'leitura');
      } else {
        badge.hidden = true;
      }
    }
  }

  function abrirLogin(paraCadastro) {
    if (!configurada) {
      alert(
        'A nuvem ainda não está configurada.\n\n' +
        'Abra o arquivo supabase-config.js e cole a "Project URL" e a chave "anon public" do seu projeto Supabase.\n\n' +
        'Depois, rode o arquivo supabase-schema.sql no SQL Editor do Supabase.'
      );
      return;
    }
    if (usuario) return;

    alternarModo(Boolean(paraCadastro));
    const form = document.getElementById('formLoginNuvem');
    if (form) form.reset();
    const erro = document.getElementById('loginErro');
    if (erro) { erro.hidden = true; erro.textContent = ''; }

    const modal = document.getElementById('modalNuvem');
    if (modal) modal.classList.add('aberto');
    setTimeout(() => {
      const campo = document.getElementById('loginEmail');
      if (campo) campo.focus();
    }, 60);
  }

  function fecharLogin() {
    const modal = document.getElementById('modalNuvem');
    const bloqueado = exigirLogin && Boolean(configurada) && !usuario;
    if (modal) {
      if (bloqueado) modal.classList.add('aberto');
      else modal.classList.remove('aberto');
    }
  }

  function fecharLoginOverlay(evento) {
    if (evento && evento.target === document.getElementById('modalNuvem')) fecharLogin();
  }

  function alternarModo(paraCadastro) {
    modoCadastro = Boolean(paraCadastro);

    const titulo = document.getElementById('tituloLoginNuvem');
    const ajuda = document.getElementById('ajudaLoginNuvem');
    const grupo = document.getElementById('grupoConfirmarSenha');
    const senha2 = document.getElementById('loginSenha2');
    const senha = document.getElementById('loginSenha');
    const botao = document.getElementById('btnLoginNuvem');
    const alternar = document.getElementById('btnAlternarModo');

    if (titulo) titulo.textContent = modoCadastro ? '☁ Criar conta na nuvem' : '☁ Entrar na nuvem';
    if (ajuda) {
      ajuda.textContent = modoCadastro
        ? 'Crie uma conta para acessar seus dados em qualquer dispositivo. Você receberá um e-mail de confirmação.'
        : 'Entre com seu e-mail e senha para carregar seus dados da nuvem.';
    }
    if (grupo) grupo.hidden = !modoCadastro;
    if (senha2) senha2.required = modoCadastro;
    if (senha) senha.autocomplete = modoCadastro ? 'new-password' : 'current-password';
    if (botao) botao.textContent = modoCadastro ? 'Criar conta' : 'Entrar';
    if (alternar) alternar.textContent = modoCadastro ? 'Já tenho conta — entrar' : 'Ainda não tenho conta — criar';

    const erro = document.getElementById('loginErro');
    if (erro) { erro.hidden = true; erro.textContent = ''; }
  }

  async function enviarFormulario(evento) {
    if (evento) evento.preventDefault();
    if (processando) return;

    const erroEl = document.getElementById('loginErro');
    const botao = document.getElementById('btnLoginNuvem');
    const email = String((document.getElementById('loginEmail') || {}).value || '').trim();
    const senha = String((document.getElementById('loginSenha') || {}).value || '');
    const senha2El = document.getElementById('loginSenha2');

    const falhar = (mensagem) => {
      if (erroEl) { erroEl.textContent = mensagem; erroEl.hidden = false; }
    };

    if (erroEl) { erroEl.hidden = true; erroEl.textContent = ''; }

    if (!email || !senha) return falhar('Preencha e-mail e senha.');
    if (modoCadastro && senha2El && senha !== senha2El.value) return falhar('As senhas não conferem.');

    processando = true;
    if (botao) {
      botao.disabled = true;
      botao.textContent = modoCadastro ? 'Criando conta...' : 'Entrando...';
    }

    try {
      if (!configurada) throw new Error('A nuvem ainda não está configurada.');
      const c = criarCliente();
      if (!c) throw new Error('Não foi possível iniciar a conexão com a nuvem.');

      if (modoCadastro) {
        // Depois de confirmar o e-mail, volta para a página inicial do sistema
        const urlRetorno = new URL(window.location.href);
        urlRetorno.search = '';
        urlRetorno.hash = '';

        const { data, error } = await c.auth.signUp({
          email,
          password: senha,
          options: {
            emailRedirectTo: urlRetorno.href,
          },
        });
        if (error) throw error;

        if (data && data.session) {
          fecharLogin();
          mostrarAviso('Conta criada e conectada à nuvem.', 'ok');
        } else {
          // O Supabase exige confirmação por e-mail
          alternarModo(false);
          const ajuda = document.getElementById('ajudaLoginNuvem');
          if (ajuda) {
            ajuda.textContent = 'Conta criada! Abra o e-mail de confirmação enviado pelo Supabase, confirme e depois volte aqui para entrar.';
          }
          if (erroEl) {
            erroEl.textContent = 'Verifique sua caixa de entrada (e o spam) para confirmar o e-mail.';
            erroEl.className = 'login-erro login-aviso';
            erroEl.hidden = false;
          }
        }
      } else {
        const { error } = await c.auth.signInWithPassword({ email, password: senha });
        if (error) throw error;
        fecharLogin();
      }
    } catch (erro) {
      console.error('[nuvem] login', erro);
      if (erroEl) erroEl.className = 'login-erro';
      falhar(traduzirErro(erro));
    } finally {
      processando = false;
      if (botao) {
        botao.disabled = false;
        botao.textContent = modoCadastro ? 'Criar conta' : 'Entrar';
      }
    }
  }

  async function sair() {
    if (!usuario) return;
    if (!confirm('Sair da conta na nuvem?')) return;

    const eraAdmin = ehAdmin();
    const eraUsuario = Boolean(usuario);

    const c = criarCliente();
    if (c) {
      try { await c.auth.signOut(); } catch (erro) { console.warn('[nuvem] sair', erro); }
    }

    usuario = null;
    usuarioSincronizado = null;
    perfil = null;
    perfilUsuarioId = null;
    perfilCarregando = false;
    idsNaNuvem = new Set();
    statusEnvio = 'inativo';
    limparPerfilCache();

    // Usuário comum não deixa os dados compartilhados salvos no navegador
    if (eraUsuario && !eraAdmin) {
      try {
        localStorage.removeItem('pendencias_v1');
        localStorage.removeItem('pendencias_backup_local');
      } catch { /* ignora */ }
      pendencias = [];
      atualizarTelas();
    }

    atualizarInterface();
    atualizarAreaApp();
    mostrarAviso('Você saiu da nuvem.', 'ok');
  }

  // ---------- Dados ----------

  async function baixarPendenciasRemotas() {
    const c = criarCliente();
    const { data, error } = await c
      .from('pendencias')
      .select('*')
      .order('numero', { ascending: true });
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }

  async function baixarOpcoesRemotas() {
    const c = criarCliente();

    // Administrador usa as próprias opções; usuário liberado lê as do admin
    let alvo = usuario.id;
    if (!ehAdmin()) {
      const { data: idAdmin, error: erroAdmin } = await c.rpc('id_admin');
      if (erroAdmin) throw erroAdmin;
      if (!idAdmin) return null;
      alvo = idAdmin;
    }

    const { data, error } = await c
      .from('opcoes')
      .select('*')
      .eq('user_id', alvo)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async function enviarOpcoesAgora(listaOpcoes) {
    const atual = listaOpcoes || opcoes;
    if (!atual) return;
    const c = criarCliente();
    const { error } = await c.from('opcoes').upsert({
      user_id: usuario.id,
      setores: atual.setores || [],
      bancos: atual.bancos || [],
      status: atual.status || [],
      atualizado_em: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (error) throw error;
  }

  async function enviarAgora(lista) {
    if (!usuario) throw new Error('Sem sessão na nuvem.');
    const c = criarCliente();
    const ids = new Set((lista || []).map(p => p && p.id).filter(Boolean));

    // Exclusões: tudo que estava na nuvem e não está mais na lista
    const removidos = [...idsNaNuvem].filter(id => !ids.has(id));
    if (removidos.length) {
      const { error } = await c.from('pendencias').delete().in('id', removidos);
      if (error) throw error;
    }

    if (lista && lista.length) {
      const linhas = lista.map(paraBanco);
      const tamanhoLote = 400;
      for (let i = 0; i < linhas.length; i += tamanhoLote) {
        const { error } = await c
          .from('pendencias')
          .upsert(linhas.slice(i, i + tamanhoLote), { onConflict: 'id' });
        if (error) throw error;
      }
    }

    idsNaNuvem = ids;
    limparEnvioPendente();
  }

  function enfileirar(tarefa) {
    fila = fila.then(tarefa).catch(erro => {
      console.error('[nuvem] envio', erro);
      definirStatus('erro');
    });
    return fila;
  }

  // Chamado pelo app.js sempre que os dados locais mudam
  function enviarPendencias(lista) {
    if (!usuario || !ehAdmin()) return;
    marcarEnvioPendente();
    pendenciasPendentes = Array.isArray(lista) ? lista.slice() : [];
    definirStatus('enviando');
    enfileirar(async () => {
      if (!usuario) return;
      const dados = pendenciasPendentes;
      pendenciasPendentes = null;
      if (!dados) return;
      await enviarAgora(dados);
      definirStatus('ok');
    });
  }

  // Chamado pelo app.js sempre que as opções mudam
  function enviarOpcoes(listaOpcoes) {
    if (!usuario || !ehAdmin()) return;
    opcoesPendentes = listaOpcoes
      ? {
          setores: [...(listaOpcoes.setores || [])],
          bancos: [...(listaOpcoes.bancos || [])],
          status: [...(listaOpcoes.status || [])],
        }
      : null;
    enfileirar(async () => {
      if (!usuario) return;
      const dados = opcoesPendentes;
      opcoesPendentes = null;
      if (!dados) return;
      await enviarOpcoesAgora(dados);
    });
  }

  function aplicarPendenciasRemotas(linhas) {
    const normalizadas = linhas.map(paraApp).map(normalizarPendencia);

    // A nuvem também não deve manter informações repetidas
    const { lista, removidos } = removerDuplicatas(normalizadas);

    pendencias = lista; // variável global do app.js
    try {
      localStorage.setItem('pendencias_v1', JSON.stringify(lista));
    } catch (erro) {
      console.warn('[nuvem] não foi possível gravar o cache local', erro);
    }
    idsNaNuvem = new Set(lista.map(p => p.id));

    const idsRemovidos = removidos.map(p => p.id).filter(Boolean);
    if (idsRemovidos.length && ehAdmin()) {
      // Exclui da nuvem para os repetidos não voltarem na próxima sincronização
      enfileirar(async () => {
        try {
          await excluirPendenciasRemotas(idsRemovidos);
        } catch (erro) {
          console.warn('[nuvem] não foi possível remover duplicados', erro);
        }
      });
      mostrarAviso(
        `${idsRemovidos.length} informação(ões) repetida(s) foi(ram) removida(s). ` +
        'O sistema não permite informações repetidas.',
        'alerta'
      );
    }

    atualizarTelas();
    return idsRemovidos.length;
  }

  async function excluirPendenciasRemotas(ids) {
    if (!usuario || !Array.isArray(ids) || !ids.length) return;
    const c = criarCliente();
    const { error } = await c.from('pendencias').delete().in('id', ids);
    if (error) throw error;
    ids.forEach(id => idsNaNuvem.delete(id));
  }

  function aplicarOpcoesRemotas(dados) {
    opcoes = {
      setores: normalizarListaOpcoes(dados.setores, OPCOES_PADRAO.setores, 'setores'),
      bancos: normalizarListaOpcoes(dados.bancos, OPCOES_PADRAO.bancos, 'bancos'),
      status: normalizarListaOpcoes(dados.status, OPCOES_PADRAO.status, 'status'),
    };
    try {
      localStorage.setItem(CHAVE_OPCOES, JSON.stringify(opcoes));
    } catch (erro) {
      console.warn('[nuvem] não foi possível gravar as opções locais', erro);
    }
    atualizarTelas();
  }

  async function sincronizarAposLogin() {
    if (!usuario || sincronizando) return;

    // Garante que o perfil (papel/status de acesso) esteja carregado
    if (!perfil || perfilUsuarioId !== usuario.id) {
      perfilCarregando = true;
      atualizarAreaApp();
      try {
        await carregarPerfil();
      } catch (erro) {
        console.error('[nuvem] perfil', erro);
        perfil = null;
        perfilUsuarioId = usuario.id;
        perfilCarregando = false;
        atualizarInterface();
        definirStatus('erro');
        mostrarAviso('Não foi possível verificar o acesso. Confira se o SQL atualizado do Supabase foi aplicado.', 'erro');
        return;
      }
    }

    atualizarAreaApp();
    atualizarInterface();

    // Usuários com acesso liberado (ou o administrador) continuam a sincronização
    const liberado = acessoLiberado();
    const admin = ehAdmin();

    if (!liberado) {
      usuarioSincronizado = null;
      definirStatus('inativo');
      return;
    }

    if (usuarioSincronizado === usuario.id) {
      atualizarTelas();
      definirStatus('ok');
      return;
    }

    sincronizando = true;
    definirStatus('enviando');

    try {
      const remotas = await baixarPendenciasRemotas();
      const locais = Array.isArray(pendencias) ? pendencias : [];

      // Se este navegador tem alterações que não chegaram à nuvem
      // (por exemplo, feitas sem internet), elas têm prioridade — inclusive
      // quando a lista local ficou vazia porque o usuário excluiu tudo.
      if (temEnvioPendente() && admin) {
        idsNaNuvem = new Set(remotas.map(linha => linha.id));
        await enviarAgora(locais);
        const opc = await baixarOpcoesRemotas();
        if (!opc) await enviarOpcoesAgora();
        usuarioSincronizado = usuario.id;
        mostrarAviso('Alterações pendentes deste navegador foram enviadas para a nuvem.', 'ok');
        definirStatus('ok');
        return;
      }

      if (!remotas.length && locais.length && admin) {
        // Primeira conexão: sobe o que já existe neste navegador
        idsNaNuvem = new Set();
        await enviarAgora(locais);
        const opc = await baixarOpcoesRemotas();
        if (!opc) await enviarOpcoesAgora();
        usuarioSincronizado = usuario.id;
        mostrarAviso(`${locais.length} pendência(s) deste navegador enviada(s) para a nuvem.`, 'ok');
      } else if (remotas.length) {
        // A nuvem é a fonte da verdade (dados do administrador para usuários liberados)
        if (admin && locais.length) {
          try {
            localStorage.setItem('pendencias_backup_local', JSON.stringify(locais));
          } catch { /* sem espaço: segue */ }
        }
        const removidos = aplicarPendenciasRemotas(remotas);
        const opc = await baixarOpcoesRemotas();
        if (opc) {
          aplicarOpcoesRemotas(opc);
        } else if (admin) {
          await enviarOpcoesAgora();
        }
        usuarioSincronizado = usuario.id;
        const detalheDuplicados = removidos
          ? ` ${removidos} repetida(s) removida(s).`
          : '';
        mostrarAviso(
          `${remotas.length} pendência(s) carregada(s) da nuvem.${detalheDuplicados}`,
          'ok'
        );
      } else {
        // Nuvem e navegador vazios
        const opc = await baixarOpcoesRemotas();
        if (opc) {
          aplicarOpcoesRemotas(opc);
        } else if (admin) {
          await enviarOpcoesAgora();
        }
        usuarioSincronizado = usuario.id;
      }

      definirStatus('ok');
    } catch (erro) {
      console.error('[nuvem] sincronização inicial', erro);
      definirStatus('erro');
      mostrarAviso(traduzirErro(erro), 'erro');
    } finally {
      sincronizando = false;
      atualizarInterface();
    }
  }

  async function baixarDaNuvem(comConfirmacao) {
    if (!usuario) {
      abrirLogin();
      return;
    }
    if (comConfirmacao) {
      const ok = confirm(
        'Baixar os dados da nuvem e substituir os dados deste navegador?\n\n' +
        'Uma cópia dos dados atuais será guardada neste navegador.'
      );
      if (!ok) return;
    }

    try {
      definirStatus('enviando');
      const remotas = await baixarPendenciasRemotas();
      try {
        localStorage.setItem('pendencias_backup_local', JSON.stringify(pendencias));
      } catch { /* sem espaço: segue */ }
      const removidos = aplicarPendenciasRemotas(remotas);

      const opc = await baixarOpcoesRemotas();
      if (opc) {
        aplicarOpcoesRemotas(opc);
      } else {
        await enviarOpcoesAgora();
      }

      usuarioSincronizado = usuario.id;
      definirStatus('ok');
      const detalheDuplicados = removidos
        ? ` ${removidos} informação(ões) repetida(s) removida(s).`
        : '';
      mostrarAviso(`Dados atualizados a partir da nuvem.${detalheDuplicados}`, 'ok');
    } catch (erro) {
      console.error('[nuvem] download', erro);
      definirStatus('erro');
      mostrarAviso(traduzirErro(erro), 'erro');
    }
  }

  async function enviarDadosParaNuvem(comConfirmacao) {
    if (!usuario) {
      abrirLogin();
      return;
    }
    if (!ehAdmin()) {
      mostrarAviso('Apenas o administrador pode enviar dados para a nuvem.', 'erro');
      return;
    }

    if (comConfirmacao) {
      const ok = confirm(
        'Enviar os dados deste navegador para a nuvem?\n\n' +
        'A nuvem será substituída por esta lista, que já está sem informações repetidas. ' +
        'Pendências que existam apenas na nuvem (de outro dispositivo) serão removidas.'
      );
      if (!ok) return;
    }

    try {
      definirStatus('enviando');

      // Garante que nenhuma informação repetida seja enviada
      const { lista, removidos } = removerDuplicatas(pendencias);
      pendencias = lista; // variável global do app.js
      try {
        localStorage.setItem('pendencias_v1', JSON.stringify(lista));
      } catch (erro) {
        console.warn('[nuvem] não foi possível gravar a lista limpa', erro);
      }

      // Lê os ids atuais da nuvem para que os repetidos/ausentes sejam excluídos
      const remotas = await baixarPendenciasRemotas();
      idsNaNuvem = new Set(remotas.map(linha => linha.id));
      await enviarAgora(lista);

      usuarioSincronizado = usuario.id;
      definirStatus('ok');
      atualizarTelas();

      const detalhe = removidos.length
        ? ` ${removidos.length} duplicada(s) removida(s) antes do envio.`
        : ' Nenhuma informação repetida encontrada.';
      mostrarAviso(`Nuvem atualizada com ${lista.length} pendência(s).${detalhe}`, 'ok');
    } catch (erro) {
      console.error('[nuvem] envio manual', erro);
      definirStatus('erro');
      mostrarAviso(traduzirErro(erro), 'erro');
    }
  }

  async function definirAcesso(userId, status) {
    if (!ehAdmin()) return;
    if (status === 'liberado' && userId === usuario.id) return;

    const c = criarCliente();
    const { error } = await c.from('perfis').update({ status }).eq('user_id', userId);
    if (error) {
      console.error('[nuvem] atualizar acesso', error);
      mostrarAviso(traduzirErro(error), 'erro');
      return;
    }

    try {
      const salvo = await carregarPerfil();
      if (salvo) {
        mostrarAviso(
          status === 'liberado'
            ? `${salvo.email || 'Usuário'} foi liberado. Agora possui acesso ao sistema.`
            : `${salvo.email || 'Usuário'} teve o acesso bloqueado.`,
          'ok'
        );
      }
    } catch (erro) {
      console.warn('[nuvem] não foi possível recarregar perfil', erro);
    }

    atualizarTelas();
    atualizarInterface();
  }

  async function abrirAcessos() {
    if (!ehAdmin()) {
      alert('Apenas o administrador pode gerenciar acessos.');
      return;
    }
    const modal = document.getElementById('modalAcessos');
    if (modal) modal.classList.add('aberto');
    await carregarListaAcessos();
  }

  async function carregarListaAcessos() {
    const el = document.getElementById('listaAcessos');
    if (!el) return;
    el.innerHTML = '<p class="acesso-carregando">Carregando...</p>';

    const c = criarCliente();
    if (!c) {
      el.innerHTML = '<p class="acesso-vazio">Nuvem não configurada.</p>';
      return;
    }

    try {
      const { data, error } = await c.from('perfis').select('*').order('criado_em', { ascending: true });
      if (error) throw error;
      renderizarListaAcessos(data || []);
    } catch (erro) {
      console.error('[nuvem] listar perfis', erro);
      el.innerHTML = '<p class="acesso-vazio">Não foi possível carregar a lista de acessos.</p>';
      mostrarAviso(traduzirErro(erro), 'erro');
    }
  }

  function renderizarListaAcessos(lista) {
    const el = document.getElementById('listaAcessos');
    if (!el) return;

    if (!lista.length) {
      el.innerHTML = '<p class="acesso-vazio">Nenhum usuário cadastrado na nuvem.</p>';
      return;
    }

    el.innerHTML = lista.map(item => `
      <div class="acesso-item">
        <div class="acesso-info">
          <span class="acesso-email">${escNuvem(item.email || 'sem e-mail')}</span>
          <span class="acesso-status">${item.status === 'liberado' ? 'Acesso liberado' : (item.status === 'bloqueado' ? 'Acesso bloqueado' : 'Acesso pendente')}</span>
        </div>
        <div class="acesso-acoes">
          ${item.papel === 'admin'
            ? '<span class="acesso-selo">👑 Admin</span>'
            : `
              <button type="button" class="btn-acesso btn-liberar"
                onclick="Nuvem.definirAcesso('${item.user_id}', 'liberado')">
                Liberar
              </button>
              <button type="button" class="btn-acesso btn-bloquear"
                onclick="Nuvem.definirAcesso('${item.user_id}', 'bloqueado')">
                Bloquear
              </button>
            `}
        </div>
      </div>
    `).join('');
  }

  async function fecharAcessos() {
    const modal = document.getElementById('modalAcessos');
    if (modal) modal.classList.remove('aberto');
  }

  function fecharAcessosOverlay(evento) {
    if (evento && evento.target === document.getElementById('modalAcessos')) fecharAcessos();
  }

  // ---------- Inicialização ----------

  // Controla se o conteúdo do app fica visível (bloqueia na tela de login quando exigido)
  function atualizarAreaApp() {
    const area = document.getElementById('appArea');
    const tela = document.getElementById('acessoPendente');

    const precisaLogin = exigirLogin && Boolean(configurada) && !usuario;
    const usuarioLogado = Boolean(usuario);
    const perfilValido = Boolean(perfil && perfilUsuarioId === usuario?.id);
    const verificando = usuarioLogado && !perfilValido;
    const liberado = acessoLiberado();
    const bloqueadoPorAcesso = Boolean(usuarioLogado) && !verificando && !liberado;

    const deveBloquear = Boolean(precisaLogin) || bloqueadoPorAcesso;
    if (area) area.style.display = deveBloquear ? 'none' : 'block';

    const modal = document.getElementById('modalNuvem');
    if (modal) {
      if (precisaLogin) modal.classList.add('aberto');
      else modal.classList.remove('aberto');
    }

    if (tela) {
      const statusBloqueio = !usuarioLogado
        ? 'pendente'
        : verificando
          ? 'verificando'
          : (!perfil ? 'erro' : perfil.status);

      if (usuarioLogado && statusBloqueio !== 'liberado') {
        tela.hidden = false;
        const titulo = document.getElementById('tituloAcessoPendente');
        const texto = document.getElementById('textoAcessoPendente');
        if (statusBloqueio === 'verificando') {
          if (titulo) titulo.textContent = 'Verificando acesso';
          if (texto) texto.textContent = 'Aguarde alguns instantes...';
        } else if (statusBloqueio === 'erro') {
          if (titulo) titulo.textContent = 'Não foi possível verificar o acesso';
          if (texto) texto.textContent = 'Confira se o SQL atualizado do Supabase foi aplicado.';
        } else if (perfil && perfil.status === 'bloqueado') {
          if (titulo) titulo.textContent = 'Acesso bloqueado';
          if (texto) texto.textContent = 'Seu acesso foi bloqueado pelo administrador.';
        } else {
          if (titulo) titulo.textContent = 'Acesso aguardando liberação';
          if (texto) texto.textContent = 'Seu acesso ainda não foi liberado pelo administrador.';
        }
      } else {
        tela.hidden = true;
      }
    }
  }

  async function iniciar() {
    atualizarInterface();

    if (!configurada) {
      console.info('[nuvem] Supabase não configurado — usando apenas dados locais.');
      return;
    }

    const c = criarCliente();
    if (!c) return;

    c.auth.onAuthStateChange((evento, sessao) => {
      usuario = sessao ? sessao.user : null;

      if (evento === 'SIGNED_OUT') {
        usuarioSincronizado = null;
        idsNaNuvem = new Set();
        statusEnvio = 'inativo';
      }

      atualizarInterface();
      atualizarAreaApp();

      if (sessao && (evento === 'SIGNED_IN' || evento === 'INITIAL_SESSION' || evento === 'TOKEN_REFRESHED')) {
        setTimeout(() => { sincronizarAposLogin(); }, 0);
      }
    });

    try {
      const { data } = await c.auth.getSession();
      usuario = data && data.session ? data.session.user : null;
      atualizarInterface();
      atualizarAreaApp();
      if (usuario) await sincronizarAposLogin();
    } catch (erro) {
      console.error('[nuvem] sessão', erro);
    }
  }

  // ESC fecha os modais de login e de acesso
  document.addEventListener('keydown', evento => {
    if (evento.key !== 'Escape') return;
    const modal = document.getElementById('modalNuvem');
    if (modal && modal.classList.contains('aberto')) fecharLogin();
    fecharAcessos();
  });

  window.Nuvem = {
    iniciar,
    estaConfigurada: () => configurada,
    usuarioAtual: () => usuario,
    abrirLogin,
    fecharLogin,
    fecharLoginOverlay,
    alternarModo,
    enviarFormulario,
    sair,
    baixarDaNuvem,
    enviarDadosParaNuvem,
    enviarPendencias,
    enviarOpcoes,
    abrirAcessos,
    fecharAcessos,
    fecharAcessosOverlay,
    definirAcesso,
    carregarListaAcessos,
    atualizarInterface,
    mostrarAviso,
    perfilAtual: () => perfil,
    estaLiberado: () => acessoLiberado(),
    ehAdmin,
    modoSomenteLeitura,
  };

  // Inicia sozinho; app.js já foi carregado antes deste arquivo.
  iniciar();
})();
