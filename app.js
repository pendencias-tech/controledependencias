// ============================================================
//  CONTROLE DE PENDÊNCIAS — app.js
// ============================================================

// ---------- Estado global ----------
const CHAVE_OPCOES = 'pendencias_opcoes_v1';

const OPCOES_PADRAO = {
  setores: ['A Pagar', 'A Receber'],
  bancos: ['Brasil', 'Bradesco', 'Santander 2971-4', 'Santander 3617-4'],
  status: ['Pendente', 'Resolvido'],
};

const MAPA_CAMPOS = {
  setores: 'setor',
  bancos: 'banco',
  status: 'status',
};

const MAPA_INPUTS = {
  setores: 'novaOpcaoSetores',
  bancos: 'novaOpcaoBancos',
  status: 'novaOpcaoStatus',
};

const MAPA_LISTAS = {
  setores: 'listaOpcoesSetores',
  bancos: 'listaOpcoesBancos',
  status: 'listaOpcoesStatus',
};

let pendencias = carregarDados();
let opcoes = carregarOpcoes();
let editandoId = null;
let excluindoId = null;

// ---------- Utilitários ----------
function gerarId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Converte qualquer valor (inclusive "R$ 1.234,56") em número
function paraNumero(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  if (valor === null || valor === undefined) return 0;

  let texto = String(valor).replace(/[^\d,.-]/g, '');
  if (texto.includes(',')) {
    // Formato brasileiro: 1.234,56
    texto = texto.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(texto)) {
    // Ponto usado como separador de milhar: 1.500
    texto = texto.replace(/\./g, '');
  }
  const numero = parseFloat(texto);
  return Number.isFinite(numero) ? numero : 0;
}

// Garante que registros antigos/incompletos não quebrem a aplicação
function normalizarPendencia(registro) {
  const p = (registro && typeof registro === 'object') ? registro : {};
  const numero = Number(p.numero);
  const dataValida = typeof p.dataPagamento === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(p.dataPagamento);
  const idLimpo = String(p.id || gerarId()).replace(/[^A-Za-z0-9_-]/g, '');
  const setorTexto = String(p.setor ?? '').trim();
  const statusTexto = String(p.status ?? '').trim();

  // Mantém opções personalizadas, normalizando apenas as conhecidas
  const setorNormalizado = setorTexto.toLowerCase() === 'a pagar' ? 'A Pagar'
    : setorTexto.toLowerCase() === 'a receber' ? 'A Receber'
      : setorTexto;
  const statusNormalizado = !statusTexto ? 'Pendente'
    : statusTexto.toLowerCase() === 'resolvido' ? 'Resolvido'
      : statusTexto.toLowerCase() === 'pendente' ? 'Pendente'
        : statusTexto;

  // Nota e AF são mutuamente exclusivas: uma preenchida, a outra recebe "-"
  let numeroNota = String(p.numeroNota ?? '').trim();
  let af = String(p.af ?? '').trim();
  if (numeroNota && numeroNota !== '-' && !af) af = '-';
  else if (af && af !== '-' && !numeroNota) numeroNota = '-';

  return {
    id: idLimpo || gerarId(),
    numero: Number.isFinite(numero) && numero > 0 ? Math.trunc(numero) : 0,
    numeroNota,
    af,
    fornecedor: String(p.fornecedor ?? '').trim(),
    dataPagamento: dataValida ? p.dataPagamento : '',
    valorOriginal: paraNumero(p.valorOriginal),
    valorLiquido: paraNumero(p.valorLiquido),
    motivoPendencia: String(p.motivoPendencia ?? '').trim(),
    setor: setorNormalizado,
    responsavel: String(p.responsavel ?? '').trim(),
    banco: String(p.banco ?? '').trim(),
    status: statusNormalizado,
  };
}

function carregarDados() {
  try {
    const raw = localStorage.getItem('pendencias_v1');
    const dados = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(dados)) return [];
    return dados
      .filter(p => p && typeof p === 'object')
      .map(normalizarPendencia);
  } catch {
    return [];
  }
}

function salvarDados(lista) {
  const dados = Array.isArray(lista) ? lista : pendencias;
  try {
    localStorage.setItem('pendencias_v1', JSON.stringify(dados));
    pendencias = dados;
    // Espelha na nuvem quando houver sessão (silencioso, em segundo plano)
    if (window.Nuvem) window.Nuvem.enviarPendencias(dados);
    return true;
  } catch (erro) {
    alert('Não foi possível salvar os dados. Verifique o espaço disponível no navegador.');
    return false;
  }
}

// ---------- Opções personalizáveis ----------
function normalizarListaOpcoes(valor, padrao) {
  const origem = Array.isArray(valor) ? valor : padrao;
  const vistos = new Set();
  const lista = [];

  origem.forEach(item => {
    const texto = String(item ?? '').trim();
    if (!texto) return;
    const chave = texto.toLowerCase();
    if (vistos.has(chave)) return;
    vistos.add(chave);
    lista.push(texto);
  });

  return lista.length ? lista : [...padrao];
}

function carregarOpcoes() {
  let salvo = {};
  try {
    salvo = JSON.parse(localStorage.getItem(CHAVE_OPCOES) || '{}') || {};
  } catch {
    salvo = {};
  }

  return {
    setores: normalizarListaOpcoes(salvo.setores, OPCOES_PADRAO.setores),
    bancos: normalizarListaOpcoes(salvo.bancos, OPCOES_PADRAO.bancos),
    status: normalizarListaOpcoes(salvo.status, OPCOES_PADRAO.status),
  };
}

function salvarOpcoes() {
  try {
    localStorage.setItem(CHAVE_OPCOES, JSON.stringify(opcoes));
    if (window.Nuvem) window.Nuvem.enviarOpcoes(opcoes);
    return true;
  } catch {
    alert('Não foi possível salvar as opções. Verifique o espaço disponível no navegador.');
    return false;
  }
}

function valoresEmUso(grupo) {
  const campo = MAPA_CAMPOS[grupo];
  return Array.from(new Set(
    pendencias
      .map(p => String(p[campo] ?? '').trim())
      .filter(Boolean)
  ));
}

function preencherSelect(id, valores, valorAtual, rotuloVazio) {
  const select = document.getElementById(id);
  if (!select) return;

  const lista = Array.from(new Set(
    (valores || [])
      .map(v => String(v ?? '').trim())
      .filter(Boolean)
  ));
  const atual = String(valorAtual ?? '').trim();
  if (atual && !lista.includes(atual)) lista.push(atual);

  select.innerHTML = `<option value="">${esc(rotuloVazio)}</option>` + lista
    .map(v => `<option value="${esc(v)}">${esc(v)}</option>`)
    .join('');
  select.value = atual;
}

function garantirValorSelect(id, valor) {
  const select = document.getElementById(id);
  if (!select) return;

  const texto = String(valor ?? '').trim();
  if (texto && !Array.from(select.options).some(o => o.value === texto)) {
    const opt = document.createElement('option');
    opt.value = texto;
    opt.textContent = texto;
    select.appendChild(opt);
  }
  select.value = texto;
}

function atualizarSelectsFiltros() {
  const mapa = {
    status: 'filtroStatus',
    setores: 'filtroSetor',
    bancos: 'filtroBanco',
  };

  Object.entries(mapa).forEach(([grupo, id]) => {
    const atual = document.getElementById(id)?.value || '';
    // Mantém no filtro valores usados por registros antigos
    const valores = [...opcoes[grupo], ...valoresEmUso(grupo)];
    preencherSelect(id, valores, atual, 'Todos');
  });
}

