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
    const sair = document.getElementById('menuSairNuvem');
    const info = document.getElementById('menuUsuarioNuvem');

    if (entrar) {
      entrar.hidden = Boolean(usuario);
      if (!configurada) {
        entrar.textContent = '☁ Nuvem não configurada';
      } else {
        entrar.textContent = '☁ Entrar na nuvem';
      }
    }

    if (sincronizar) {
      sincronizar.hidden = !usuario;
      const rotulos = {
        enviando: '⏳ Sincronizando...',
        erro: '⚠ Falha ao sincronizar — tentar de novo',
        ok: '☁ Sincronizado — baixar da nuvem',
        inativo: '☁ Sincronizar agora',
      };
      sincronizar.textContent = rotulos[statusEnvio] || rotulos.inativo;
    }

    if (sair) sair.hidden = !usuario;

    if (info) {
      info.hidden = !usuario;
      info.textContent = usuario ? '👤 ' + (usuario.email || 'conectado') : '';
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
    if (modal) modal.classList.remove('aberto');
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
        const { data, error } = await c.auth.signUp({
          email,
          password: senha,
          options: {
            // Depois de confirmar o e-mail, volta para esta mesma página
            emailRedirectTo: window.location.href.split('#')[0],
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
    if (!confirm('Sair da conta na nuvem?\n\nOs dados continuam salvos neste navegador.')) return;

    const c = criarCliente();
    if (c) {
      try { await c.auth.signOut(); } catch (erro) { console.warn('[nuvem] sair', erro); }
    }

    usuario = null;
    usuarioSincronizado = null;
    idsNaNuvem = new Set();
    statusEnvio = 'inativo';
    atualizarInterface();
    mostrarAviso('Você saiu da nuvem. O app continua funcionando com os dados deste navegador.', 'ok');
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
    const { data, error } = await c
      .from('opcoes')
      .select('*')
      .eq('user_id', usuario.id)
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
    if (!usuario) return;
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
    if (!usuario) return;
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
    const lista = linhas.map(paraApp).map(normalizarPendencia);
    pendencias = lista; // variável global do app.js
    try {
      localStorage.setItem('pendencias_v1', JSON.stringify(lista));
    } catch (erro) {
      console.warn('[nuvem] não foi possível gravar o cache local', erro);
    }
    idsNaNuvem = new Set(lista.map(p => p.id));
    atualizarTelas();
  }

  function aplicarOpcoesRemotas(dados) {
    opcoes = {
      setores: normalizarListaOpcoes(dados.setores, OPCOES_PADRAO.setores),
      bancos: normalizarListaOpcoes(dados.bancos, OPCOES_PADRAO.bancos),
      status: normalizarListaOpcoes(dados.status, OPCOES_PADRAO.status),
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
    if (usuarioSincronizado === usuario.id) return;

    sincronizando = true;
    definirStatus('enviando');

    try {
      const remotas = await baixarPendenciasRemotas();
      const locais = Array.isArray(pendencias) ? pendencias : [];

      // Se este navegador tem alterações que não chegaram à nuvem
      // (por exemplo, feitas sem internet), elas têm prioridade.
      if (temEnvioPendente() && locais.length) {
        idsNaNuvem = new Set(remotas.map(linha => linha.id));
        await enviarAgora(locais);
        const opc = await baixarOpcoesRemotas();
        if (!opc) await enviarOpcoesAgora();
        usuarioSincronizado = usuario.id;
        mostrarAviso('Alterações pendentes deste navegador foram enviadas para a nuvem.', 'ok');
        definirStatus('ok');
        return;
      }

      if (!remotas.length && locais.length) {
        // Primeira conexão: sobe o que já existe neste navegador
        idsNaNuvem = new Set();
        await enviarAgora(locais);
        const opc = await baixarOpcoesRemotas();
        if (!opc) await enviarOpcoesAgora();
        usuarioSincronizado = usuario.id;
        mostrarAviso(`${locais.length} pendência(s) deste navegador enviada(s) para a nuvem.`, 'ok');
      } else if (remotas.length) {
        // A nuvem é a fonte da verdade
        if (locais.length) {
          try {
            localStorage.setItem('pendencias_backup_local', JSON.stringify(locais));
          } catch { /* sem espaço: segue */ }
        }
        aplicarPendenciasRemotas(remotas);
        const opc = await baixarOpcoesRemotas();
        if (opc) {
          aplicarOpcoesRemotas(opc);
        } else {
          await enviarOpcoesAgora();
        }
        usuarioSincronizado = usuario.id;
        mostrarAviso(`${remotas.length} pendência(s) carregada(s) da nuvem.`, 'ok');
      } else {
        // Nuvem e navegador vazios
        const opc = await baixarOpcoesRemotas();
        if (!opc) await enviarOpcoesAgora();
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
      aplicarPendenciasRemotas(remotas);

      const opc = await baixarOpcoesRemotas();
      if (opc) aplicarOpcoesRemotas(opc);

      usuarioSincronizado = usuario.id;
      definirStatus('ok');
      mostrarAviso('Dados atualizados a partir da nuvem.', 'ok');
    } catch (erro) {
      console.error('[nuvem] download', erro);
      definirStatus('erro');
      mostrarAviso(traduzirErro(erro), 'erro');
    }
  }

  // ---------- Inicialização ----------

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

      if (sessao && (evento === 'SIGNED_IN' || evento === 'INITIAL_SESSION' || evento === 'TOKEN_REFRESHED')) {
        setTimeout(() => { sincronizarAposLogin(); }, 0);
      }
    });

    try {
      const { data } = await c.auth.getSession();
      usuario = data && data.session ? data.session.user : null;
      atualizarInterface();
      if (usuario) await sincronizarAposLogin();
    } catch (erro) {
      console.error('[nuvem] sessão', erro);
    }
  }

  // ESC fecha a janela de login
  document.addEventListener('keydown', evento => {
    if (evento.key !== 'Escape') return;
    const modal = document.getElementById('modalNuvem');
    if (modal && modal.classList.contains('aberto')) fecharLogin();
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
    enviarPendencias,
    enviarOpcoes,
    atualizarInterface,
    mostrarAviso,
  };

  // Inicia sozinho; app.js já foi carregado antes deste arquivo.
  iniciar();
})();
