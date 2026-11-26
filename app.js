// =========================================================
// CONFIGURAÇÃO DO SUPABASE
// =========================================================
const SUPABASE_URL = 'https://bmcsutuapnkgdzlsvbox.supabase.co';
const SUPABASE_KEY = 'sb_publishable_tmyvceTKYJMrr907MgGbwQ_0mvlX3F0';

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Estado global
let tarefas = [];
let membros = [];
let categorias = [];
let placarSemanal = [];
let compras = [];
let compraErro = null;
let offsetSemana = 0; // 0 = começa hoje; 1 = próximos 7 dias depois; -1 = 7 dias antes
const diasSelecionados = new Set();

let abaAtual = 'afazeres';
let sessaoAtual = null;
let canalRealtime = null;
let euId = localStorage.getItem('quem-sou-eu') || '';
let editandoId = null;
let trocaRapidaTarefaId = null;
const caixasSubAberta = new Set();

// Instâncias dos gráficos Chart.js
let chartStatus = null;
let chartPessoas = null;
let chartSemana = null;

// Filtros da aba Afazeres
let filtroStatusAfazeres = 'todos';
let filtroPessoaAfazeres = 'todos';
let filtroCatAfazeres = 'todas';
let buscaAfazeres = '';

// Filtros e paginação da aba Concluídos
let limiteConcluidos = 10;
let buscaConcluidos = '';
let filtroCatConcluidos = 'todas';
let filtroPessoaConcluidos = 'todos';

// Elementos do DOM
const appShellEl = document.querySelector('.app-shell');
const painelFormularioEl = document.getElementById('painel-formulario');
const tituloFormularioEl = document.getElementById('titulo-formulario');
const btnSubmitTarefaEl = document.getElementById('btn-submit-tarefa');
const btnCancelarEdicaoEl = document.getElementById('btn-cancelar-edicao');

const inputTituloEl = document.getElementById('input-titulo');
const selectMembroEl = document.getElementById('select-membro');
const selectCategoriaEl = document.getElementById('select-categoria');
const inputDataEl = document.getElementById('input-data');
const selectTurnoEl = document.getElementById('select-turno');
const selectRecorrenciaEl = document.getElementById('select-recorrencia');
const selectPontosEl = document.getElementById('select-pontos');
const inputObservacoesEl = document.getElementById('input-observacoes');
const checkRodizioEl = document.getElementById('check-rodizio');
const blocoDiasSemanaEl = document.getElementById('bloco-dias-semana');
const blocoRodizioEl = document.getElementById('bloco-rodizio');
const statusConexaoEl = document.getElementById('status-conexao');

// Data de hoje calculada na hora (o app pode ficar aberto de um dia para o outro)
function hojeISO() {
  return new Date().toLocaleDateString('en-CA');
}
inputDataEl.value = hojeISO();

// Só aceita cores no formato #rgb / #rrggbb (o valor vai direto para o atributo style)
function corSegura(cor) {
  return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(cor || '') ? cor : '#64748b';
}

function escaparHTML(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}