function atualizarSelectsModal() {
  const mapa = {
    setores: 'setor',
    bancos: 'banco',
    status: 'status',
  };

  Object.entries(mapa).forEach(([grupo, id]) => {
    const atual = document.getElementById(id)?.value || '';
    // Inclui valores usados por registros antigos que não estão mais nas opções
    const valores = [...opcoes[grupo], ...valoresEmUso(grupo)];
    preencherSelect(id, valores, atual, 'Selecione...');
  });
}

function statusPadrao() {
  return opcoes.status.includes('Pendente')
    ? 'Pendente'
    : (opcoes.status[0] || '');
}

function renderizarListaOpcoes() {
  Object.entries(MAPA_LISTAS).forEach(([grupo, id]) => {
    const lista = document.getElementById(id);
    if (!lista) return;

    const itens = opcoes[grupo];
    lista.innerHTML = itens.length
      ? itens.map((opcao, indice) => `
          <li class="opcao-item">
            <span>${esc(opcao)}</span>
            <button type="button" class="btn-opcao-remover"
              onclick="removerOpcao('${grupo}', ${indice})"
              title="Remover opção"
              aria-label="Remover ${esc(opcao)}">✕</button>
          </li>
        `).join('')
      : '<li class="opcoes-vazia">Nenhuma opção cadastrada.</li>';
  });
}

function abrirModalOpcoes() {
  renderizarListaOpcoes();
  document.getElementById('modalOpcoes').classList.add('aberto');
  setTimeout(() => document.getElementById('novaOpcaoSetores')?.focus(), 60);
}

function fecharModalOpcoes() {
  document.getElementById('modalOpcoes').classList.remove('aberto');
}

function fecharModalOpcoesOverlay(e) {
  if (e.target === document.getElementById('modalOpcoes')) fecharModalOpcoes();
}

function adicionarOpcao(event, grupo) {
  event.preventDefault();

  const input = document.getElementById(MAPA_INPUTS[grupo]);
  if (!input) return;

  const valor = input.value.trim();
  if (!valor) {
    input.focus();
    return;
  }

  const duplicada = opcoes[grupo].some(
    item => item.toLowerCase() === valor.toLowerCase()
  );
  if (duplicada) {
    alert('Essa opção já existe.');
    input.select();
    return;
  }

  opcoes[grupo].push(valor);
  if (!salvarOpcoes()) return;

  input.value = '';
  atualizarSelectsFiltros();
  atualizarSelectsModal();
  renderizarListaOpcoes();
  renderizar();
  input.focus();
}

function removerOpcao(grupo, indice) {
  const valor = opcoes[grupo][indice];
  if (!valor) return;

  if (opcoes[grupo].length <= 1) {
    alert('É preciso manter pelo menos uma opção neste campo.');
    return;
  }

  if (!confirm(`Remover a opção "${valor}"? Os registros existentes não serão alterados.`)) {
    return;
  }

  opcoes[grupo].splice(indice, 1);
  if (!salvarOpcoes()) return;

  atualizarSelectsFiltros();
  atualizarSelectsModal();
  renderizarListaOpcoes();
  renderizar();
}

function parseMoeda(str) {
  return paraNumero(str);
}

function formatarMoeda(el) {
  const digitos = el.value.replace(/\D/g, '');
  if (!digitos) { el.value = ''; return; }

  const numero = parseInt(digitos, 10) / 100;
  el.value = numero.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatarMoedaStr(val) {
  if (val === null || val === undefined || val === '') return '—';
  const numero = Number(val);
  if (!Number.isFinite(numero)) return '—';

  return 'R$ ' + numero.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatarData(iso) {
  if (!iso) return '—';
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!partes) return '—';
  return `${partes[3]}/${partes[2]}/${partes[1]}`;
}

function mesAno(iso) {
  // iso: "YYYY-MM-DD"
  if (!iso || !/^\d{4}-\d{2}/.test(iso)) return '';
  return iso.slice(0, 7); // "YYYY-MM"
}

function labelMesAno(str) {
  // str: "YYYY-MM"
  if (!str) return '';
  const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const [ano, mes] = str.split('-');
  const indice = parseInt(mes, 10) - 1;
  if (!ano || !meses[indice]) return str;
  return `${meses[indice]}/${ano}`;
}

function dataHojeISO() {
  const agora = new Date();
  const local = new Date(agora.getTime() - agora.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function mesesDistintos() {
  const set = new Set(pendencias.map(p => mesAno(p.dataPagamento)).filter(Boolean));
  return Array.from(set).sort().reverse();
}

function proximoNumero() {
  if (!pendencias.length) return 1;
  return Math.max(0, ...pendencias.map(p => Number(p.numero) || 0)) + 1;
}

// ---------- Filtros ----------
function getFiltros() {
  return {
    mes: document.getElementById('filtroMes').value,
    status: document.getElementById('filtroStatus').value,
    setor: document.getElementById('filtroSetor').value,
    banco: document.getElementById('filtroBanco').value,
    busca: document.getElementById('filtroBusca').value.toLowerCase().trim(),
  };
}

function limparFiltros() {
  document.getElementById('filtroMes').value = '';
  document.getElementById('filtroStatus').value = '';
  document.getElementById('filtroSetor').value = '';
  document.getElementById('filtroBanco').value = '';
  document.getElementById('filtroBusca').value = '';
  renderizar();
}

function correspondeFiltros(p, f, ignorarMes = false) {
  if (!ignorarMes && f.mes && mesAno(p.dataPagamento) !== f.mes) return false;
  if (f.status && p.status !== f.status) return false;
  if (f.setor && p.setor !== f.setor) return false;
  if (f.banco && p.banco !== f.banco) return false;
  if (f.busca) {
    const haystack = [
      p.fornecedor,
      p.numeroNota,
      p.af,
      p.responsavel,
      p.motivoPendencia,
      p.banco,
    ].join(' ').toLowerCase();
    if (!haystack.includes(f.busca)) return false;
  }
  return true;
}

function filtrar(lista) {
  const f = getFiltros();
  return lista.filter(p => correspondeFiltros(p, f));
}

// Mesma filtragem, mas sem o mês — usada nos gráficos de tendência
function filtrarSemMes(lista) {
  const f = getFiltros();
  return lista.filter(p => correspondeFiltros(p, f, true));
}

function filtrarDashboard(lista) {
  const f = getFiltros();
  const mesDashboard = String(document.getElementById('filtroDashboardMes')?.value || '');

  return lista.filter(p => {
    if (mesDashboard && mesAno(p.dataPagamento) !== mesDashboard) return false;
    if (f.status && p.status !== f.status) return false;
    if (f.setor && p.setor !== f.setor) return false;
    if (f.banco && p.banco !== f.banco) return false;
    if (f.busca) {
      const haystack = [
        p.fornecedor,
        p.numeroNota,
        p.af,
        p.responsavel,
        p.motivoPendencia,
        p.banco,
      ].join(' ').toLowerCase();
      if (!haystack.includes(f.busca)) return false;
    }
    return true;
  });
}

// ---------- Renderizar ----------
function renderizar() {
  renderizarTabs();
  renderizarTabela();
  renderizarDashboard();
}

function renderizarTabs() {
  const container = document.getElementById('mesesTabs');
  const meses = mesesDistintos();
  const filtroMes = document.getElementById('filtroMes').value;

  if (!pendencias.length) { container.innerHTML = ''; return; }

  const abaTodos = `<button class="mes-tab ${filtroMes ? '' : 'ativo'}" onclick="selecionarMes('')">Todos</button>`;

  container.innerHTML = abaTodos + meses.map(m => {
    const ativo = filtroMes === m ? 'ativo' : '';
    return `<button class="mes-tab ${ativo}" onclick="selecionarMes('${m}')">${labelMesAno(m)}</button>`;
  }).join('');
}

function selecionarMes(m) {
  const atual = document.getElementById('filtroMes').value;
  document.getElementById('filtroMes').value = (!m || atual === m) ? '' : m;
  renderizar();
}

// ---------- Dashboard ----------
function somarValores(lista) {
  return lista.reduce((s, p) => s + (Number(p.valorLiquido) || 0), 0);
}

function percentual(parte, total) {
  if (!total) return 0;
  return Math.round((parte / total) * 100);
}

function formatarMoedaCurta(valor) {
  const numero = Number(valor) || 0;
  const absoluto = Math.abs(numero);

  if (absoluto >= 1000000) {
    return 'R$ ' + (numero / 1000000).toLocaleString('pt-BR', {
      maximumFractionDigits: 1,
    }) + ' mi';
  }
  if (absoluto >= 1000) {
    return 'R$ ' + (numero / 1000).toLocaleString('pt-BR', {
      maximumFractionDigits: 1,
    }) + ' mil';
  }
  return formatarMoedaStr(numero);
}

function cardResumo(classe, rotulo, valor, complemento) {
  return `
    <div class="resumo-card ${classe}">
      <div class="label">${rotulo}</div>
      <div class="valor-num">${valor}</div>
      ${complemento ? `<div class="valor-sub">${complemento}</div>` : ''}
    </div>
  `;
}

function renderizarDashboard() {
  const f = getFiltros();
  const selectMes = document.getElementById('filtroDashboardMes');
  const mesDashboard = String(selectMes?.value || '');
  const lista = filtrarDashboard(pendencias);

  const meses = Array.from(new Set(
    pendencias
      .map(p => mesAno(p.dataPagamento))
      .filter(Boolean)
  )).sort().reverse();

  if (selectMes) {
    selectMes.innerHTML = '<option value="">Geral</option>' + meses
      .map(m => `<option value="${esc(m)}">${esc(labelMesAno(m))}</option>`)
      .join('');
    selectMes.value = mesDashboard || '';
  }

  const total = lista.length;
  // Qualquer status diferente de "Resolvido" conta como pendente/em aberto
  const pendentes = lista.filter(p => p.status !== 'Resolvido');
  const resolvidos = lista.filter(p => p.status === 'Resolvido');
  const valorTotal = somarValores(lista);

  const aPagar = lista.filter(p => p.setor === 'A Pagar');
  const aReceber = lista.filter(p => p.setor === 'A Receber');
  const valorPagar = somarValores(aPagar);
  const valorReceber = somarValores(aReceber);
  const saldo = valorReceber - valorPagar;

  const hoje = dataHojeISO();
  const atrasadas = pendentes.filter(p => p.dataPagamento && p.dataPagamento < hoje);
  const valorAtrasado = somarValores(atrasadas);

  const periodo = document.getElementById('dashboardPeriodo');
  if (periodo) {
    periodo.textContent = mesDashboard
      ? `Referência: ${labelMesAno(mesDashboard)}`
      : 'Geral';
  }

  document.getElementById('resumoContainer').innerHTML = [
    cardResumo(
      'total',
      'Total de Pendências',
      total,
      `${pendentes.length} pendente(s) · ${resolvidos.length} resolvida(s)`
    ),
    cardResumo(
      'pendente',
      'Pendentes',
      pendentes.length,
      `${percentual(pendentes.length, total)}% do total`
    ),
    cardResumo(
      'resolvido',
      'Resolvidas',
      resolvidos.length,
      `${percentual(resolvidos.length, total)}% do total`
    ),
    cardResumo(
      'atraso',
      'Em atraso',
      atrasadas.length,
      `${formatarMoedaStr(valorAtrasado)} em aberto`
    ),
    cardResumo(
      'valor',
      'Valor Líquido Total',
      formatarMoedaStr(valorTotal),
      total ? `Ticket médio: ${formatarMoedaStr(valorTotal / total)}` : 'Sem lançamentos'
    ),
    cardResumo(
      'pagar',
      'A Pagar',
      formatarMoedaStr(valorPagar),
      `${aPagar.length} pendência(s)`
    ),
    cardResumo(
      'receber',
      'A Receber',
      formatarMoedaStr(valorReceber),
      `${aReceber.length} pendência(s)`
    ),
    cardResumo(
      saldo >= 0 ? 'saldo-positivo' : 'saldo-negativo',
      'Saldo',
      formatarMoedaStr(saldo),
      'A receber − a pagar'
    ),
  ].join('');

  renderizarGraficoEvolucao();
  renderizarGraficoSetor(lista);
  renderizarGraficoStatus(lista);
  renderizarGraficoBanco(lista);
  renderizarGraficoResponsavel(lista);
}

function ultimosMeses(base, quantidade) {
  const referencia = /^\d{4}-\d{2}$/.test(base || '')
    ? base
    : dataHojeISO().slice(0, 7);
  const [ano, mes] = referencia.split('-').map(Number);
  const meses = [];

  for (let i = quantidade - 1; i >= 0; i--) {
    const data = new Date(ano, mes - 1 - i, 1);
    meses.push(
      `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`
    );
  }
  return meses;
}

function criarCurvaLinha(pontos) {
  if (!pontos.length) return '';
  if (pontos.length < 2) {
    return `M ${pontos[0].x} ${pontos[0].y}`;
  }

  let d = `M ${pontos[0].x} ${pontos[0].y}`;
  for (let i = 0; i < pontos.length - 1; i++) {
    const p0 = pontos[Math.max(0, i - 1)];
    const p1 = pontos[i];
    const p2 = pontos[i + 1];
    const p3 = pontos[Math.min(pontos.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

function passoEscala(valor) {
  if (!Number.isFinite(valor) || valor <= 0) return 1;

  const expoente = Math.floor(Math.log10(valor));
  const base = Math.pow(10, expoente);
  const fracao = valor / base;
  const opcoes = [1, 2, 2.5, 3, 4, 5, 10];
  const passo = opcoes.find(opcao => fracao <= opcao) || 10;

  return passo * base;
}

function renderizarGraficoEvolucao() {
  const el = document.getElementById('graficoEvolucao');
  if (!el) return;

  const mesDashboard = String(document.getElementById('filtroDashboardMes')?.value || '');
  const base = mesDashboard || dataHojeISO().slice(0, 7);
  const meses = ultimosMeses(base, 6);
  const dados = filtrarSemMes(pendencias);
  const itens = meses.map(mes => ({
    mes,
    valor: somarValores(dados.filter(p => mesAno(p.dataPagamento) === mes)),
  }));

  const maiorValor = Math.max(...itens.map(i => i.valor), 0);
  if (!maiorValor) {
    el.innerHTML = '<div class="grafico-vazio">Sem valores no período.</div>';
    return;
  }

  // Usa a largura real do card: mantém textos e pontos proporcionais em qualquer tela
  const larguraConteudo = el.clientWidth ? el.clientWidth - 20 : 600;
  const width = Math.max(260, Math.round(larguraConteudo));
  const height = Math.max(230, Math.min(340, Math.round(width * 0.42)));

  const padding = {
    left: width < 420 ? 62 : 74,
    right: 24,
    top: 34,
    bottom: 44,
  };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  // Escala arredondada para os valores do eixo Y não ficarem espremidos
  const passoY = passoEscala(maiorValor / 4);
  const escalaMaxima = passoY * 4;
  const ticks = [0, 1, 2, 3, 4].map(indice => passoY * indice);

  const x = (indice) => padding.left + (indice * chartW) / Math.max(1, itens.length - 1);
  const y = (valor) => padding.top + (1 - valor / escalaMaxima) * chartH;
  const pontos = itens.map((item, indice) => ({ x: x(indice), y: y(item.valor) }));
  const linha = criarCurvaLinha(pontos);
  const baseArea = padding.top + chartH;
  const area = `${linha} L ${pontos[pontos.length - 1].x.toFixed(2)} ${baseArea.toFixed(2)} L ${pontos[0].x.toFixed(2)} ${baseArea.toFixed(2)} Z`;

  const mostrarValores = width >= 680;
  const mostrarAno = width >= 560;
  const rotuloMes = (mes) => {
    const rotulo = labelMesAno(mes);
    return mostrarAno ? rotulo : rotulo.split('/')[0];
  };
  const rotuloEixo = (valor) => {
    const rotulo = formatarMoedaCurta(valor);
    return width < 420 ? rotulo.replace(/^R\$\s*/, '') : rotulo;
  };

  el.innerHTML = `
    <svg class="grafico-evolucao-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Evolução mensal do valor líquido">
      <defs>
        <linearGradient id="gradEvolucao" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#fd6500" stop-opacity="0.35" />
          <stop offset="100%" stop-color="#fd6500" stop-opacity="0.02" />
        </linearGradient>
      </defs>
      ${ticks.map(valor => `
        <line x1="${padding.left}" y1="${y(valor).toFixed(2)}" x2="${(padding.left + chartW).toFixed(2)}" y2="${y(valor).toFixed(2)}" stroke="#e2e8f0" stroke-width="1" />
        <text x="${padding.left - 10}" y="${y(valor).toFixed(2)}" text-anchor="end" dominant-baseline="middle" font-size="10.5">${rotuloEixo(valor)}</text>
      `).join('')}
      <path d="${area}" fill="url(#gradEvolucao)" />
      <path d="${linha}" fill="none" stroke="#fd6500" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
      ${itens.map((item, indice) => {
        const ancora = indice === 0 ? 'start' : indice === itens.length - 1 ? 'end' : 'middle';
        const valorY = Math.max(pontos[indice].y - 13, padding.top - 20);

        return `
          <circle cx="${pontos[indice].x.toFixed(2)}" cy="${pontos[indice].y.toFixed(2)}" r="5"
            fill="#ffffff" stroke="#fd6500" stroke-width="2.5"
            onclick="selecionarMesEvolucao('${item.mes}')" data-mes="${item.mes}" style="cursor:pointer">
            <title>${labelMesAno(item.mes)}: ${formatarMoedaStr(item.valor)}</title>
          </circle>
          ${mostrarValores ? `<text x="${pontos[indice].x.toFixed(2)}" y="${valorY.toFixed(2)}" text-anchor="${ancora}" font-size="10.5" class="valor-ponto">${formatarMoedaCurta(item.valor)}</text>` : ''}
          <text x="${pontos[indice].x.toFixed(2)}" y="${height - 18}" text-anchor="${ancora}" font-size="11">${rotuloMes(item.mes)}</text>
        `;
      }).join('')}
    </svg>
  `;
}

function selecionarMesEvolucao(mes) {
  const select = document.getElementById('filtroDashboardMes');
  if (select) select.value = mes;
  renderizarDashboard();

  const dados = filtrarSemMes(pendencias);
  const valor = somarValores(dados.filter(p => mesAno(p.dataPagamento) === mes));
  mostrarDetalheGrafico('evolucao', {
    mes,
    valor,
    quantidade: dados.filter(p => mesAno(p.dataPagamento) === mes).length,
  });
}

function donutHTML(itens, rotuloCentro, valorCentro, formatador) {
  const total = itens.reduce((s, i) => s + i.valor, 0);
  if (!total) {
    return '<div class="grafico-vazio">Sem dados para exibir.</div>';
  }

  const fmt = typeof formatador === 'function'
    ? formatador
    : valor => String(valor);

  let acumulado = 0;
  const segmentos = itens.map(item => {
    const inicio = (acumulado / total) * 360;
    acumulado += item.valor;
    const fim = (acumulado / total) * 360;
    return `${item.cor} ${inicio}deg ${fim}deg`;
  }).join(', ');

  return `
    <div class="donut-wrap">
      <div class="donut" style="background: conic-gradient(${segmentos});"
        role="img" aria-label="${esc(rotuloCentro)}: ${esc(valorCentro)}">
        <div class="donut-centro">
          <span class="donut-valor">${valorCentro}</span>
          <span class="donut-label">${esc(rotuloCentro)}</span>
        </div>
      </div>
      <div class="donut-legenda">
        ${itens.map(item => `
          <div class="legenda-item"
            data-nome="${esc(item.nome)}"
            title="${esc(item.nome)}: ${esc(fmt(item.valor))} (${percentual(item.valor, total)}%)">
            <span class="legenda-cor" style="background:${item.cor}"></span>
            <span class="legenda-nome">${esc(item.nome)}</span>
            <span class="legenda-valor">${fmt(item.valor)} <span class="legenda-pct">${percentual(item.valor, total)}%</span></span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

const PALETA_GRAFICOS = [
  '#8b5cf6', '#f59e0b', '#10b981', '#ec4899',
  '#0ea5e9', '#84cc16', '#f97316', '#64748b',
];

function corDoSetor(nome) {
  if (nome === 'A Pagar') return '#dc2626';
  if (nome === 'A Receber') return '#ea580c';
  if (nome === 'Sem setor') return '#94a3b8';

  const indice = opcoes.setores.findIndex(
    item => item.toLowerCase() === nome.toLowerCase()
  );
  const base = indice >= 0 ? indice : nome.length;
  return PALETA_GRAFICOS[base % PALETA_GRAFICOS.length];
}

function corDoStatus(nome) {
  if (nome === 'Pendente') return '#d97706';
  if (nome === 'Resolvido') return '#16a34a';

  const indice = opcoes.status.findIndex(
    item => item.toLowerCase() === nome.toLowerCase()
  );
  const base = indice >= 0 ? indice : nome.length;
  return PALETA_GRAFICOS[base % PALETA_GRAFICOS.length];
}

function mostrarDetalheGrafico(tipo, item, total) {
  const el = document.getElementById('detalheGrafico');
  if (!el) return;

  if (!item) {
    el.innerHTML = '<div class="detalhe-vazio">Selecione um ponto, setor, status ou barra para ver detalhes.</div>';
    return;
  }

  let html = '';

  if (tipo === 'evolucao') {
    html = `
      <div class="detalhe-conteudo">
        <h4>Evolução mensal</h4>
        <p><strong>Mês:</strong> ${labelMesAno(item.mes)}</p>
        <p><strong>Valor líquido:</strong> ${formatarMoedaStr(item.valor)}</p>
        <p><strong>Pendências:</strong> ${item.quantidade || 0}</p>
      </div>
    `;
  } else if (tipo === 'setor') {
    html = `
      <div class="detalhe-conteudo">
        <h4>Setor</h4>
        <p><strong>Setor:</strong> ${esc(item.nome)}</p>
        <p><strong>Valor líquido:</strong> ${formatarMoedaStr(item.valor)}</p>
        <p><strong>Pendências:</strong> ${item.quantidade || 0}</p>
        <p><strong>Participação:</strong> ${percentual(item.valor, total || somarValores(pendencias))}%</p>
      </div>
    `;
  } else if (tipo === 'status') {
    html = `
      <div class="detalhe-conteudo">
        <h4>Status</h4>
        <p><strong>Status:</strong> ${esc(item.nome)}</p>
        <p><strong>Pendências:</strong> ${item.valor}</p>
        <p><strong>Participação:</strong> ${percentual(item.valor, total || 1)}%</p>
      </div>
    `;
  } else if (tipo === 'banco' || tipo === 'responsavel') {
    const rotulo = tipo === 'banco' ? 'Banco' : 'Responsável';
    html = `
      <div class="detalhe-conteudo">
        <h4>${rotulo}</h4>
        <p><strong>Categoria:</strong> ${esc(item.nome)}</p>
        <p><strong>Valor líquido:</strong> ${formatarMoedaStr(item.valor)}</p>
        <p><strong>Pendências:</strong> ${item.quantidade || 0}</p>
        <p><strong>Participação:</strong> ${percentual(item.valor, total || somarValores(pendencias))}%</p>
      </div>
    `;
  }

  el.innerHTML = html;
}

function mostrarDetalheSetor(nome) {
  const lista = filtrarDashboard(pendencias);
  const subset = lista.filter(p => (p.setor || 'Sem setor') === nome);
  const valor = somarValores(subset);
  mostrarDetalheGrafico('setor', {
    nome,
    valor,
    quantidade: subset.length,
  }, somarValores(lista));
}

function mostrarDetalheStatus(nome) {
  const lista = filtrarDashboard(pendencias);
  const subset = lista.filter(p => (p.status || 'Sem status') === nome);
  mostrarDetalheGrafico('status', {
    nome,
    valor: subset.length,
  }, lista.length);
}

function mostrarDetalheBanco(nome) {
  const lista = filtrarDashboard(pendencias);
  const subset = lista.filter(p => (p.banco || 'Não informado') === nome);
  const valor = somarValores(subset);
  mostrarDetalheGrafico('banco', {
    nome,
    valor,
    quantidade: subset.length,
  }, somarValores(lista));
}

function mostrarDetalheResponsavel(nome) {
  const lista = filtrarDashboard(pendencias);
  const subset = lista.filter(p => (p.responsavel || 'Sem responsável') === nome);
  const valor = somarValores(subset);
  mostrarDetalheGrafico('responsavel', {
    nome,
    valor,
    quantidade: subset.length,
  }, somarValores(lista));
}

function renderizarGraficoSetor(lista) {
  const el = document.getElementById('graficoSetor');
  if (!el) return;

  const mapa = new Map();
  lista.forEach(p => {
    const nome = p.setor || 'Sem setor';
    const atual = mapa.get(nome) || { nome, valor: 0 };
    atual.valor += Number(p.valorLiquido) || 0;
    mapa.set(nome, atual);
  });

  const itens = Array.from(mapa.values())
    .filter(item => item.valor > 0)
    .sort((a, b) => b.valor - a.valor)
    .map(item => ({ ...item, cor: corDoSetor(item.nome) }));

  const total = itens.reduce((s, i) => s + i.valor, 0);
  el.innerHTML = donutHTML(itens, 'Total', formatarMoedaCurta(total), formatarMoedaStr);

  el.onclick = (e) => {
    const itemEl = e.target.closest('.legenda-item');
    if (!itemEl) return;
    mostrarDetalheSetor(itemEl.dataset.nome);
  };
}

function renderizarGraficoStatus(lista) {
  const el = document.getElementById('graficoStatus');
  if (!el) return;

  const mapa = new Map();
  lista.forEach(p => {
    const nome = p.status || 'Sem status';
    const atual = mapa.get(nome) || { nome, valor: 0 };
    atual.valor += 1;
    mapa.set(nome, atual);
  });

  const itens = Array.from(mapa.values())
    .sort((a, b) => b.valor - a.valor)
    .map(item => ({ ...item, cor: corDoStatus(item.nome) }));

  el.innerHTML = donutHTML(
    itens,
    'Pendências',
    String(lista.length),
    valor => String(valor)
  );

  el.onclick = (e) => {
    const itemEl = e.target.closest('.legenda-item');
    if (!itemEl) return;
    mostrarDetalheStatus(itemEl.dataset.nome);
  };
}

function renderizarGraficoBanco(lista) {
  const el = document.getElementById('graficoBanco');
  if (!el) return;

  if (!lista.length) {
    el.innerHTML = '<div class="grafico-vazio">Sem dados para exibir.</div>';
    return;
  }

  const mapa = new Map();
  lista.forEach(p => {
    const nome = p.banco || 'Não informado';
    const atual = mapa.get(nome) || { nome, valor: 0, quantidade: 0 };
    atual.valor += Number(p.valorLiquido) || 0;
    atual.quantidade += 1;
    mapa.set(nome, atual);
  });

  const itens = Array.from(mapa.values()).sort((a, b) => b.valor - a.valor);
  const maximo = Math.max(...itens.map(i => i.valor), 0);
  const valorTotal = somarValores(lista);

  el.innerHTML = `
    <div class="bancos-lista">
      ${itens.map(item => {
        const largura = maximo
          ? Math.max((item.valor / maximo) * 100, 2)
          : 0;
        return `
          <div class="banco-item">
            <div class="banco-topo">
              <span class="banco-nome">🏦 ${esc(item.nome)}</span>
              <span class="banco-valor">${formatarMoedaStr(item.valor)}</span>
            </div>
            <div class="banco-trilha">
              <div class="banco-barra" style="width:${largura}%"></div>
            </div>
            <div class="banco-rodape">
              ${item.quantidade} pendência(s) · ${percentual(item.valor, valorTotal)}% do valor
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  el.onclick = (e) => {
    const itemEl = e.target.closest('.banco-item');
    if (!itemEl) return;
    const nome = itemEl.querySelector('.banco-nome').textContent.replace(/^🏦\s*/, '');
    mostrarDetalheBanco(nome);
  };
}

function renderizarGraficoResponsavel(lista) {
  const el = document.getElementById('graficoResponsavel');
  if (!el) return;

  if (!lista.length) {
    el.innerHTML = '<div class="grafico-vazio">Sem dados para exibir.</div>';
    return;
  }

  const mapa = new Map();
  lista.forEach(p => {
    const nome = p.responsavel || 'Sem responsável';
    const atual = mapa.get(nome) || { nome, valor: 0, quantidade: 0 };
    atual.valor += Number(p.valorLiquido) || 0;
    atual.quantidade += 1;
    mapa.set(nome, atual);
  });

  const itens = Array.from(mapa.values()).sort((a, b) => b.valor - a.valor);
  const maximo = Math.max(...itens.map(i => i.valor), 0);
  const valorTotal = somarValores(lista);

  el.innerHTML = `
    <div class="responsavel-lista">
      ${itens.map(item => {
        const largura = maximo
          ? Math.max((item.valor / maximo) * 100, 2)
          : 0;
        return `
          <div class="banco-item">
            <div class="banco-topo">
              <span class="banco-nome">👤 ${esc(item.nome)}</span>
              <span class="banco-valor">${formatarMoedaStr(item.valor)}</span>
            </div>
            <div class="banco-trilha">
              <div class="banco-barra" style="width:${largura}%"></div>
            </div>
            <div class="banco-rodape">
              ${item.quantidade} pendência(s) · ${percentual(item.valor, valorTotal)}% do valor
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  el.onclick = (e) => {
    const itemEl = e.target.closest('.banco-item');
    if (!itemEl) return;
    const nome = itemEl.querySelector('.banco-nome').textContent.replace(/^👤\s*/, '');
    mostrarDetalheResponsavel(nome);
  };
}

function renderizarTabela() {
  const lista = filtrar(pendencias);
  const corpo = document.getElementById('corpoTabela');
  const semDados = document.getElementById('semDados');

  if (!lista.length) {
    corpo.innerHTML = '';
    semDados.style.display = 'block';
    return;
  }
  semDados.style.display = 'none';

  // Ordenar por data de pagamento (mais recente primeiro)
  const ordenado = [...lista].sort((a, b) => {
    const porData = (b.dataPagamento || '').localeCompare(a.dataPagamento || '');
    if (porData !== 0) return porData;
    return (Number(b.numero) || 0) - (Number(a.numero) || 0);
  });

  corpo.innerHTML = ordenado.map((p, idx) => {
    const badgeStatus = p.status === 'Resolvido'
      ? '<span class="badge badge-resolvido">✅ Resolvido</span>'
      : p.status === 'Pendente'
        ? '<span class="badge badge-pendente">⏳ Pendente</span>'
        : p.status
          ? `<span class="badge badge-status">${esc(p.status)}</span>`
          : '<span class="badge">—</span>';

    const classeSetor = p.setor === 'A Pagar' ? 'badge-pagar'
      : p.setor === 'A Receber' ? 'badge-receber' : 'badge-setor';
    const badgeSetor = p.setor
      ? `<span class="badge ${classeSetor}">${esc(p.setor)}</span>`
      : '<span class="badge">—</span>';

    const badgeBanco = p.banco
      ? `<span class="badge badge-banco">🏦 ${esc(p.banco)}</span>`
      : '—';

    const btnResolver = p.status !== 'Resolvido'
      ? `<button class="btn-success-sm" onclick="resolverPendencia('${p.id}')" title="Marcar como resolvido" aria-label="Marcar como resolvido">✓</button>`
      : '';

    return `
      <tr>
        <td><span class="num">${p.numero || idx + 1}</span></td>
        <td><span class="nota">${texto(p.numeroNota)}</span></td>
        <td><span class="nota">${texto(p.af)}</span></td>
        <td><span class="fornecedor-nome">${texto(p.fornecedor)}</span></td>
        <td><span class="data">${formatarData(p.dataPagamento)}</span></td>
        <td><span class="valor original">${formatarMoedaStr(p.valorOriginal)}</span></td>
        <td><span class="valor liquido">${formatarMoedaStr(p.valorLiquido)}</span></td>
        <td title="${esc(p.motivoPendencia)}">${esc(truncar(p.motivoPendencia, 40))}</td>
        <td>${badgeSetor}</td>
        <td>${texto(p.responsavel)}</td>
        <td>${badgeBanco}</td>
        <td>${badgeStatus}</td>
        <td>
          <div class="acoes">
            ${btnResolver}
            <button class="btn-edit" onclick="editarPendencia('${p.id}')" title="Editar" aria-label="Editar pendência">✏</button>
            <button class="btn-del" onclick="excluirPendencia('${p.id}')" title="Excluir" aria-label="Excluir pendência">🗑</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Escapa texto para uso seguro em HTML
function esc(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function texto(valor, fallback = '—') {
  const limpo = esc(valor).trim();
  return limpo || fallback;
}

function truncar(str, max) {
  const valor = String(str ?? '');
  if (!valor) return '—';
  return valor.length > max ? valor.slice(0, max) + '…' : valor;
}

// ---------- Número da Nota x AF ----------
function camposNotaAf() {
  return {
    nota: document.getElementById('numeroNota'),
    af: document.getElementById('af'),
  };
}

// Marca qual campo está com "-" automático (para não apagar o valor real do outro)
function marcarCamposAuto() {
  const { nota, af } = camposNotaAf();
  if (!nota || !af) return;

  const notaValor = nota.value.trim();
  const afValor = af.value.trim();

  nota.dataset.auto = '0';
  af.dataset.auto = '0';

  if (notaValor === '-' && afValor && afValor !== '-') nota.dataset.auto = '1';
  if (afValor === '-' && notaValor && notaValor !== '-') af.dataset.auto = '1';
}

function sincronizarNotaAf(origem) {
  const { nota, af } = camposNotaAf();
  if (!nota || !af) return;

  const campo = origem === 'af' ? af : nota;
  const outro = origem === 'af' ? nota : af;
  const valor = campo.value.trim();

  // O usuário começou a digitar/apagar um campo que estava com "-" automático
  if (campo.dataset.auto === '1' && valor !== '-') {
    campo.dataset.auto = '0';
  }

  if (valor && valor !== '-') {
    // Preencheu este campo: o outro recebe "-"
    outro.value = '-';
    outro.dataset.auto = '1';
    return;
  }

  // Apagou o próprio valor (não o "-" automático): limpa o "-" do outro
  if (!valor && campo.dataset.auto !== '1'
      && outro.dataset.auto === '1' && outro.value === '-') {
    outro.value = '';
    outro.dataset.auto = '0';
  }
}

// ---------- CRUD ----------
function abrirModal(id) {
  editandoId = id || null;
  document.getElementById('modalTitulo').textContent = id ? 'Editar Pendência' : 'Nova Pendência';
  document.getElementById('formPendencia').reset();

  if (id) {
    const p = pendencias.find(x => x.id === id);
    if (!p) { editandoId = null; return; }

    document.getElementById('numeroNota').value = p.numeroNota || '';
    document.getElementById('af').value = p.af || '';
    document.getElementById('fornecedor').value = p.fornecedor || '';
    document.getElementById('dataPagamento').value = p.dataPagamento || '';
    document.getElementById('valorOriginal').value = p.valorOriginal
      ? p.valorOriginal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : '';
    document.getElementById('valorLiquido').value = p.valorLiquido
      ? p.valorLiquido.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : '';
    document.getElementById('motivoPendencia').value = p.motivoPendencia || '';
    document.getElementById('setor').value = p.setor || '';
    document.getElementById('responsavel').value = p.responsavel || '';
    document.getElementById('banco').value = p.banco || '';
    document.getElementById('status').value = p.status || '';
  } else {
    // Valores padrão para facilitar o cadastro
    document.getElementById('dataPagamento').value = dataHojeISO();
    document.getElementById('status').value = statusPadrao() || 'Pendente';
  }

  marcarCamposAuto();
  document.getElementById('modalOverlay').classList.add('aberto');
  setTimeout(() => document.getElementById('numeroNota').focus(), 60);
}

function fecharModal() {
  document.getElementById('modalOverlay').classList.remove('aberto');
  editandoId = null;
}

function fecharModalOverlay(e) {
  if (e.target === document.getElementById('modalOverlay')) fecharModal();
}

function salvarPendencia(e) {
  e.preventDefault();

  const dados = {
    numeroNota: document.getElementById('numeroNota').value.trim(),
    af: document.getElementById('af').value.trim(),
    fornecedor: document.getElementById('fornecedor').value.trim(),
    dataPagamento: document.getElementById('dataPagamento').value,
    valorOriginal: parseMoeda(document.getElementById('valorOriginal').value),
    valorLiquido: parseMoeda(document.getElementById('valorLiquido').value),
    motivoPendencia: document.getElementById('motivoPendencia').value.trim(),
    setor: document.getElementById('setor').value,
    responsavel: document.getElementById('responsavel').value.trim(),
    banco: document.getElementById('banco').value,
    status: document.getElementById('status').value,
  };

  if (!dados.dataPagamento) {
    alert('Informe a data de pagamento.');
    document.getElementById('dataPagamento').focus();
    return;
  }

  if (!(dados.valorOriginal > 0) || !(dados.valorLiquido > 0)) {
    alert('Os valores original e líquido devem ser maiores que zero.');
    const campo = dados.valorOriginal > 0 ? 'valorLiquido' : 'valorOriginal';
    document.getElementById(campo).focus();
    return;
  }

  // Garante a regra: um campo preenchido, o outro recebe "-"
  const notaReal = dados.numeroNota && dados.numeroNota !== '-';
  const afReal = dados.af && dados.af !== '-';
  if (notaReal && !afReal) dados.af = '-';
  else if (afReal && !notaReal) dados.numeroNota = '-';
  else if (!notaReal && !afReal) { dados.numeroNota = ''; dados.af = ''; }

  // Aviso de possível nota duplicada (não bloqueia o cadastro)
  const nota = dados.numeroNota.toLowerCase();
  if (nota && nota !== '-') {
    const conflito = pendencias.find(p =>
      p.id !== editandoId && p.numeroNota.toLowerCase() === nota
    );
    if (conflito) {
      const fornecedor = conflito.fornecedor || 'outro fornecedor';
      if (!confirm(`Já existe uma pendência com a nota "${dados.numeroNota}" (${fornecedor}). Deseja salvar mesmo assim?`)) {
        document.getElementById('numeroNota').focus();
        return;
      }
    }
  }

  let lista;
  if (editandoId) {
    lista = pendencias.map(p => p.id === editandoId ? { ...p, ...dados } : p);
  } else {
    lista = [...pendencias, { id: gerarId(), numero: proximoNumero(), ...dados }];
  }

  if (!salvarDados(lista)) return;

  fecharModal();
  renderizar();
}

function editarPendencia(id) {
  abrirModal(id);
}

function excluirPendencia(id) {
  const p = pendencias.find(x => x.id === id);
  if (!p) return;

  excluindoId = id;

  const textoExclusao = document.getElementById('textoExclusao');
  if (textoExclusao) {
    let referencia = '';
    if (p.numeroNota && p.numeroNota !== '-') referencia = ` (nota ${p.numeroNota})`;
    else if (p.af && p.af !== '-') referencia = ` (AF ${p.af})`;

    textoExclusao.textContent = p.fornecedor
      ? `Deseja realmente excluir a pendência de ${p.fornecedor}${referencia}?`
      : 'Deseja realmente excluir esta pendência?';
  }

  document.getElementById('modalExclusao').classList.add('aberto');
}

function fecharModalExclusao() {
  document.getElementById('modalExclusao').classList.remove('aberto');
  excluindoId = null;
}

function fecharModalExclusaoOverlay(e) {
  if (e.target === document.getElementById('modalExclusao')) fecharModalExclusao();
}

function confirmarExclusao() {
  if (!excluindoId) return;

  const lista = pendencias.filter(p => p.id !== excluindoId);
  if (!salvarDados(lista)) return;

  fecharModalExclusao();
  renderizar();
}

function resolverPendencia(id) {
  const lista = pendencias.map(p =>
    p.id === id ? { ...p, status: 'Resolvido' } : p
  );
  if (!salvarDados(lista)) return;
  renderizar();
}

// ---------- Exportar CSV ----------
function csvCampo(valor) {
  let texto = valor === null || valor === undefined ? '' : String(valor);

  // Evita que o Excel interprete o conteúdo como fórmula
  if (/^[=+\-@\t\r]/.test(texto)) texto = "'" + texto;

  return '"' + texto.replace(/"/g, '""') + '"';
}

function numeroCSV(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero.toFixed(2).replace('.', ',') : '0,00';
}

function exportarCSV() {
  const lista = filtrar(pendencias);
  if (!lista.length) { alert('Nenhum dado para exportar com os filtros atuais.'); return; }

  const cabecalho = [
    'Nº', 'Nº Nota', 'AF', 'Fornecedor', 'Data Pagamento', 'Valor Original',
    'Valor Líquido', 'Motivo', 'Setor', 'Responsável', 'Banco', 'Status'
  ];

  const linhas = lista.map(p => [
    p.numero,
    p.numeroNota,
    p.af,
    p.fornecedor,
    formatarData(p.dataPagamento),
    numeroCSV(p.valorOriginal),
    numeroCSV(p.valorLiquido),
    p.motivoPendencia,
    p.setor,
    p.responsavel,
    p.banco,
    p.status,
  ].map(csvCampo).join(';'));

  const conteudo = '\uFEFF' + [cabecalho.map(csvCampo).join(';'), ...linhas].join('\r\n');
  const blob = new Blob([conteudo], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  const f = getFiltros();
  const sufixo = f.mes ? `_${labelMesAno(f.mes).replace('/', '-')}` : '_todos';

  a.href = url;
  a.download = `pendencias${sufixo}.csv`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();

  // Libera a URL depois que o download iniciar
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------- Importação CSV ----------
const CAMPOS_IMPORTACAO = {
  numero: 'Nº',
  numeroNota: 'Nº Nota',
  af: 'AF',
  fornecedor: 'Fornecedor',
  dataPagamento: 'Data Pagamento',
  valorOriginal: 'Valor Original',
  valorLiquido: 'Valor Líquido',
  motivoPendencia: 'Motivo',
  setor: 'Setor',
  responsavel: 'Responsável',
  banco: 'Banco',
  status: 'Status',
};

function normalizarCabecalhoImportacao(nome) {
  return String(nome ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// Detecta se o arquivo usa ";" (padrão pt-BR/Excel) ou ","
function detectarDelimitadorCSV(texto) {
  const primeiraLinha = String(texto || '').split(/\r\n|\r|\n/, 1)[0] || '';
  const pontoVirgula = (primeiraLinha.match(/;/g) || []).length;
  const virgula = (primeiraLinha.match(/,/g) || []).length;
  return virgula > pontoVirgula ? ',' : ';';
}

// Lê CSV respeitando aspas, escapes ("") e quebras de linha dentro de campos
function parseCSV(texto, delimitador) {
  const registros = [];
  let registro = [];
  let campo = '';
  let dentroAspas = false;

  for (let i = 0; i < texto.length; i++) {
    const caractere = texto[i];

    if (dentroAspas) {
      if (caractere === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          dentroAspas = false;
        }
      } else {
        campo += caractere;
      }
      continue;
    }

    if (caractere === '"') {
      dentroAspas = true;
    } else if (caractere === delimitador) {
      registro.push(campo);
      campo = '';
    } else if (caractere === '\r' || caractere === '\n') {
      if (caractere === '\r' && texto[i + 1] === '\n') i++;
      registro.push(campo);
      campo = '';
      if (registro.some(valor => String(valor).trim() !== '')) {
        registros.push(registro);
      }
      registro = [];
    } else {
      campo += caractere;
    }
  }

  registro.push(campo);
  if (registro.some(valor => String(valor).trim() !== '')) {
    registros.push(registro);
  }

  return registros;
}

function converterDataImportacao(valor) {
  const texto = String(valor ?? '').trim();
  const partes = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(texto);
  if (!partes) return texto;
  const dia = partes[1].padStart(2, '0');
  const mes = partes[2].padStart(2, '0');
  return `${partes[3]}-${mes}-${dia}`;
}

function importarCSVArquivo(event) {
  const arquivo = event.target.files ? event.target.files[0] : null;
  if (!arquivo) return;

  const reader = new FileReader();
  reader.onload = () => {
    const texto = String(reader.result || '').replace(/^\uFEFF/, '');
    const delimitador = detectarDelimitadorCSV(texto);
    const registros = parseCSV(texto, delimitador);

    if (registros.length < 2) {
      alert('O arquivo não contém dados para importar.');
      return;
    }

    const headers = registros[0].map(normalizarCabecalhoImportacao);
    const indiceCampos = {};
    Object.keys(CAMPOS_IMPORTACAO).forEach(campo => {
      indiceCampos[campo] = headers.findIndex(
        h => h === normalizarCabecalhoImportacao(CAMPOS_IMPORTACAO[campo])
      );
    });

    const novasPendencias = [];
    registros.slice(1).forEach(valores => {
      const registro = {};
      Object.keys(CAMPOS_IMPORTACAO).forEach(campo => {
        const idx = indiceCampos[campo];
        const valor = idx >= 0 ? String(valores[idx] ?? '').trim() : '';
        if (valor) registro[campo] = valor;
      });

      novasPendencias.push(normalizarPendencia({
        numero: registro.numero,
        numeroNota: registro.numeroNota,
        af: registro.af,
        fornecedor: registro.fornecedor,
        dataPagamento: converterDataImportacao(registro.dataPagamento),
        valorOriginal: registro.valorOriginal,
        valorLiquido: registro.valorLiquido,
        motivoPendencia: registro.motivoPendencia,
        setor: registro.setor,
        responsavel: registro.responsavel,
        banco: registro.banco,
        status: registro.status,
      }));
    });

    if (!novasPendencias.length) {
      alert('Nenhuma pendência válida encontrada no arquivo.');
      return;
    }

    pendencias = pendencias.concat(novasPendencias);
    salvarDados(pendencias);

    // Atualiza opções (setores, bancos, status) com valores usados nas novas pendências
    Object.keys(MAPA_LISTAS).forEach(grupo => {
      const usados = valoresEmUso(grupo).filter(
        v => v && !opcoes[grupo].some(o => o.toLowerCase() === v.toLowerCase())
      );
      if (usados.length) {
        opcoes[grupo] = [...opcoes[grupo], ...usados];
        salvarOpcoes();
      }
    });

    atualizarSelectsFiltros();
    atualizarSelectsModal();
    renderizar();

    const campoArquivo = document.getElementById('importarCSV');
    if (campoArquivo) campoArquivo.value = '';
    alert(`${novasPendencias.length} pendência(ões) importada(s) com sucesso!`);
  };

  reader.readAsText(arquivo, 'UTF-8');
}

// ---------- Navegação Dashboard / Pendências ----------
function selecionarAba(id) {
  const viewDashboard = document.getElementById('viewDashboard');
  const viewPendencias = document.getElementById('viewPendencias');
  const btnDashboard = document.getElementById('btnNavDashboard');
  const btnPendencias = document.getElementById('btnNavPendencias');

  const ativoDashboard = id === 'dashboard';
  const ativoPendencias = id === 'pendencias';

  if (viewDashboard) {
    viewDashboard.classList.toggle('view-ativo', ativoDashboard);
  }
  if (viewPendencias) {
    viewPendencias.classList.toggle('view-ativo', ativoPendencias);
  }
  if (btnDashboard) {
    btnDashboard.classList.toggle('ativo', ativoDashboard);
  }
  if (btnPendencias) {
    btnPendencias.classList.toggle('ativo', ativoPendencias);
  }

  // Redesenha o gráfico com a largura correta quando o Dashboard volta a ficar visível
  if (ativoDashboard) {
    requestAnimationFrame(() => renderizarGraficoEvolucao());
  }
}

// ---------- Tema claro / escuro ----------
const CHAVE_TEMA = 'pendencias_tema_v1';

function aplicarTema() {
  const tema = localStorage.getItem(CHAVE_TEMA) === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', tema);

  const btnTema = document.getElementById('btnTema');
  if (btnTema) btnTema.textContent = tema === 'dark' ? '☀️ Claro' : '🌙 Escuro';
}

function alternarTema() {
  const tema = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  localStorage.setItem(CHAVE_TEMA, tema);
  aplicarTema();
}

// ---------- Menu de ações do cabeçalho ----------
function alternarMenuAcoes(evento) {
  if (evento) evento.stopPropagation();

  const menu = document.getElementById('menuAcoesLista');
  const botao = document.getElementById('btnMenuAcoes');
  if (!menu || !botao) return;

  if (menu.hasAttribute('hidden')) {
    menu.removeAttribute('hidden');
    botao.setAttribute('aria-expanded', 'true');
    posicionarMenuAcoes();
    const primeiro = menu.querySelector('.menu-acao');
    if (primeiro) primeiro.focus();
  } else {
    fecharMenuAcoes();
  }
}

// Mantém o menu dentro da tela mesmo quando o botão está encostado na borda
function posicionarMenuAcoes() {
  const menu = document.getElementById('menuAcoesLista');
  const botao = document.getElementById('btnMenuAcoes');
  if (!menu || !botao || !menu.offsetParent) return;

  const margem = 12;
  const br = botao.getBoundingClientRect();
  const largura = menu.offsetWidth;
  const pai = menu.offsetParent.getBoundingClientRect();
  const esquerda = Math.min(
    Math.max(br.right - largura, margem),
    window.innerWidth - largura - margem
  );

  menu.style.right = 'auto';
  menu.style.left = `${Math.round(esquerda - pai.left)}px`;
}

function fecharMenuAcoes(devolverFoco) {
  const menu = document.getElementById('menuAcoesLista');
  const botao = document.getElementById('btnMenuAcoes');
  if (!menu || !botao || menu.hasAttribute('hidden')) return;

  menu.setAttribute('hidden', '');
  botao.setAttribute('aria-expanded', 'false');
  if (devolverFoco) botao.focus();
}

document.addEventListener('click', evento => {
  const menu = document.getElementById('menuAcoesLista');
  const botao = document.getElementById('btnMenuAcoes');
  if (!menu || !botao || menu.hasAttribute('hidden')) return;
  if (menu.contains(evento.target) || botao.contains(evento.target)) return;
  fecharMenuAcoes();
});

window.addEventListener('resize', () => fecharMenuAcoes());

// ---------- Tecla ESC fecha modais ----------
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const menu = document.getElementById('menuAcoesLista');
    if (menu && !menu.hasAttribute('hidden')) {
      fecharMenuAcoes(true);
    }
    fecharModal();
    fecharModalExclusao();
    fecharModalOpcoes();
  }
});

// ---------- Redesenha o gráfico ao redimensionar a janela ----------
let temporizadorGraficoEvolucao = null;

window.addEventListener('resize', () => {
  clearTimeout(temporizadorGraficoEvolucao);
  temporizadorGraficoEvolucao = setTimeout(() => {
    const el = document.getElementById('graficoEvolucao');
    if (el && el.offsetParent !== null) renderizarGraficoEvolucao();
  }, 150);
});

// ---------- Init ----------
aplicarTema();
atualizarSelectsFiltros();
atualizarSelectsModal();
renderizarListaOpcoes();
selecionarAba('dashboard');
renderizar();