function mostrarToast(mensagem, tipo = 'sucesso') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${tipo}`;
  toast.textContent = mensagem;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    toast.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
    setTimeout(() => toast.remove(), 220);
  }, 2800);
}

function tarefaEstaAtrasada(tarefa) {
  return !tarefa.concluida && tarefa.data_prevista < hojeISO();
}

function isoParaData(iso) {
  const [ano, mes, dia] = iso.split('-').map(Number);
  return new Date(ano, mes - 1, dia);
}

function dataParaISO(data) {
  return data.toLocaleDateString('en-CA');
}

function somarDias(iso, dias) {
  const d = isoParaData(iso);
  d.setDate(d.getDate() + dias);
  return dataParaISO(d);
}

const RECORRENCIAS = ['diaria', 'dias_semana', 'semanal', 'quinzenal', 'mensal'];

function ehRecorrente(tarefa) {
  return RECORRENCIAS.includes(tarefa.recorrencia);
}

// Calcula a data da próxima repetição a partir da data prevista (ou de hoje, se estiver atrasada)
function calcularProximaData(dataAtualISO, recorrencia, diasSemana = []) {
  const hoje = hojeISO();
  const baseISO = dataAtualISO < hoje ? hoje : dataAtualISO;

  if (recorrencia === 'semanal') return somarDias(baseISO, 7);
  if (recorrencia === 'quinzenal') return somarDias(baseISO, 14);

  if (recorrencia === 'dias_semana' && diasSemana && diasSemana.length > 0) {
    for (let i = 1; i <= 7; i++) {
      const candidato = somarDias(baseISO, i);
      if (diasSemana.includes(isoParaData(candidato).getDay())) return candidato;
    }
  }

  if (recorrencia === 'mensal') {
    // Mesmo dia do mês da data original (ajusta para o último dia em meses mais curtos)
    const original = isoParaData(dataAtualISO);
    const diaAlvo = original.getDate();
    let ano = original.getFullYear();
    let mes = original.getMonth();
    let candidato;
    do {
      mes += 1;
      const ultimoDia = new Date(ano, mes + 1, 0).getDate();
      candidato = dataParaISO(new Date(ano, mes, Math.min(diaAlvo, ultimoDia)));
    } while (candidato <= hoje);
    return candidato;
  }

  return somarDias(baseISO, 1);
}

// Rodízio: próxima pessoa na ordem da lista de moradores
function proximoMembroRodizio(membroAtualId) {
  if (membros.length === 0) return membroAtualId;
  const idx = membros.findIndex((m) => m.id === membroAtualId);
  return membros[(idx + 1) % membros.length].id;
}

const NOMES_DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function descreverRecorrencia(tarefa) {
  switch (tarefa.recorrencia) {
    case 'diaria': return '🔁 Diária';
    case 'semanal': return '📅 Semanal';
    case 'quinzenal': return '🗓️ Quinzenal';
    case 'mensal': return '🌙 Mensal';
    case 'dias_semana': {
      const dias = [...(tarefa.dias_semana || [])].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
      return '📆 ' + (dias.length ? dias.map((d) => NOMES_DIAS[d]).join(', ') : 'Dias da semana');
    }
    default: return '';
  }
}

function formatarDataHoraConclusao(isoString) {
  if (!isoString) return 'Concluída';
  const dt = new Date(isoString);
  const dia = String(dt.getDate()).padStart(2, '0');
  const mes = String(dt.getMonth() + 1).padStart(2, '0');
  const hora = String(dt.getHours()).padStart(2, '0');
  const min = String(dt.getMinutes()).padStart(2, '0');
  return `${dia}/${mes} às ${hora}:${min}`;
}

// =========================================================
// NAVEGAÇÃO POR ABAS E BARRA LATERAL RETRÁTIL
// =========================================================
function toggleSidebar() {
  if (window.innerWidth <= 768) {
    appShellEl.classList.toggle('sidebar-aberta-mobile');
  } else {
    appShellEl.classList.toggle('sidebar-recolhida');
  }
}

function fecharSidebarMobile() {
  appShellEl.classList.remove('sidebar-aberta-mobile');
}

document.getElementById('btn-toggle-sidebar').addEventListener('click', toggleSidebar);
document.getElementById('btn-fechar-sidebar').addEventListener('click', fecharSidebarMobile);
document.getElementById('sidebar-backdrop').addEventListener('click', fecharSidebarMobile);

function mudarAba(novaAba) {
  abaAtual = novaAba;

  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.aba === novaAba);
  });

  ['afazeres', 'semana', 'compras', 'concluidos', 'estatisticas', 'configuracoes'].forEach((aba) => {
    document.getElementById(`view-${aba}`).classList.toggle('oculto', novaAba !== aba);
  });

  const titulos = {
    afazeres: ['Afazeres', 'Tarefas pendentes da casa'],
    semana: ['Semana', 'Planejamento dos próximos dias'],
    compras: ['Lista de Compras', 'Compartilhada com todos da casa'],
    concluidos: ['Concluídos', 'Histórico de tarefas finalizadas'],
    estatisticas: ['Estatísticas', 'Indicadores de desempenho e divisão da casa'],
    configuracoes: ['Configurações', 'Gerencie moradores e cômodos da casa'],
  };

  document.getElementById('titulo-pagina').textContent = titulos[novaAba][0];
  document.getElementById('subtitulo-pagina').textContent = titulos[novaAba][1];

  if (novaAba === 'concluidos') {
    limiteConcluidos = 10;
    renderizarConcluidos();
  } else if (novaAba === 'estatisticas') {
    renderizarEstatisticas();
  } else if (novaAba === 'semana') {
    renderizarSemana();
  } else if (novaAba === 'compras') {
    renderizarCompras();
  }

  // O formulário de tarefa só aparece nas abas de tarefas
  if (novaAba !== 'afazeres' && novaAba !== 'semana') painelFormularioEl.classList.add('oculto');

  fecharSidebarMobile();
}

document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => mudarAba(btn.dataset.aba));
});

// =========================================================
// FORMULÁRIO RECOLHÍVEL (NOVA TAREFA / EDIÇÃO)
// =========================================================
function abrirFormulario(modoEdicao = false) {
  if (abaAtual !== 'afazeres' && abaAtual !== 'semana') {
    mudarAba('afazeres');
  }
  painelFormularioEl.classList.remove('oculto');
  if (!modoEdicao) {
    editandoId = null;
    tituloFormularioEl.textContent = 'Nova Tarefa';
    btnSubmitTarefaEl.textContent = 'Salvar Tarefa';
    btnCancelarEdicaoEl.classList.add('oculto');
  }
  inputTituloEl.focus();
}

function fecharFormulario() {
  painelFormularioEl.classList.add('oculto');
  resetarFormulario();
}

function resetarFormulario() {
  editandoId = null;
  inputTituloEl.value = '';
  inputDataEl.value = hojeISO();
  selectTurnoEl.value = 'Qualquer hora';
  selectRecorrenciaEl.value = 'unica';
  selectPontosEl.value = '1';
  inputObservacoesEl.value = '';
  checkRodizioEl.checked = false;
  diasSelecionados.clear();
  marcarChipsDias();
  atualizarCamposRecorrencia();
  tituloFormularioEl.textContent = 'Nova Tarefa';
  btnSubmitTarefaEl.textContent = 'Salvar Tarefa';
  btnCancelarEdicaoEl.classList.add('oculto');
}

function iniciarEdicaoTarefa(id) {
  const tarefa = tarefas.find((t) => t.id === id);
  if (!tarefa) return;

  editandoId = id;
  tituloFormularioEl.textContent = 'Editar Tarefa';
  btnSubmitTarefaEl.textContent = 'Atualizar Tarefa';
  btnCancelarEdicaoEl.classList.remove('oculto');

  inputTituloEl.value = tarefa.titulo;
  selectMembroEl.value = tarefa.membro_id ? String(tarefa.membro_id) : '';
  selectCategoriaEl.value = tarefa.categoria_id ? String(tarefa.categoria_id) : '';
  inputDataEl.value = tarefa.data_prevista;
  selectTurnoEl.value = tarefa.turno;
  selectRecorrenciaEl.value = tarefa.recorrencia || 'unica';
  selectPontosEl.value = String(tarefa.pontos || 1);
  inputObservacoesEl.value = tarefa.observacoes || '';
  checkRodizioEl.checked = !!tarefa.rodizio;
  diasSelecionados.clear();
  (tarefa.dias_semana || []).forEach((d) => diasSelecionados.add(d));
  marcarChipsDias();
  atualizarCamposRecorrencia();

  abrirFormulario(true);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function atualizarCamposRecorrencia() {
  const rec = selectRecorrenciaEl.value;
  blocoDiasSemanaEl.classList.toggle('oculto', rec !== 'dias_semana');
  blocoRodizioEl.classList.toggle('oculto', rec === 'unica');
}

function marcarChipsDias() {
  document.querySelectorAll('#chips-dias-semana .chip').forEach((chip) => {
    chip.classList.toggle('active', diasSelecionados.has(Number(chip.dataset.dia)));
  });
}

selectRecorrenciaEl.addEventListener('change', () => {
  if (selectRecorrenciaEl.value === 'dias_semana' && diasSelecionados.size === 0 && inputDataEl.value) {
    diasSelecionados.add(isoParaData(inputDataEl.value).getDay());
    marcarChipsDias();
  }
  atualizarCamposRecorrencia();
});

document.querySelectorAll('#chips-dias-semana .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    const dia = Number(chip.dataset.dia);
    if (diasSelecionados.has(dia)) diasSelecionados.delete(dia);
    else diasSelecionados.add(dia);
    marcarChipsDias();
  });
});

document.getElementById('btn-nova-tarefa').addEventListener('click', () => {
  if (painelFormularioEl.classList.contains('oculto')) {
    resetarFormulario();
    abrirFormulario(false);
  } else {
    fecharFormulario();
  }
});

document.getElementById('btn-fechar-form').addEventListener('click', fecharFormulario);
btnCancelarEdicaoEl.addEventListener('click', fecharFormulario);

// =========================================================
// LEITURA DO BANCO (SELECT + JOIN + VIEW)
// =========================================================
async function carregarMembros() {
  const { data, error } = await db
    .from('membros')
    .select('*')
    .order('nome', { ascending: true });

  if (error) throw error;
  membros = data;
  renderizarMembros();
}

async function carregarCategorias() {
  const { data, error } = await db
    .from('categorias')
    .select('*')
    .order('nome', { ascending: true });

  if (error) throw error;
  categorias = data;
  renderizarCategorias();
}

async function carregarPlacarSemanal() {
  const { data, error } = await db
    .from('placar_semanal')
    .select('*');

  if (!error && data) {
    placarSemanal = data;
    renderizarPlacarSemanal();
  }
}

async function carregarTarefas() {
  // Pendentes vêm com as subtarefas; o histórico de concluídas vem enxuto (sem joins),
  // e pessoa/cômodo são preenchidos aqui a partir das listas já carregadas.
  const [resPendentes, resConcluidas] = await Promise.all([
    db
      .from('tarefas')
      .select('*, subtarefas(id, titulo, feita)')
      .eq('concluida', false)
      .order('data_prevista', { ascending: true })
      .order('id', { ascending: false }),
    db
      .from('tarefas')
      .select('*')
      .eq('concluida', true)
      .order('concluida_em', { ascending: false, nullsFirst: false }),
  ]);

  if (resPendentes.error) throw resPendentes.error;
  if (resConcluidas.error) throw resConcluidas.error;

  const membroPorId = new Map(membros.map((m) => [m.id, m]));
  const categoriaPorId = new Map(categorias.map((c) => [c.id, c]));

  tarefas = [...resPendentes.data, ...resConcluidas.data].map((t) => ({
    ...t,
    responsavel: membroPorId.get(t.membro_id) || null,
    quem_concluiu: membroPorId.get(t.concluida_por) || null,
    categorias: categoriaPorId.get(t.categoria_id) || null,
    subtarefas: (t.subtarefas || []).sort((a, b) => a.id - b.id),
  }));

  atualizarContadoresGerais();
  renderizarFiltrosAfazeres();
  renderizarAfazeres();
  renderizarConcluidos();

  if (abaAtual === 'estatisticas') {
    renderizarEstatisticas();
  }
  renderizarSemana();
  notificarNovasAtribuicoes();
}

async function recarregarTudo() {
  await Promise.all([carregarMembros(), carregarCategorias()]);
  await Promise.all([carregarTarefas(), carregarPlacarSemanal(), carregarCompras()]);
  statusConexaoEl.textContent = 'PostgreSQL conectado';
  statusConexaoEl.style.color = '';
}

// =========================================================
// OPERAÇÕES CRUD NO SUPABASE
// =========================================================
document.getElementById('form-tarefa').addEventListener('submit', async (e) => {
  e.preventDefault();

  const titulo = inputTituloEl.value.trim();
  const membro_id = selectMembroEl.value ? Number(selectMembroEl.value) : null;
  const categoria_id = selectCategoriaEl.value ? Number(selectCategoriaEl.value) : null;
  const data_prevista = inputDataEl.value;
  const turno = selectTurnoEl.value;
  const recorrencia = selectRecorrenciaEl.value;
  const pontos = Number(selectPontosEl.value) || 1;
  const observacoes = inputObservacoesEl.value.trim() || null;
  const rodizio = recorrencia !== 'unica' && checkRodizioEl.checked;
  const dias_semana = recorrencia === 'dias_semana' ? [...diasSelecionados].sort() : null;

  if (recorrencia === 'dias_semana' && dias_semana.length === 0) {
    mostrarToast('Escolha pelo menos um dia da semana para a repetição.', 'erro');
    return;
  }

  const dadosTarefa = { titulo, membro_id, categoria_id, data_prevista, turno, recorrencia, pontos, observacoes, rodizio, dias_semana };

  if (!membro_id) {
    mostrarToast('Cadastre uma pessoa em Configurações primeiro.', 'erro');
    mudarAba('configuracoes');
    return;
  }

  const textoOriginal = btnSubmitTarefaEl.textContent;
  btnSubmitTarefaEl.disabled = true;
  btnSubmitTarefaEl.textContent = 'Salvando...';

  try {
    if (editandoId !== null) {
      const { error } = await db
        .from('tarefas')
        .update(dadosTarefa)
        .eq('id', editandoId);

      if (error) throw error;
      fecharFormulario();
      mostrarToast('✏️ Tarefa atualizada!');
    } else {
      const { error } = await db
        .from('tarefas')
        .insert([dadosTarefa]);

      if (error) throw error;
      inputTituloEl.value = '';
      inputObservacoesEl.value = '';
      mostrarToast('✅ Tarefa adicionada!');
    }

    await carregarTarefas();
  } catch (error) {
    mostrarToast('Erro ao salvar: ' + error.message, 'erro');
  } finally {
    btnSubmitTarefaEl.disabled = false;
    btnSubmitTarefaEl.textContent = editandoId !== null ? textoOriginal : 'Salvar Tarefa';
  }
});

async function alternarStatusTarefa(id) {
  const tarefa = tarefas.find((t) => t.id === id);
  if (!tarefa) return;

  const marcandoComoFeita = !tarefa.concluida;
  // Quem concluiu = a pessoa selecionada em "Quem está usando"; se ninguém foi escolhido, o responsável
  const quemConcluiuId = marcandoComoFeita
    ? (euId ? Number(euId) : (tarefa.membro_id || (membros[0] ? membros[0].id : null)))
    : null;

  const { error } = await db
    .from('tarefas')
    .update({
      concluida: marcandoComoFeita,
      concluida_em: marcandoComoFeita ? new Date().toISOString() : null,
      concluida_por: quemConcluiuId,
    })
    .eq('id', id);

  if (error) {
    mostrarToast('Erro ao atualizar status: ' + error.message, 'erro');
    return;
  }

  // recorrencia_gerada evita criar uma segunda repetição se a tarefa for desmarcada e marcada de novo
  if (marcandoComoFeita && ehRecorrente(tarefa) && !tarefa.recorrencia_gerada) {
    const proximaData = calcularProximaData(tarefa.data_prevista, tarefa.recorrencia, tarefa.dias_semana);
    const proximoResponsavel = tarefa.rodizio ? proximoMembroRodizio(tarefa.membro_id) : tarefa.membro_id;
    const { data: novaTarefa, error: erroRec } = await db
      .from('tarefas')
      .insert([{
        titulo: tarefa.titulo,
        membro_id: proximoResponsavel,
        categoria_id: tarefa.categoria_id,
        data_prevista: proximaData,
        turno: tarefa.turno,
        recorrencia: tarefa.recorrencia,
        dias_semana: tarefa.dias_semana,
        rodizio: tarefa.rodizio,
        pontos: tarefa.pontos,
        observacoes: tarefa.observacoes,
      }])
      .select()
      .single();

    if (!erroRec && novaTarefa && tarefa.subtarefas.length > 0) {
      const copiasSub = tarefa.subtarefas.map((s) => ({
        tarefa_id: novaTarefa.id,
        titulo: s.titulo,
        feita: false,
      }));
      await db.from('subtarefas').insert(copiasSub);
    }

    if (erroRec) {
      mostrarToast('Concluída, mas não foi possível agendar a repetição: ' + erroRec.message, 'erro');
    } else {
      await db.from('tarefas').update({ recorrencia_gerada: true }).eq('id', id);
      const proxNome = membros.find((m) => m.id === proximoResponsavel)?.nome;
      mostrarToast(
        tarefa.rodizio && proxNome
          ? `🔁 Concluída! Próxima vez é de ${proxNome} (${formatarDataBR(proximaData)}).`
          : `🔁 Concluída! Próxima repetição: ${formatarDataBR(proximaData)}.`
      );
    }
  } else {
    mostrarToast(marcandoComoFeita ? '🎉 Tarefa movida para Concluídos!' : '↩️ Tarefa reaberta nos Afazeres.');
  }

  await Promise.all([carregarTarefas(), carregarPlacarSemanal()]);
}

function abrirTrocaRapida(event, tarefaId) {
  event.stopPropagation();
  trocaRapidaTarefaId = trocaRapidaTarefaId === tarefaId ? null : tarefaId;
  renderizarAfazeres();
}

async function reatribuirTarefa(tarefaId, novoMembroId) {
  trocaRapidaTarefaId = null;
  const { error } = await db
    .from('tarefas')
    .update({ membro_id: novoMembroId })
    .eq('id', tarefaId);

  if (error) {
    mostrarToast('Erro ao reatribuir: ' + error.message, 'erro');
    return;
  }

  mostrarToast('👤 Responsável alterado!');
  await carregarTarefas();
}

// Subtarefas
function alternarCaixaSubtarefa(tarefaId) {
  if (caixasSubAberta.has(tarefaId)) {
    caixasSubAberta.delete(tarefaId);
  } else {
    caixasSubAberta.add(tarefaId);
  }
  renderizarAfazeres();
}

async function adicionarSubtarefa(event, tarefaId) {
  event.preventDefault();
  const input = document.getElementById(`input-sub-${tarefaId}`);
  const titulo = input.value.trim();
  if (!titulo) return;

  input.disabled = true;
  const { error } = await db.from('subtarefas').insert([{ tarefa_id: tarefaId, titulo }]);
  if (error) {
    mostrarToast('Erro ao adicionar etapa: ' + error.message, 'erro');
    input.disabled = false;
    return;
  }

  caixasSubAberta.add(tarefaId);
  await carregarTarefas();
}

async function alternarSubtarefa(subId, estadoAtual) {
  const { error } = await db.from('subtarefas').update({ feita: !estadoAtual }).eq('id', subId);
  if (error) {
    mostrarToast('Erro ao atualizar etapa: ' + error.message, 'erro');
    return;
  }
  await carregarTarefas();
}

async function excluirSubtarefa(subId) {
  const { error } = await db.from('subtarefas').delete().eq('id', subId);
  if (error) {
    mostrarToast('Erro ao excluir etapa: ' + error.message, 'erro');
    return;
  }
  await carregarTarefas();
}

// Excluir tarefa e limpar concluídas
async function excluirTarefa(id) {
  const tarefa = tarefas.find((t) => t.id === id);
  if (!tarefa) return;
  if (!confirm(`Excluir a tarefa "${tarefa.titulo}"? Essa ação não pode ser desfeita.`)) return;

  const { error } = await db.from('tarefas').delete().eq('id', id);
  if (error) {
    mostrarToast('Erro ao excluir tarefa: ' + error.message, 'erro');
    return;
  }
  if (editandoId === id) fecharFormulario();
  mostrarToast('🗑️ Tarefa removida.');
  await Promise.all([carregarTarefas(), carregarPlacarSemanal()]);
}

document.getElementById('btn-limpar-feitas').addEventListener('click', async () => {
  const qtd = tarefas.filter((t) => t.concluida).length;
  if (qtd === 0) return;
  if (!confirm(`Apagar permanentemente todas as ${qtd} tarefa(s) concluída(s)?`)) return;

  const { error } = await db.from('tarefas').delete().eq('concluida', true);
  if (error) {
    mostrarToast('Erro ao limpar histórico: ' + error.message, 'erro');
    return;
  }
  mostrarToast('🧹 Histórico de concluídos limpo.');
  await Promise.all([carregarTarefas(), carregarPlacarSemanal()]);
});

// Configurações: Pessoas e Cômodos
document.getElementById('form-membro').addEventListener('submit', async (e) => {
  e.preventDefault();
  const inputNome = document.getElementById('input-nome-membro');
  const btn = document.getElementById('btn-submit-membro');
  const nome = inputNome.value.trim();
  const cor = document.getElementById('input-cor-membro').value;
  const inputEmail = document.getElementById('input-email-membro');
  const email = inputEmail.value.trim().toLowerCase() || null;
  if (!nome) return;

  btn.disabled = true;
  try {
    const { error } = await db.from('membros').insert([{ nome, cor, email }]);
    if (error) throw error;
    inputNome.value = '';
    inputEmail.value = '';
    mostrarToast(`👤 ${nome} adicionado(a) à casa!`);
    await Promise.all([carregarMembros(), carregarPlacarSemanal()]);
  } catch (err) {
    mostrarToast('Erro ao adicionar pessoa: ' + err.message, 'erro');
  } finally {
    btn.disabled = false;
  }
});

async function editarEmailMembro(id) {
  const membro = membros.find((m) => m.id === id);
  if (!membro) return;
  const resposta = prompt(`E-mail de login de ${membro.nome} (deixe vazio para desvincular):`, membro.email || '');
  if (resposta === null) return;

  const email = resposta.trim().toLowerCase() || null;
  const { error } = await db.from('membros').update({ email }).eq('id', id);
  if (error) {
    mostrarToast('Erro ao salvar e-mail: ' + error.message, 'erro');
    return;
  }
  mostrarToast(email ? `✉️ E-mail vinculado a ${membro.nome}.` : 'E-mail desvinculado.');
  await carregarMembros();
}

async function excluirMembro(id) {
  const membro = membros.find((m) => m.id === id);
  if (!membro) return;
  if (!confirm(`Remover "${membro.nome}" da casa?`)) return;

  const { error } = await db.from('membros').delete().eq('id', id);
  if (error) {
    mostrarToast('Erro ao remover pessoa: ' + error.message, 'erro');
    return;
  }

  if (filtroPessoaAfazeres === String(id)) filtroPessoaAfazeres = 'todos';
  if (filtroPessoaConcluidos === String(id)) filtroPessoaConcluidos = 'todos';
  mostrarToast(`Pessoa removida.`);
  await recarregarTudo();
}

document.getElementById('form-categoria').addEventListener('submit', async (e) => {
  e.preventDefault();
  const inputIcone = document.getElementById('input-icone-categoria');
  const inputNome = document.getElementById('input-nome-categoria');
  const btn = document.getElementById('btn-submit-categoria');
  const icone = inputIcone.value.trim() || '🏠';
  const nome = inputNome.value.trim();
  if (!nome) return;

  btn.disabled = true;
  try {
    const { error } = await db.from('categorias').insert([{ nome, icone }]);
    if (error) throw error;
    inputNome.value = '';
    mostrarToast(`${icone} Cômodo "${nome}" adicionado!`);
    await carregarCategorias();
    renderizarFiltrosAfazeres();
  } catch (err) {
    mostrarToast('Erro ao adicionar cômodo: ' + err.message, 'erro');
  } finally {
    btn.disabled = false;
  }
});

async function excluirCategoria(id) {
  const cat = categorias.find((c) => c.id === id);
  if (!cat) return;
  if (!confirm(`Remover o cômodo "${cat.nome}"?`)) return;

  const { error } = await db.from('categorias').delete().eq('id', id);
  if (error) {
    mostrarToast('Erro ao remover cômodo: ' + error.message, 'erro');
    return;
  }

  if (filtroCatAfazeres === String(id)) filtroCatAfazeres = 'todas';
  if (filtroCatConcluidos === String(id)) filtroCatConcluidos = 'todas';
  mostrarToast('Cômodo removido.');
  await Promise.all([carregarCategorias(), carregarTarefas()]);
}

// =========================================================
// RENDERIZAÇÃO: CONFIGURAÇÕES E CONTADORES
// =========================================================
function renderizarMembros() {
  selectMembroEl.innerHTML = membros.length === 0
    ? '<option value="">Cadastre uma pessoa em Configurações</option>'
    : membros.map((m) => `<option value="${m.id}">${escaparHTML(m.nome)}</option>`).join('');

  const filtroPessoaConcEl = document.getElementById('filtro-pessoa-concluidos');
  filtroPessoaConcEl.innerHTML =
    '<option value="todos">Todas as pessoas</option>' +
    membros.map((m) => `<option value="${m.id}">${escaparHTML(m.nome)}</option>`).join('');
  filtroPessoaConcEl.value = filtroPessoaConcluidos;

  renderizarSeletorQuemSou();

  const listaConfigEl = document.getElementById('lista-membros-config');
  if (membros.length === 0) {
    listaConfigEl.innerHTML = '<p class="texto-suave">Nenhuma pessoa cadastrada.</p>';
    return;
  }

  listaConfigEl.innerHTML = membros.map((m) => {
    const inicial = escaparHTML(m.nome.trim().charAt(0).toUpperCase() || '?');
    return `
      <div class="item-config-row">
        <div class="item-config-info">
          <span class="avatar-config" style="background:${corSegura(m.cor)}">${inicial}</span>
          <span>
            ${escaparHTML(m.nome)}
            <span class="item-config-email">${m.email ? '✉️ ' + escaparHTML(m.email) : 'sem e-mail vinculado'}</span>
          </span>
        </div>
        <div class="item-config-botoes">
          <button type="button" class="btn-secondary btn-mini" onclick="editarEmailMembro(${m.id})" title="Vincular e-mail de login">✉️</button>
          <button type="button" class="btn-danger-soft" onclick="excluirMembro(${m.id})">Remover</button>
        </div>
      </div>
    `;
  }).join('');
}

// =========================================================
// "QUEM ESTÁ USANDO" (define quem aparece como autor ao concluir)
// =========================================================
function renderizarSeletorQuemSou() {
  // Se algum morador tiver o mesmo e-mail do login, ele é selecionado automaticamente
  const emailLogado = sessaoAtual?.user?.email?.toLowerCase();
  const membroDoEmail = emailLogado
    ? membros.find((m) => (m.email || '').toLowerCase() === emailLogado)
    : null;

  if (membroDoEmail) {
    definirEu(String(membroDoEmail.id));
  } else if (euId && !membros.some((m) => String(m.id) === euId)) {
    definirEu('');
  }

  const selectEl = document.getElementById('select-quem-sou');
  selectEl.innerHTML =
    '<option value="">Selecione...</option>' +
    membros.map((m) => `<option value="${m.id}">${escaparHTML(m.nome)}</option>`).join('');
  selectEl.value = euId;
}

function definirEu(id) {
  euId = id;
  if (id) localStorage.setItem('quem-sou-eu', id);
  else localStorage.removeItem('quem-sou-eu');
}

document.getElementById('select-quem-sou').addEventListener('change', (e) => {
  definirEu(e.target.value);
  const membro = membros.find((m) => String(m.id) === euId);
  if (membro) mostrarToast(`👋 Olá, ${membro.nome}! Suas conclusões ficam no seu nome.`);
});

function renderizarCategorias() {
  selectCategoriaEl.innerHTML =
    '<option value="">Sem cômodo</option>' +
    categorias.map((c) => `<option value="${c.id}">${escaparHTML(c.icone)} ${escaparHTML(c.nome)}</option>`).join('');

  const filtroCatConcEl = document.getElementById('filtro-cat-concluidos');
  filtroCatConcEl.innerHTML =
    '<option value="todas">Todos os cômodos</option>' +
    categorias.map((c) => `<option value="${c.id}">${escaparHTML(c.icone)} ${escaparHTML(c.nome)}</option>`).join('');
  filtroCatConcEl.value = filtroCatConcluidos;

  const listaConfigEl = document.getElementById('lista-categorias-config');
  if (categorias.length === 0) {
    listaConfigEl.innerHTML = '<p class="texto-suave">Nenhum cômodo cadastrado.</p>';
    return;
  }

  listaConfigEl.innerHTML = categorias.map((c) => `
    <div class="item-config-row">
      <div class="item-config-info">
        <span class="icone-comodo-box">${escaparHTML(c.icone)}</span>
        <span>${escaparHTML(c.nome)}</span>
      </div>
      <button type="button" class="btn-danger-soft" onclick="excluirCategoria(${c.id})">Remover</button>
    </div>
  `).join('');
}

function atualizarContadoresGerais() {
  const pendentes = tarefas.filter((t) => !t.concluida);
  const concluidas = tarefas.filter((t) => t.concluida);
  const total = tarefas.length;
  const pct = total === 0 ? 0 : Math.round((concluidas.length / total) * 100);

  document.getElementById('badge-qtd-afazeres').textContent = pendentes.length;
  document.getElementById('badge-qtd-concluidos').textContent = concluidas.length;

  document.getElementById('texto-progresso').textContent = `${concluidas.length} de ${total} concluídas`;
  document.getElementById('pct-pill').textContent = `${pct}%`;
  document.getElementById('barra-preenchimento').style.width = `${pct}%`;

  const qtdAtrasadas = pendentes.filter(tarefaEstaAtrasada).length;
  const chipAtrasadas = document.getElementById('chip-atrasadas');
  if (qtdAtrasadas > 0) {
    chipAtrasadas.classList.remove('oculto');
    chipAtrasadas.textContent = `Atrasadas (${qtdAtrasadas})`;
  } else {
    chipAtrasadas.classList.add('oculto');
    if (filtroStatusAfazeres === 'atrasadas') {
      filtroStatusAfazeres = 'todos';
      document.querySelectorAll('#filtros-status-afazeres .chip').forEach((b) => b.classList.remove('active'));
      document.querySelector('#filtros-status-afazeres .chip[data-status="todos"]').classList.add('active');
    }
  }
}

function renderizarPlacarSemanal() {
  const blocoEl = document.getElementById('bloco-placar');
  const listaEl = document.getElementById('lista-placar');
  const ativos = placarSemanal.filter((p) => p.total_concluidas > 0);

  if (ativos.length === 0) {
    blocoEl.classList.add('oculto');
    return;
  }

  blocoEl.classList.remove('oculto');
  listaEl.innerHTML = ativos.map((p, idx) => `
    <span class="placar-badge">
      <span class="placar-bolinha" style="background:${corSegura(p.cor)}"></span>
      <span>${idx === 0 ? '🥇 ' : ''}${escaparHTML(p.nome)}: <strong>${p.total_pontos ?? p.total_concluidas} pt${(p.total_pontos ?? p.total_concluidas) > 1 ? 's' : ''}</strong> <span class="texto-suave">(${p.total_concluidas} tarefa${p.total_concluidas > 1 ? 's' : ''})</span></span>
    </span>
  `).join('');
}

// =========================================================
// RENDERIZAÇÃO: ABA 1 (AFAZERES PENDENTES)
// =========================================================
function renderizarFiltrosAfazeres() {
  const pendentes = tarefas.filter((t) => !t.concluida);
  const pessoasContainer = document.getElementById('filtros-pessoas-afazeres');

  let htmlPessoas = `
    <button type="button" class="pill-filtro pill-filtro-pessoa ${filtroPessoaAfazeres === 'todos' ? 'active' : ''}" onclick="selecionarPessoaAfazeres('todos')">
      <span class="avatar-inicial" style="background:#64748b">🏠</span>
      <span>Todos</span>
      <span class="contador-pill">${pendentes.length}</span>
    </button>
  `;

  htmlPessoas += membros.map((m) => {
    const qtd = pendentes.filter((t) => String(t.membro_id) === String(m.id)).length;
    const inicial = escaparHTML(m.nome.trim().charAt(0).toUpperCase() || '?');
    return `
      <button type="button" class="pill-filtro pill-filtro-pessoa ${filtroPessoaAfazeres === String(m.id) ? 'active' : ''}" onclick="selecionarPessoaAfazeres('${m.id}')">
        <span class="avatar-inicial" style="background:${corSegura(m.cor)}">${inicial}</span>
        <span>${escaparHTML(m.nome)}</span>
        <span class="contador-pill">${qtd}</span>
      </button>
    `;
  }).join('');

  pessoasContainer.innerHTML = htmlPessoas;

  const catContainer = document.getElementById('filtros-categorias-afazeres');
  let htmlCats = `
    <button type="button" class="pill-filtro ${filtroCatAfazeres === 'todas' ? 'active' : ''}" onclick="selecionarCatAfazeres('todas')">
      <span>✨ Todos</span>
    </button>
  `;

  htmlCats += categorias.map((c) => `
    <button type="button" class="pill-filtro ${filtroCatAfazeres === String(c.id) ? 'active' : ''}" onclick="selecionarCatAfazeres('${c.id}')">
      <span>${escaparHTML(c.icone)} ${escaparHTML(c.nome)}</span>
    </button>
  `).join('');

  catContainer.innerHTML = htmlCats;
}

function selecionarPessoaAfazeres(id) {
  filtroPessoaAfazeres = id;
  renderizarFiltrosAfazeres();
  renderizarAfazeres();
}

function selecionarCatAfazeres(id) {
  filtroCatAfazeres = id;
  renderizarFiltrosAfazeres();
  renderizarAfazeres();
}

function formatarDataBR(dataISO) {
  if (dataISO === hojeISO()) return 'Hoje';
  const [ano, mes, dia] = dataISO.split('-');
  return `${dia}/${mes}`;
}

function obterBadgeTurno(turno) {
  if (turno === 'Manhã') return '<span class="badge-info turno-manha">☀️ Manhã</span>';
  if (turno === 'Tarde') return '<span class="badge-info turno-tarde">🌤️ Tarde</span>';
  if (turno === 'Noite') return '<span class="badge-info turno-noite">🌙 Noite</span>';
  return '<span class="badge-info">🕒 Qualquer hora</span>';
}

function renderizarAfazeres() {
  const container = document.getElementById('lista-afazeres');
  const pendentes = tarefas.filter((t) => {
    if (t.concluida) return false;
    if (filtroStatusAfazeres === 'hoje' && t.data_prevista !== hojeISO()) return false;
    if (filtroStatusAfazeres === 'atrasadas' && !tarefaEstaAtrasada(t)) return false;
    if (filtroPessoaAfazeres !== 'todos' && String(t.membro_id) !== filtroPessoaAfazeres) return false;
    if (filtroCatAfazeres !== 'todas' && String(t.categoria_id) !== filtroCatAfazeres) return false;
    if (buscaAfazeres && !t.titulo.toLowerCase().includes(buscaAfazeres)) return false;
    return true;
  });

  if (pendentes.length === 0) {
    container.innerHTML = '<p class="vazio card">Nenhum afazer pendente neste filtro. 🎉</p>';
    return;
  }

  container.innerHTML = pendentes.map((t) => {
    const pessoaNome = t.responsavel ? escaparHTML(t.responsavel.nome) : 'Sem responsável';
    const pessoaCor = corSegura(t.responsavel?.cor);
    const atrasada = tarefaEstaAtrasada(t);
    const catBadge = t.categorias
      ? `<span class="badge-info">${escaparHTML(t.categorias.icone)} ${escaparHTML(t.categorias.nome)}</span>`
      : '';
    const recBadge = ehRecorrente(t)
      ? `<span class="badge-info badge-recorrencia">${escaparHTML(descreverRecorrencia(t))}${t.rodizio ? ' · ⚖️ Rodízio' : ''}</span>`
      : '';
    const pontosBadge = `<span class="badge-info badge-pontos">⭐ ${t.pontos || 1} pt${(t.pontos || 1) > 1 ? 's' : ''}</span>`;
    const obsHTML = t.observacoes ? `<div class="tarefa-obs">📝 ${escaparHTML(t.observacoes)}</div>` : '';

    const subs = t.subtarefas || [];
    const subsFeitas = subs.filter((s) => s.feita).length;
    const mostrarSubBox = subs.length > 0 || caixasSubAberta.has(t.id);

    const trocaRapidaHTML = trocaRapidaTarefaId === t.id
      ? `
        <div class="troca-rapida-box">
          <span class="troca-rapida-label">Passar para:</span>
          ${membros.map((m) => `
            <button type="button" class="btn-troca-opcao" onclick="reatribuirTarefa(${t.id}, ${m.id})">
              <span class="placar-bolinha" style="background:${corSegura(m.cor)}"></span>
              <span>${escaparHTML(m.nome)}</span>
            </button>
          `).join('')}
        </div>
      `
      : '';

    const subtarefasHTML = mostrarSubBox
      ? `
        <div class="subtarefas-container">
          <div class="subtarefas-header">
            <span>Etapas da tarefa</span>
            <span>${subsFeitas}/${subs.length}</span>
          </div>
          ${subs.length > 0 ? `
            <div class="lista-subtarefas">
              ${subs.map((s) => `
                <div class="subtarefa-item ${s.feita ? 'feita' : ''}">
                  <label class="subtarefa-esquerda">
                    <input type="checkbox" ${s.feita ? 'checked' : ''} onchange="alternarSubtarefa(${s.id}, ${s.feita})" />
                    <span>${escaparHTML(s.titulo)}</span>
                  </label>
                  <button type="button" class="btn-del-sub" onclick="excluirSubtarefa(${s.id})">×</button>
                </div>
              `).join('')}
            </div>
          ` : ''}
          <form class="form-nova-sub" onsubmit="adicionarSubtarefa(event, ${t.id})">
            <input type="text" id="input-sub-${t.id}" placeholder="Adicionar etapa..." required />
            <button type="submit" class="btn-secondary">+ Etapa</button>
          </form>
        </div>
      `
      : '';

    return `
      <div class="tarefa-item ${atrasada ? 'atrasada' : ''}" style="border-left-color:${pessoaCor}">
        <div class="tarefa-principal">
          <div class="tarefa-esquerda">
            <input
              type="checkbox"
              class="check-tarefa"
              onchange="alternarStatusTarefa(${t.id})"
              title="Concluir tarefa"
            />
            <div class="tarefa-conteudo">
              <span class="tarefa-titulo">${escaparHTML(t.titulo)}</span>
              <div class="tarefa-meta">
                <button type="button" class="btn-pill-pessoa" style="background:${pessoaCor}" onclick="abrirTrocaRapida(event, ${t.id})">
                  ${pessoaNome} ▾
                </button>
                ${catBadge}
                ${atrasada ? '<span class="badge-atrasada">⚠️ Atrasada</span>' : ''}
                <span class="badge-info">📅 ${formatarDataBR(t.data_prevista)}</span>
                ${obterBadgeTurno(t.turno)}
                ${recBadge}
                ${pontosBadge}
              </div>
              ${obsHTML}
            </div>
          </div>

          <div class="tarefa-acoes">
            <button type="button" class="btn-acao" onclick="alternarCaixaSubtarefa(${t.id})" title="Checklist">☑️${subs.length > 0 ? subs.length : ''}</button>
            <button type="button" class="btn-acao" onclick="iniciarEdicaoTarefa(${t.id})" title="Editar">✏️</button>
            <button type="button" class="btn-acao btn-excluir" onclick="excluirTarefa(${t.id})" title="Excluir">🗑️</button>
          </div>
        </div>
        ${trocaRapidaHTML}
        ${subtarefasHTML}
      </div>
    `;
  }).join('');
}

// =========================================================
// RENDERIZAÇÃO: ABA 2 (CONCLUÍDOS - ATÉ 10 RECENTES + FILTROS)
// =========================================================
function renderizarConcluidos() {
  const container = document.getElementById('lista-concluidos');
  const infoEl = document.getElementById('info-contagem-concluidos');
  const btnLimpar = document.getElementById('btn-limpar-feitas');
  const boxMais = document.getElementById('box-carregar-mais');

  const todasConcluidas = tarefas
    .filter((t) => t.concluida)
    .sort((a, b) => {
      const dataA = a.concluida_em ? new Date(a.concluida_em).getTime() : 0;
      const dataB = b.concluida_em ? new Date(b.concluida_em).getTime() : 0;
      return dataB - dataA || b.id - a.id;
    });

  btnLimpar.classList.toggle('oculto', todasConcluidas.length === 0);

  const temFiltroAtivo =
    buscaConcluidos !== '' ||
    filtroCatConcluidos !== 'todas' ||
    filtroPessoaConcluidos !== 'todos';

  const filtradas = todasConcluidas.filter((t) => {
    if (buscaConcluidos && !t.titulo.toLowerCase().includes(buscaConcluidos)) return false;
    if (filtroCatConcluidos !== 'todas' && String(t.categoria_id) !== filtroCatConcluidos) return false;
    const autorId = t.concluida_por || t.membro_id;
    if (filtroPessoaConcluidos !== 'todos' && String(autorId) !== filtroPessoaConcluidos) return false;
    return true;
  });

  const exibidas = temFiltroAtivo ? filtradas : filtradas.slice(0, limiteConcluidos);

  if (todasConcluidas.length === 0) {
    infoEl.textContent = 'Nenhuma tarefa concluída ainda';
    boxMais.classList.add('oculto');
    container.innerHTML = '<p class="vazio card">Quando você marcar uma tarefa como feita, ela aparecerá aqui.</p>';
    return;
  }

  if (temFiltroAtivo) {
    infoEl.textContent = `Filtro ativo: ${filtradas.length} tarefa(s) encontrada(s) no histórico`;
    boxMais.classList.add('oculto');
  } else {
    infoEl.textContent = `Mostrando ${exibidas.length} de ${todasConcluidas.length} concluída(s) (mais recentes)`;
    boxMais.classList.toggle('oculto', exibidas.length >= filtradas.length);
  }

  if (exibidas.length === 0) {
    container.innerHTML = '<p class="vazio card">Nenhuma tarefa concluída encontrada com esses filtros.</p>';
    return;
  }

  container.innerHTML = exibidas.map((t) => {
    const executor = t.quem_concluiu || t.responsavel;
    const executorNome = executor ? escaparHTML(executor.nome) : 'Sem responsável';
    const catBadge = t.categorias
      ? `<span class="badge-info">${escaparHTML(t.categorias.icone)} ${escaparHTML(t.categorias.nome)}</span>`
      : '';

    return `
      <div class="tarefa-item concluida">
        <div class="tarefa-principal">
          <div class="tarefa-esquerda">
            <input
              type="checkbox"
              class="check-tarefa"
              checked
              onchange="alternarStatusTarefa(${t.id})"
              title="Desmarcar e voltar para Afazeres"
            />
            <div class="tarefa-conteudo">
              <span class="tarefa-titulo">${escaparHTML(t.titulo)}</span>
              <div class="tarefa-meta">
                <span class="badge-feito-por">✅ Feito por ${executorNome}</span>
                ${catBadge}
                <span class="badge-info">🕒 ${formatarDataHoraConclusao(t.concluida_em)}</span>
                <span class="badge-info badge-pontos">⭐ ${t.pontos || 1}</span>
              </div>
            </div>
          </div>

          <div class="tarefa-acoes">
            <button type="button" class="btn-acao btn-excluir" onclick="excluirTarefa(${t.id})" title="Excluir do histórico">🗑️</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

document.getElementById('btn-carregar-mais').addEventListener('click', () => {
  limiteConcluidos += 10;
  renderizarConcluidos();
});

// =========================================================
// RENDERIZAÇÃO: ABA 3 (ESTATÍSTICAS E GRÁFICOS)
// =========================================================
function renderizarEstatisticas() {
  const total = tarefas.length;
  const concluidas = tarefas.filter((t) => t.concluida);
  const pendentes = tarefas.filter((t) => !t.concluida);
  const atrasadas = pendentes.filter(tarefaEstaAtrasada);
  const emDia = pendentes.filter((t) => !tarefaEstaAtrasada(t));
  const paraHoje = pendentes.filter((t) => t.data_prevista === hojeISO());

  // Últimos 7 dias (datas locais)
  const ultimos7Dias = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const iso = d.toLocaleDateString('en-CA');
    const [, mes, dia] = iso.split('-');
    ultimos7Dias.push({ iso, label: `${dia}/${mes}`, qtd: 0 });
  }

  concluidas.forEach((t) => {
    if (!t.concluida_em) return;
    const dataConcISO = new Date(t.concluida_em).toLocaleDateString('en-CA');
    const diaEncontrado = ultimos7Dias.find((d) => d.iso === dataConcISO);
    if (diaEncontrado) diaEncontrado.qtd += 1;
  });

  const totalSemana = ultimos7Dias.reduce((acc, d) => acc + d.qtd, 0);
  const taxaPct = total === 0 ? 0 : Math.round((concluidas.length / total) * 100);

  // Atualiza os 4 cartões KPI
  document.getElementById('kpi-pendentes').textContent = pendentes.length;
  document.getElementById('kpi-pendentes-sub').textContent = `${paraHoje.length} agendada(s) para hoje`;

  document.getElementById('kpi-concluidas').textContent = concluidas.length;
  document.getElementById('kpi-concluidas-sub').textContent = `${taxaPct}% do total registrado`;

  document.getElementById('kpi-atrasadas').textContent = atrasadas.length;
  document.getElementById('kpi-atrasadas-sub').textContent =
    atrasadas.length === 0 ? 'Tudo em dia!' : 'Precisam de atenção';

  document.getElementById('kpi-semana').textContent = totalSemana;
  document.getElementById('kpi-semana-sub').textContent = 'Entregues nos últimos 7 dias';

  // Renderiza progresso por cômodo
  renderizarProgressoComodos();

  // Renderiza gráficos Chart.js
  if (typeof Chart === 'undefined') return;

  const escuro = document.body.classList.contains('dark');
  const corTexto = escuro ? '#cbd5e1' : '#475569';
  const corGrade = escuro ? 'rgba(148, 163, 184, 0.14)' : 'rgba(15, 23, 42, 0.08)';
  const corBordaCard = escuro ? '#162032' : '#ffffff';

  // 1. Gráfico Rosca: Status Geral
  if (chartStatus) chartStatus.destroy();
  const ctxStatus = document.getElementById('chart-status').getContext('2d');
  const temDadosStatus = total > 0;

  chartStatus = new Chart(ctxStatus, {
    type: 'doughnut',
    data: {
      labels: temDadosStatus ? ['Concluídas', 'Em dia (A fazer)', 'Atrasadas'] : ['Sem tarefas'],
      datasets: [{
        data: temDadosStatus ? [concluidas.length, emDia.length, atrasadas.length] : [1],
        backgroundColor: temDadosStatus ? ['#10b981', '#6366f1', '#ef4444'] : ['#94a3b8'],
        borderColor: corBordaCard,
        borderWidth: 3,
        hoverOffset: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '66%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: corTexto, usePointStyle: true, padding: 14, font: { weight: '600' } },
        },
        tooltip: { enabled: temDadosStatus },
      },
    },
  });

  // 2. Gráfico Barras Empilhadas: Divisão por Pessoa
  if (chartPessoas) chartPessoas.destroy();
  const ctxPessoas = document.getElementById('chart-pessoas').getContext('2d');
  const nomesPessoas = membros.map((m) => m.nome);
  const feitasPorPessoa = membros.map((m) =>
    concluidas.filter((t) => String(t.concluida_por || t.membro_id) === String(m.id)).length
  );
  const pendentesPorPessoa = membros.map((m) =>
    pendentes.filter((t) => String(t.membro_id) === String(m.id)).length
  );

  chartPessoas = new Chart(ctxPessoas, {
    type: 'bar',
    data: {
      labels: nomesPessoas.length > 0 ? nomesPessoas : ['Sem pessoas'],
      datasets: [
        {
          label: 'Concluídas',
          data: feitasPorPessoa,
          backgroundColor: '#10b981',
          borderRadius: 6,
        },
        {
          label: 'A fazer',
          data: pendentesPorPessoa,
          backgroundColor: '#6366f1',
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          stacked: true,
          ticks: { color: corTexto, font: { weight: '600' } },
          grid: { display: false },
        },
        y: {
          stacked: true,
          beginAtZero: true,
          ticks: { color: corTexto, precision: 0 },
          grid: { color: corGrade },
        },
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: corTexto, usePointStyle: true, padding: 14, font: { weight: '600' } },
        },
      },
    },
  });

  // 3. Gráfico de Barras: Ritmo dos Últimos 7 Dias
  if (chartSemana) chartSemana.destroy();
  const ctxSemana = document.getElementById('chart-semana').getContext('2d');

  chartSemana = new Chart(ctxSemana, {
    type: 'bar',
    data: {
      labels: ultimos7Dias.map((d) => d.label),
      datasets: [{
        label: 'Tarefas concluídas',
        data: ultimos7Dias.map((d) => d.qtd),
        backgroundColor: '#8b5cf6',
        borderRadius: 8,
        maxBarThickness: 32,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          ticks: { color: corTexto, font: { weight: '600' } },
          grid: { display: false },
        },
        y: {
          beginAtZero: true,
          ticks: { color: corTexto, precision: 0 },
          grid: { color: corGrade },
        },
      },
      plugins: {
        legend: { display: false },
      },
    },
  });
}

function renderizarProgressoComodos() {
  const container = document.getElementById('lista-progresso-comodos');
  const grupos = categorias.map((c) => {
    const doComodo = tarefas.filter((t) => String(t.categoria_id) === String(c.id));
    const feitas = doComodo.filter((t) => t.concluida).length;
    return {
      nome: `${c.icone} ${c.nome}`,
      total: doComodo.length,
      feitas,
    };
  });

  const semComodo = tarefas.filter((t) => !t.categoria_id);
  if (semComodo.length > 0) {
    grupos.push({
      nome: '📌 Sem cômodo',
      total: semComodo.length,
      feitas: semComodo.filter((t) => t.concluida).length,
    });
  }

  const ativos = grupos.filter((g) => g.total > 0).sort((a, b) => b.total - a.total);

  if (ativos.length === 0) {
    container.innerHTML = '<p class="texto-suave">Cadastre tarefas associadas aos cômodos para ver o detalhamento.</p>';
    return;
  }

  container.innerHTML = ativos.map((g) => {
    const pct = Math.round((g.feitas / g.total) * 100);
    return `
      <div class="comodo-stat-item">
        <div class="comodo-stat-topo">
          <span>${escaparHTML(g.nome)}</span>
          <span class="comodo-stat-numeros">${g.feitas}/${g.total} (${pct}%)</span>
        </div>
        <div class="comodo-barra-fundo">
          <div class="comodo-barra-fill" style="width:${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');
}

// =========================================================
// ABA SEMANA (7 DIAS EM COLUNAS, COM ARRASTAR E SOLTAR)
// =========================================================
function renderizarSemana() {
  const grade = document.getElementById('grade-semana');
  if (!grade) return;

  const hoje = hojeISO();
  const inicio = somarDias(hoje, offsetSemana * 7);
  const pendentes = tarefas.filter((t) => !t.concluida);

  document.getElementById('btn-semana-hoje').classList.toggle('active', offsetSemana === 0);

  const colunas = [];
  for (let i = 0; i < 7; i++) {
    const iso = somarDias(inicio, i);
    const data = isoParaData(iso);
    const [, mes, dia] = iso.split('-');

    // Na coluna de hoje entram também as tarefas atrasadas
    const doDia = pendentes
      .filter((t) => t.data_prevista === iso || (iso === hoje && t.data_prevista < hoje))
      .sort((a, b) => a.data_prevista.localeCompare(b.data_prevista));

    const cards = doDia.map((t) => {
      const cor = corSegura(t.responsavel?.cor);
      const atrasada = tarefaEstaAtrasada(t);
      return `
        <div class="mini-tarefa ${atrasada ? 'atrasada' : ''}" style="border-left-color:${cor}"
             draggable="true" ondragstart="iniciarArraste(event, ${t.id})">
          <span class="mini-tarefa-titulo" onclick="iniciarEdicaoTarefa(${t.id})" title="Editar">
            ${atrasada ? '⚠️ ' : ''}${escaparHTML(t.titulo)}
          </span>
          <div class="mini-tarefa-rodape">
            <span>${t.responsavel ? escaparHTML(t.responsavel.nome) : '—'} · ⭐${t.pontos || 1}</span>
            <span class="mini-setas">
              <button type="button" onclick="moverTarefaDias(${t.id}, -1)" title="Dia anterior">◀</button>
              <button type="button" onclick="moverTarefaDias(${t.id}, 1)" title="Próximo dia">▶</button>
            </span>
          </div>
        </div>
      `;
    }).join('');

    colunas.push(`
      <div class="coluna-dia ${iso === hoje ? 'hoje' : ''}"
           ondragover="permitirSoltar(event)" ondragleave="sairDaColuna(event)" ondrop="soltarNoDia(event, '${iso}')">
        <div class="coluna-dia-topo">
          <span>${iso === hoje ? 'Hoje' : NOMES_DIAS[data.getDay()]}</span>
          <span>${dia}/${mes} · ${doDia.length}</span>
        </div>
        ${cards || '<div class="coluna-vazia">Livre ✨</div>'}
      </div>
    `);
  }

  grade.innerHTML = colunas.join('');
}

function iniciarArraste(event, tarefaId) {
  event.dataTransfer.setData('text/plain', String(tarefaId));
  event.dataTransfer.effectAllowed = 'move';
}

function permitirSoltar(event) {
  event.preventDefault();
  event.currentTarget.classList.add('arrastando-sobre');
}

function sairDaColuna(event) {
  event.currentTarget.classList.remove('arrastando-sobre');
}

async function soltarNoDia(event, iso) {
  event.preventDefault();
  event.currentTarget.classList.remove('arrastando-sobre');
  const id = Number(event.dataTransfer.getData('text/plain'));
  if (id) await moverTarefaParaData(id, iso);
}

async function moverTarefaDias(tarefaId, dias) {
  const tarefa = tarefas.find((t) => t.id === tarefaId);
  if (!tarefa) return;
  const base = tarefa.data_prevista < hojeISO() ? hojeISO() : tarefa.data_prevista;
  await moverTarefaParaData(tarefaId, somarDias(base, dias));
}

async function moverTarefaParaData(tarefaId, iso) {
  const tarefa = tarefas.find((t) => t.id === tarefaId);
  if (!tarefa || tarefa.data_prevista === iso) return;

  const anterior = tarefa.data_prevista;
  tarefa.data_prevista = iso; // atualiza na tela na hora
  renderizarSemana();

  const { error } = await db.from('tarefas').update({ data_prevista: iso }).eq('id', tarefaId);
  if (error) {
    tarefa.data_prevista = anterior;
    renderizarSemana();
    mostrarToast('Erro ao mover tarefa: ' + error.message, 'erro');
    return;
  }
  mostrarToast(`📅 "${tarefa.titulo}" movida para ${formatarDataBR(iso)}.`);
  await carregarTarefas();
}

document.getElementById('btn-semana-anterior').addEventListener('click', () => { offsetSemana -= 1; renderizarSemana(); });
document.getElementById('btn-semana-proxima').addEventListener('click', () => { offsetSemana += 1; renderizarSemana(); });
document.getElementById('btn-semana-hoje').addEventListener('click', () => { offsetSemana = 0; renderizarSemana(); });

// =========================================================
// ABA COMPRAS (LISTA COMPARTILHADA)
// =========================================================
async function carregarCompras() {
  const { data, error } = await db
    .from('compras')
    .select('*')
    .order('created_at', { ascending: false });

  // Não derruba o app se a tabela ainda não existir (schema.sql não executado)
  compraErro = error ? error.message : null;
  compras = error ? [] : data;
  renderizarCompras();
}

function nomeMembro(id) {
  return membros.find((m) => m.id === id)?.nome || null;
}

function renderizarCompras() {
  const listaEl = document.getElementById('lista-compras');
  const blocoComprados = document.getElementById('bloco-comprados');
  const listaCompradosEl = document.getElementById('lista-comprados');

  const pendentes = compras.filter((c) => !c.comprado);
  const comprados = compras
    .filter((c) => c.comprado)
    .sort((a, b) => (b.comprado_em || '').localeCompare(a.comprado_em || ''))
    .slice(0, 30);

  document.getElementById('badge-qtd-compras').textContent = pendentes.length;

  if (compraErro) {
    listaEl.innerHTML = `<p class="vazio card">Não foi possível carregar a lista de compras. Rode o arquivo <code>supabase/schema.sql</code> no Supabase.<br><small>${escaparHTML(compraErro)}</small></p>`;
    blocoComprados.classList.add('oculto');
    return;
  }

  const linha = (c) => {
    const quem = c.comprado ? nomeMembro(c.comprado_por) : nomeMembro(c.adicionado_por);
    const meta = c.comprado
      ? `Comprado${quem ? ' por ' + escaparHTML(quem) : ''} · ${formatarDataHoraConclusao(c.comprado_em)}`
      : (quem ? `Pedido por ${escaparHTML(quem)}` : 'Adicionado à lista');
    return `
      <div class="item-compra ${c.comprado ? 'comprado' : ''}">
        <input type="checkbox" class="check-tarefa" ${c.comprado ? 'checked' : ''}
               onchange="alternarCompra(${c.id})" title="${c.comprado ? 'Voltar para a lista' : 'Marcar como comprado'}" />
        <div class="item-compra-info">
          <span class="item-compra-nome">${escaparHTML(c.item)}${c.quantidade ? ` <span class="texto-suave">· ${escaparHTML(c.quantidade)}</span>` : ''}</span>
          <span class="item-compra-meta">${meta}</span>
        </div>
        <button type="button" class="btn-acao btn-excluir" onclick="excluirCompra(${c.id})" title="Remover">🗑️</button>
      </div>
    `;
  };

  listaEl.innerHTML = pendentes.length
    ? pendentes.map(linha).join('')
    : '<p class="vazio card">Nada para comprar no momento. 🛒</p>';

  blocoComprados.classList.toggle('oculto', comprados.length === 0);
  listaCompradosEl.innerHTML = comprados.map(linha).join('');
}

document.getElementById('form-compra').addEventListener('submit', async (e) => {
  e.preventDefault();
  const inputItem = document.getElementById('input-item-compra');
  const inputQtd = document.getElementById('input-qtd-compra');
  const btn = document.getElementById('btn-submit-compra');
  const item = inputItem.value.trim();
  if (!item) return;

  btn.disabled = true;
  try {
    const { error } = await db.from('compras').insert([{
      item,
      quantidade: inputQtd.value.trim() || null,
      adicionado_por: euId ? Number(euId) : null,
    }]);
    if (error) throw error;
    inputItem.value = '';
    inputQtd.value = '';
    inputItem.focus();
    await carregarCompras();
  } catch (err) {
    mostrarToast('Erro ao adicionar item: ' + err.message, 'erro');
  } finally {
    btn.disabled = false;
  }
});

async function alternarCompra(id) {
  const compra = compras.find((c) => c.id === id);
  if (!compra) return;
  const comprado = !compra.comprado;

  const { error } = await db.from('compras').update({
    comprado,
    comprado_em: comprado ? new Date().toISOString() : null,
    comprado_por: comprado && euId ? Number(euId) : null,
  }).eq('id', id);

  if (error) {
    mostrarToast('Erro ao atualizar item: ' + error.message, 'erro');
    return;
  }
  await carregarCompras();
}

async function excluirCompra(id) {
  const { error } = await db.from('compras').delete().eq('id', id);
  if (error) {
    mostrarToast('Erro ao remover item: ' + error.message, 'erro');
    return;
  }
  await carregarCompras();
}

document.getElementById('btn-limpar-comprados').addEventListener('click', async () => {
  const qtd = compras.filter((c) => c.comprado).length;
  if (!qtd || !confirm(`Remover os ${qtd} item(ns) já comprados da lista?`)) return;
  const { error } = await db.from('compras').delete().eq('comprado', true);
  if (error) {
    mostrarToast('Erro ao limpar: ' + error.message, 'erro');
    return;
  }
  mostrarToast('🧹 Itens comprados removidos.');
  await carregarCompras();
});

// =========================================================
// LEMBRETES (NOTIFICAÇÕES NO APARELHO)
// =========================================================
const checkLembretesEl = document.getElementById('check-lembretes');
const inputHoraLembreteEl = document.getElementById('input-hora-lembrete');
const infoLembretesEl = document.getElementById('info-lembretes');

checkLembretesEl.checked = localStorage.getItem('lembretes-ativos') === '1';
inputHoraLembreteEl.value = localStorage.getItem('lembrete-hora') || '08:00';

function suportaNotificacoes() {
  return 'Notification' in window;
}

function atualizarInfoLembretes() {
  if (!suportaNotificacoes()) {
    infoLembretesEl.textContent = 'Este navegador não suporta notificações. No iPhone, instale o app na tela inicial (Compartilhar → Adicionar à Tela de Início) para ativar.';
    return;
  }
  if (Notification.permission === 'denied') {
    infoLembretesEl.textContent = 'As notificações estão bloqueadas para este site. Libere nas configurações do navegador.';
    return;
  }
  infoLembretesEl.textContent = checkLembretesEl.checked
    ? `Todo dia a partir das ${inputHoraLembreteEl.value}, ao abrir o app (ou com ele aberto), você recebe o resumo das suas tarefas. Também avisamos quando alguém te passa uma tarefa.`
    : 'Desativado.';
}

async function pedirPermissaoNotificacao() {
  if (!suportaNotificacoes()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  return (await Notification.requestPermission()) === 'granted';
}

async function exibirNotificacao(titulo, corpo, tag) {
  if (!suportaNotificacoes() || Notification.permission !== 'granted') return;
  const opcoes = { body: corpo, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(titulo, opcoes);
    else new Notification(titulo, opcoes);
  } catch (e) {
    console.warn('Falha ao notificar:', e);
  }
}

function montarResumoDoDia() {
  const hoje = hojeISO();
  const minhas = tarefas.filter((t) => !t.concluida && (!euId || String(t.membro_id) === euId));
  const paraHoje = minhas.filter((t) => t.data_prevista === hoje);
  const atrasadas = minhas.filter(tarefaEstaAtrasada);
  const nome = euId ? nomeMembro(Number(euId)) : null;

  if (paraHoje.length === 0 && atrasadas.length === 0) {
    return { titulo: `☀️ Bom dia${nome ? ', ' + nome : ''}!`, corpo: 'Nenhuma tarefa para hoje. Aproveite! 🎉' };
  }

  const partes = [];
  if (paraHoje.length) partes.push(`${paraHoje.length} para hoje: ${paraHoje.slice(0, 3).map((t) => t.titulo).join(', ')}${paraHoje.length > 3 ? '…' : ''}`);
  if (atrasadas.length) partes.push(`⚠️ ${atrasadas.length} atrasada(s)`);
  return { titulo: `🏠 Tarefas de hoje${nome ? ' — ' + nome : ''}`, corpo: partes.join('\n') };
}

function verificarLembreteDiario() {
  if (!sessaoAtual || !checkLembretesEl.checked) return;
  if (!suportaNotificacoes() || Notification.permission !== 'granted') return;

  const agora = new Date();
  const horaAtual = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
  const hoje = hojeISO();
  if (horaAtual < inputHoraLembreteEl.value || localStorage.getItem('lembrete-ultimo-dia') === hoje) return;

  localStorage.setItem('lembrete-ultimo-dia', hoje);
  const { titulo, corpo } = montarResumoDoDia();
  exibirNotificacao(titulo, corpo, 'resumo-diario');
}

// Avisa quando aparece uma tarefa nova para "mim" vinda de outro aparelho (com o app em segundo plano)
let idsConhecidos = null;
function notificarNovasAtribuicoes() {
  const pendentesMinhas = tarefas.filter((t) => !t.concluida && euId && String(t.membro_id) === euId);
  const idsAtuais = new Set(pendentesMinhas.map((t) => t.id));

  if (idsConhecidos && checkLembretesEl.checked && document.visibilityState === 'hidden') {
    const novas = pendentesMinhas.filter((t) => !idsConhecidos.has(t.id));
    if (novas.length === 1) {
      exibirNotificacao('📌 Nova tarefa para você', `${novas[0].titulo} — ${formatarDataBR(novas[0].data_prevista)}`, `tarefa-${novas[0].id}`);
    } else if (novas.length > 1) {
      exibirNotificacao('📌 Novas tarefas para você', novas.map((t) => t.titulo).join(', '), 'novas-tarefas');
    }
  }
  idsConhecidos = idsAtuais;
}

checkLembretesEl.addEventListener('change', async () => {
  if (checkLembretesEl.checked) {
    const permitido = await pedirPermissaoNotificacao();
    if (!permitido) {
      checkLembretesEl.checked = false;
      mostrarToast('Permita as notificações no navegador para ativar os lembretes.', 'erro');
    } else {
      mostrarToast('🔔 Lembretes ativados!');
    }
  }
  localStorage.setItem('lembretes-ativos', checkLembretesEl.checked ? '1' : '0');
  atualizarInfoLembretes();
  verificarLembreteDiario();
});

inputHoraLembreteEl.addEventListener('change', () => {
  localStorage.setItem('lembrete-hora', inputHoraLembreteEl.value || '08:00');
  localStorage.removeItem('lembrete-ultimo-dia');
  atualizarInfoLembretes();
});

document.getElementById('btn-testar-lembrete').addEventListener('click', async () => {
  if (!(await pedirPermissaoNotificacao())) {
    mostrarToast('Permita as notificações no navegador para testar.', 'erro');
    return;
  }
  const { titulo, corpo } = montarResumoDoDia();
  exibirNotificacao(titulo, corpo, 'teste');
});

atualizarInfoLembretes();
setInterval(verificarLembreteDiario, 60 * 1000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') verificarLembreteDiario();
});

// =========================================================
// EVENTOS DE FILTROS, TEMA E REALTIME
// =========================================================
document.getElementById('input-busca-afazeres').addEventListener('input', (e) => {
  buscaAfazeres = e.target.value.trim().toLowerCase();
  renderizarAfazeres();
});

document.querySelectorAll('#filtros-status-afazeres .chip').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#filtros-status-afazeres .chip').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    filtroStatusAfazeres = btn.dataset.status;
    renderizarAfazeres();
  });
});

document.getElementById('input-busca-concluidos').addEventListener('input', (e) => {
  buscaConcluidos = e.target.value.trim().toLowerCase();
  renderizarConcluidos();
});

document.getElementById('filtro-cat-concluidos').addEventListener('change', (e) => {
  filtroCatConcluidos = e.target.value;
  renderizarConcluidos();
});

document.getElementById('filtro-pessoa-concluidos').addEventListener('change', (e) => {
  filtroPessoaConcluidos = e.target.value;
  renderizarConcluidos();
});

// Tema claro / escuro
function aplicarTema(modo) {
  const escuro = modo === 'dark';
  document.body.classList.toggle('dark', escuro);
  document.getElementById('icone-tema').textContent = escuro ? '☀️' : '🌙';
  document.getElementById('texto-tema').textContent = escuro ? 'Modo claro' : 'Modo escuro';

  if (abaAtual === 'estatisticas') {
    renderizarEstatisticas();
  }
}

aplicarTema(localStorage.getItem('tema-tarefas') || 'light');

document.getElementById('btn-tema').addEventListener('click', () => {
  const novoModo = document.body.classList.contains('dark') ? 'light' : 'dark';
  localStorage.setItem('tema-tarefas', novoModo);
  aplicarTema(novoModo);
});

// Supabase Realtime: recarrega só o necessário, agrupando eventos próximos
let timerRealtime = null;
const tabelasAlteradas = new Set();

function iniciarRealtime() {
  if (canalRealtime) return;

  const agendar = (tabela) => () => {
    tabelasAlteradas.add(tabela);
    clearTimeout(timerRealtime);
    timerRealtime = setTimeout(processarRealtime, 300);
  };

  canalRealtime = db.channel('casa-em-ordem-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tarefas' }, agendar('tarefas'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'subtarefas' }, agendar('subtarefas'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'membros' }, agendar('membros'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'categorias' }, agendar('categorias'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'compras' }, agendar('compras'))
    .subscribe((status) => {
      document.getElementById('badge-realtime').classList.toggle('oculto', status !== 'SUBSCRIBED');
    });
}

function processarRealtime() {
  const mudouCadastro = tabelasAlteradas.has('membros') || tabelasAlteradas.has('categorias');
  const mudouTarefas = tabelasAlteradas.has('tarefas') || tabelasAlteradas.has('subtarefas');
  const mudouCompras = tabelasAlteradas.has('compras');
  tabelasAlteradas.clear();

  const recargas = [];
  if (mudouCadastro) recargas.push(recarregarTudo());
  else {
    if (mudouTarefas) recargas.push(carregarTarefas(), carregarPlacarSemanal());
    if (mudouCompras) recargas.push(carregarCompras());
  }
  Promise.all(recargas).catch(console.error);
}

function pararRealtime() {
  if (canalRealtime) {
    db.removeChannel(canalRealtime);
    canalRealtime = null;
  }
}

// Virada do dia: se o app ficou aberto depois da meia-noite, atualiza "Hoje" e "Atrasadas"
let diaRenderizado = hojeISO();
function verificarViradaDoDia() {
  const hoje = hojeISO();
  if (hoje === diaRenderizado) return;
  diaRenderizado = hoje;
  if (!editandoId && painelFormularioEl.classList.contains('oculto')) inputDataEl.value = hoje;
  if (sessaoAtual) {
    atualizarContadoresGerais();
    renderizarAfazeres();
    renderizarSemana();
    if (abaAtual === 'estatisticas') renderizarEstatisticas();
  }
}
setInterval(verificarViradaDoDia, 60 * 1000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') verificarViradaDoDia();
});

// =========================================================
// LOGIN (LINK MÁGICO POR E-MAIL) E SESSÃO
// =========================================================
const telaLoginEl = document.getElementById('tela-login');
const msgLoginEl = document.getElementById('msg-login');

function mostrarMensagemLogin(texto, erro = false) {
  msgLoginEl.textContent = texto;
  msgLoginEl.classList.toggle('erro', erro);
  msgLoginEl.classList.remove('oculto');
}

document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('input-email-login').value.trim();
  const btn = document.getElementById('btn-login');
  if (!email) return;

  btn.disabled = true;
  btn.textContent = 'Enviando...';
  try {
    const { error } = await db.auth.signInWithOtp({
      email,
      options: {
        // Só entra quem já foi convidado no painel do Supabase
        shouldCreateUser: false,
        emailRedirectTo: window.location.origin + window.location.pathname,
      },
    });
    if (error) throw error;
    mostrarMensagemLogin('📬 Link enviado! Abra seu e-mail neste aparelho para entrar.');
  } catch (err) {
    const naoCadastrado = /signups not allowed|not found|otp_disabled/i.test(err.message || '');
    mostrarMensagemLogin(
      naoCadastrado
        ? 'Este e-mail não tem acesso à casa. Peça para quem administra o app te convidar.'
        : 'Não foi possível enviar o link: ' + err.message,
      true
    );
  } finally {
    btn.disabled = false;
    btn.textContent = 'Enviar link de acesso';
  }
});

document.getElementById('btn-sair').addEventListener('click', async () => {
  if (!confirm('Sair da conta neste aparelho?')) return;
  await db.auth.signOut();
});

let appIniciado = false;

async function entrarNoApp(sessao) {
  sessaoAtual = sessao;
  telaLoginEl.classList.add('oculto');
  appShellEl.classList.remove('oculto');
  document.getElementById('texto-sair').textContent = `Sair (${sessao.user.email})`;

  if (appIniciado) return;
  appIniciado = true;

  try {
    await recarregarTudo();
    iniciarRealtime();
    verificarLembreteDiario();
  } catch (erro) {
    appIniciado = false;
    statusConexaoEl.textContent = 'Erro de conexão';
    statusConexaoEl.style.color = '#dc2626';
    mostrarToast('Erro ao carregar dados: ' + erro.message, 'erro');
    console.error(erro);
  }
}

function mostrarLogin() {
  sessaoAtual = null;
  appIniciado = false;
  pararRealtime();
  tarefas = [];
  compras = [];
  idsConhecidos = null;
  appShellEl.classList.add('oculto');
  telaLoginEl.classList.remove('oculto');
}

// Inicialização
(async function iniciar() {
  if (!window.supabase) {
    document.body.innerHTML = '<p style="padding:24px">Não foi possível carregar o app. Verifique sua conexão e recarregue a página.</p>';
    return;
  }

  // setTimeout: o Supabase recomenda não chamar o banco direto dentro deste callback
  db.auth.onAuthStateChange((evento, sessao) => {
    setTimeout(() => {
      if (sessao) entrarNoApp(sessao);
      else if (evento === 'SIGNED_OUT') mostrarLogin();
    }, 0);
  });

  const { data } = await db.auth.getSession();
  if (data.session) entrarNoApp(data.session);
  else mostrarLogin();
})();
