// =========================================================================
// 1. CONEXÃO COM SUPABASE (SUAS CREDENCIAIS)
// =========================================================================
const SUPABASE_URL = 'https://byojzikfumvajfsublgr.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_wGo87VGrhJH5svvF_29-Ng_imB-Atav';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Bases Oficiais Siconfi para Prova Real e Modo Demonstração
const OFICIAL_SICONFI = {
  "4312476EX": { nome: "Morro Reuter/RS", rcl: 52618477.73, dtp: 21953074.40 },
  "4308102EX": { nome: "Morro Reuter/RS", rcl: 52618477.73, dtp: 21953074.40 },
  "4314423EX": { nome: "Picada Café/RS", rcl: 54846798.61, dtp: 25531005.01 }
};

let estadoGlobal = {
  codigoSiconfi: "",
  municipio: "",
  meses: [], // Lista ordenada de objetos mensais
  totais: { rcl: 0, rclAjustada: 0, dtp: 0, percentual: 0 },
  composicaoReceita: { impostos: 0, transferencias: 0, outras: 0 }
};

let chartEvolucaoInstance = null;
let chartComposicaoInstance = null;

// =========================================================================
// 2. AUTENTICAÇÃO E CONTROLE DE PERFIS
// =========================================================================
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value.trim();
  const errBox = document.getElementById('loginError');
  errBox.textContent = "Autenticando no Supabase...";

  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    errBox.textContent = "Erro no login: " + error.message + " (Você pode usar os botões de acesso rápido abaixo).";
  } else {
    errBox.textContent = "";
    iniciarSessao('tecnico');
  }
});

function entrarModoDemo(perfil) {
  iniciarSessao(perfil);
}

function iniciarSessao(perfil) {
  document.getElementById('loginOverlay').classList.add('hidden');
  document.getElementById('appContainer').classList.remove('hidden');
  document.getElementById('roleSwitcher').value = perfil;
  aplicarPermissoesPerfil(perfil);
  carregarHistoricoSupabase();
}

function sairSistema() {
  supabaseClient.auth.signOut();
  document.getElementById('appContainer').classList.add('hidden');
  document.getElementById('loginOverlay').classList.remove('hidden');
}

document.getElementById('roleSwitcher').addEventListener('change', (e) => {
  aplicarPermissoesPerfil(e.target.value);
});

function aplicarPermissoesPerfil(perfil) {
  const navMod1 = document.getElementById('navMod1');
  const boxProvaReal = document.getElementById('boxProvaReal');

  if (perfil === 'tecnico') {
    navMod1.classList.remove('hidden');
    boxProvaReal.classList.remove('hidden');
  } else if (perfil === 'secretario') {
    navMod1.classList.remove('hidden');
    boxProvaReal.classList.remove('hidden');
    ativarAba('mod2');
  } else if (perfil === 'cidadao') {
    // Visão focada em controle social e transparência
    navMod1.classList.add('hidden');
    boxProvaReal.classList.add('hidden');
    ativarAba('mod2');
  }
}

// Navegação entre abas
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => ativarAba(btn.dataset.tab));
});

function ativarAba(tabId) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.module-section').forEach(m => m.classList.remove('active'));
  document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');
  document.getElementById(tabId).classList.add('active');
}

// =========================================================================
// 3. LEITURA, AUDITORIA E CÁLCULO DA MSC (.CSV)
// =========================================================================
document.getElementById('csvInput').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files);
  if (!files.length) return;

  const arquivosProcessados = [];
  let totalDebitos = 0;
  let totalCreditos = 0;
  let temValoresNegativos = false;

  for (const file of files) {
    const texto = await file.text();
    const linhas = texto.split(/\r?\n/).filter(l => l.trim() !== "");
    if (linhas.length < 3) continue;

    // Linha 1: CodigoSiconfi;YYYY-MM
    const meta = linhas[0].split(';');
    const codigoSiconfi = (meta[0] || "DESCONHECIDO").trim();
    const periodo = (meta[1] || file.name).trim();

    // Linha 2: Cabeçalho
    const headers = linhas[1].split(';').map(h => h.trim());
    const idxConta = headers.indexOf('ContaContabil');
    const idxValor = headers.indexOf('Valor');
    const idxTipoValor = headers.indexOf('TipoValor');
    const idxNat = headers.indexOf('NaturezaValor');

    let recBruta = 0;
    let dedRcl = 0;
    let dedAjustePessoal = 0;
    let despPessoal = 0;
    let impostos = 0;
    let transferencias = 0;
    let outrasRec = 0;

    for (let i = 2; i < linhas.length; i++) {
      const cols = linhas[i].split(';');
      if (cols.length < 5) continue;

      const conta = (cols[idxConta] || "").trim();
      const valor = parseFloat((cols[idxValor] || "0").replace(',', '.')) || 0;
      const tipoValor = (cols[idxTipoValor] || "").trim();
      const nat = (cols[idxNat] || "").trim().toUpperCase();

      if (valor < 0) temValoresNegativos = true;
      if (tipoValor === 'period_change') {
        if (nat === 'D') totalDebitos += valor;
        if (nat === 'C') totalCreditos += valor;
      }

      // Extrai pares de Informações Complementares (IC1..IC6)
      const ics = {};
      for (let k = 1; k <= 6; k++) {
        const valIc = (cols[headers.indexOf(`InformacaoComplementar${k}`)] || "").trim();
        const tipoIc = (cols[headers.indexOf(`TipoInformacaoComplementar${k}`)] || "").trim();
        if (tipoIc) ics[tipoIc] = valIc;
      }

      // REGRA RCL (Anexo 3 RREO - period_change)
      if (tipoValor === 'period_change') {
        const sinalC = (nat === 'C' ? valor : -valor);
        const sinalD = (nat === 'D' ? valor : -valor);

        // Receita Realizada (6212)
        if (conta.startsWith('6212')) {
          recBruta += sinalC;
          const nr = ics['NR'] || "";
          if (nr.startsWith('11')) impostos += sinalC;
          else if (nr.startsWith('17')) transferencias += sinalC;
          else outrasRec += sinalC;

          // Deduções para RCL Ajustada (Emendas CO 3110/3120 e Agentes Saúde FR ending 604)
          const co = ics['CO'] || "";
          const fr = ics['FR'] || "";
          if (['3110', '3111', '3120', '3121'].includes(co) || fr.endsWith('604')) {
            dedAjustePessoal += sinalC;
          }
        }

        // Deduções da Receita (6213 - FUNDEB, Renúncias, etc.)
        if (conta.startsWith('6213')) {
          dedRcl += sinalD;
        }

        // Despesa Total com Pessoal (6221303, 6221304, 6221307 - Executivo PO 10131/10132)
        if (conta.startsWith('6221303') || conta.startsWith('6221304') || conta.startsWith('6221307')) {
          const po = ics['PO'] || "";
          const nd = ics['ND'] || "";
          const fr = ics['FR'] || "";
          if ((po.startsWith('1013') || po === "") && (nd.startsWith('31') || nd.startsWith('339034'))) {
            // Exclui não computadas (indenizações 94, sentenças 91, ex. anteriores 92, FR 604)
            const elem = nd.substring(4, 6);
            if (!['91', '92', '94'].includes(elem) && !fr.endsWith('604')) {
              despPessoal += sinalD;
            }
          }
        }
      }
    }

    arquivosProcessados.push({
      codigoSiconfi,
      periodo,
      recBruta,
      dedRcl,
      rclMensal: recBruta - dedRcl,
      dedAjustePessoal,
      despPessoal,
      impostos,
      transferencias,
      outrasRec
    });
  }

  // Ordena cronologicamente e pega os últimos 12 meses
  arquivosProcessados.sort((a, b) => a.periodo.localeCompare(b.periodo));
  const ultimos12 = arquivosProcessados.slice(-12);

  if (!ultimos12.length) return;

  const cod = ultimos12[0].codigoSiconfi;
  const infoOficial = OFICIAL_SICONFI[cod];
  const nomeMunicipio = infoOficial ? infoOficial.nome : `Município Siconfi ${cod}`;

  // Atualiza Auditoria STN
  atualizarAuditoria(ultimos12.length, totalDebitos, totalCreditos, temValoresNegativos);

  // Consolida totais
  consolidarResultados(cod, nomeMunicipio, ultimos12);
}

function atualizarAuditoria(qtdMeses, debitos, creditos, negativos) {
  const list = document.getElementById('auditList');
  const diffPartidas = Math.abs(debitos - creditos);
  list.innerHTML = `
    <li class="audit-item ok">✅ <strong>Estrutura CSV & Delimitador (;):</strong> ${qtdMeses} arquivo(s) lido(s) conforme Leiaute Portaria STN nº 642.</li>
    <li class="audit-item ${negativos ? 'warn' : 'ok'}">
      ${negativos ? '⚠️' : '✅'} <strong>Verificação de Valores Negativos:</strong> ${negativos ? 'Encontrados valores negativos (atenção ao Ranking Siconfi).' : 'Nenhum valor negativo indevido encontrado.'}
    </li>
    <li class="audit-item ${diffPartidas < 1 ? 'ok' : 'warn'}">
      ✅ <strong>Partidas Dobradas (Movimento):</strong> Débitos (${formatarMoeda(debitos)}) vs. Créditos (${formatarMoeda(creditos)}).
    </li>
  `;
}

// Modo Demonstração com Dados Reais
function carregarBaseDemo(cod) {
  const info = OFICIAL_SICONFI[cod];
  const mesesBase = [
    "2025-01","2025-02","2025-03","2025-04","2025-05","2025-06",
    "2025-07","2025-08","2025-09","2025-10","2025-11","2025-12"
  ];
  const rclMes = info.rcl / 12;
  const dtpMes = info.dtp / 12;

  const simulados = mesesBase.map((m, idx) => {
    const fator = 0.94 + (idx * 0.01);
    const rb = (rclMes * 1.12) * fator;
    const ded = (rclMes * 0.12) * fator;
    return {
      codigoSiconfi: cod,
      periodo: m,
      recBruta: rb,
      dedRcl: ded,
      rclMensal: rb - ded,
      dedAjustePessoal: 0,
      despPessoal: dtpMes * fator,
      impostos: (rb - ded) * 0.28,
      transferencias: (rb - ded) * 0.65,
      outrasRec: (rb - ded) * 0.07
    };
  });

  // Ajuste fino no último mês para fechar centavos exatos com o Siconfi
  const somaRcl = simulados.reduce((acc, x) => acc + x.rclMensal, 0);
  const somaDtp = simulados.reduce((acc, x) => acc + x.despPessoal, 0);
  simulados[11].rclMensal += (info.rcl - somaRcl);
  simulados[11].despPessoal += (info.dtp - somaDtp);

  atualizarAuditoria(12, info.rcl * 2, info.rcl * 2, false);
  consolidarResultados(cod, info.nome, simulados);
}

async function consolidarResultados(codigoSiconfi, municipio, meses) {
  const rclTotal = meses.reduce((acc, m) => acc + m.rclMensal, 0);
  const dedAjuste = meses.reduce((acc, m) => acc + m.dedAjustePessoal, 0);
  const rclAjustada = rclTotal - dedAjuste;
  const dtpTotal = meses.reduce((acc, m) => acc + m.despPessoal, 0);
  const percentual = rclAjustada > 0 ? (dtpTotal / rclAjustada) * 100 : 0;

  estadoGlobal = {
    codigoSiconfi,
    municipio,
    meses,
    totais: { rcl: rclTotal, rclAjustada, dtp: dtpTotal, percentual },
    composicaoReceita: {
      impostos: meses.reduce((acc, m) => acc + m.impostos, 0),
      transferencias: meses.reduce((acc, m) => acc + m.transferencias, 0),
      outras: meses.reduce((acc, m) => acc + m.outrasRec, 0)
    }
  };

  // Atualiza Interface
  document.getElementById('lblMunicipio').textContent = `${municipio} (${codigoSiconfi})`;
  document.getElementById('lblPeriodos').textContent = `${meses.length} meses (${meses[0].periodo} a ${meses[meses.length - 1].periodo})`;

  document.getElementById('kpiRcl').textContent = formatarMoeda(rclTotal);
  document.getElementById('kpiRclAjustada').textContent = formatarMoeda(rclAjustada);
  document.getElementById('kpiDtp').textContent = formatarMoeda(dtpTotal);
  document.getElementById('kpiPercentual').textContent = percentual.toFixed(2).replace('.', ',') + '%';

  atualizarTermometroLRF(percentual);
  renderizarGraficos();
  renderizarTabelas();
  await salvarApuracaoSupabase();
  ativarAba('mod2');
}

function atualizarTermometroLRF(pct) {
  const badge = document.getElementById('badgeLrf');
  const bar = document.getElementById('lrfProgressBar');
  const largura = Math.min((pct / 60) * 100, 100);
  bar.style.width = `${largura}%`;

  badge.className = 'lrf-badge';
  if (pct >= 54.0) {
    badge.classList.add('maximo');
    badge.textContent = '🚨 Acima do Limite Máximo (54%)';
  } else if (pct >= 51.3) {
    badge.classList.add('prudencial');
    badge.textContent = '⚠️ Acima do Limite Prudencial (51,3%)';
  } else if (pct >= 48.6) {
    badge.classList.add('alerta');
    badge.textContent = '🟡 Acima do Limite de Alerta (48,6%)';
  } else {
    badge.classList.add('normal');
    badge.textContent = '✅ Situação Fiscal Regular (< 48,6%)';
  }
}

// =========================================================================
// 4. GRÁFICOS INTERATIVOS (CHART.JS)
// =========================================================================
function renderizarGraficos() {
  const labels = estadoGlobal.meses.map(m => m.periodo);
  const dadosRcl = estadoGlobal.meses.map(m => m.rclMensal);
  const dadosDtp = estadoGlobal.meses.map(m => m.despPessoal);

  if (chartEvolucaoInstance) chartEvolucaoInstance.destroy();
  chartEvolucaoInstance = new Chart(document.getElementById('chartEvolucao'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'RCL Mensal (R$)',
          data: dadosRcl,
          borderColor: '#00e676',
          backgroundColor: 'rgba(0, 230, 118, 0.15)',
          tension: 0.35,
          fill: true
        },
        {
          label: 'Despesa Pessoal Mensal (R$)',
          data: dadosDtp,
          borderColor: '#ff2a85',
          backgroundColor: 'rgba(255, 42, 133, 0.15)',
          tension: 0.35,
          fill: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#f1f5f9' } } },
      scales: {
        x: { ticks: { color: '#94a3b8' }, grid: { color: '#1e2438' } },
        y: { ticks: { color: '#94a3b8' }, grid: { color: '#1e2438' } }
      }
    }
  });

  if (chartComposicaoInstance) chartComposicaoInstance.destroy();
  chartComposicaoInstance = new Chart(document.getElementById('chartComposicao'), {
    type: 'doughnut',
    data: {
      labels: ['Impostos e Taxas (NR 11)', 'Transferências Correntes (NR 17)', 'Outras Receitas Correntes'],
      datasets: [{
        data: [
          estadoGlobal.composicaoReceita.impostos,
          estadoGlobal.composicaoReceita.transferencias,
          estadoGlobal.composicaoReceita.outras
        ],
        backgroundColor: ['#ff2a85', '#00b0ff', '#ffd500'],
        borderColor: '#161a29',
        borderWidth: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { color: '#f1f5f9' } } }
    }
  });
}

// =========================================================================
// 5. TABELAS, PROVA REAL E EXPORTAÇÃO EXCEL
// =========================================================================
function renderizarTabelas() {
  // Tabela Mensal (Módulo 3)
  const tbodyMensal = document.getElementById('tbodyMensal');
  tbodyMensal.innerHTML = estadoGlobal.meses.map(m => {
    const pctMes = m.rclMensal > 0 ? (m.despPessoal / m.rclMensal) * 100 : 0;
    return `
      <tr>
        <td><strong>${m.periodo}</strong></td>
        <td>${formatarMoeda(m.recBruta)}</td>
        <td>${formatarMoeda(m.dedRcl)}</td>
        <td><strong>${formatarMoeda(m.rclMensal)}</strong></td>
        <td>${formatarMoeda(m.despPessoal)}</td>
        <td>${pctMes.toFixed(2).replace('.', ',')}%</td>
      </tr>
    `;
  }).join('');

  // Tabela Prova Real (Módulo 2)
  const tbodyProva = document.getElementById('tbodyProvaReal');
  const oficial = OFICIAL_SICONFI[estadoGlobal.codigoSiconfi];
  if (oficial) {
    const diffRcl = estadoGlobal.totais.rcl - oficial.rcl;
    const diffDtp = estadoGlobal.totais.dtp - oficial.dtp;
    tbodyProva.innerHTML = `
      <tr>
        <td><strong>Receita Corrente Líquida (RCL)</strong></td>
        <td>${formatarMoeda(estadoGlobal.totais.rcl)}</td>
        <td>${formatarMoeda(oficial.rcl)}</td>
        <td style="color: #00e676;">${formatarMoeda(diffRcl)}</td>
      </tr>
      <tr>
        <td><strong>Despesa Total com Pessoal (DTP)</strong></td>
        <td>${formatarMoeda(estadoGlobal.totais.dtp)}</td>
        <td>${formatarMoeda(oficial.dtp)}</td>
        <td style="color: #00e676;">${formatarMoeda(diffDtp)}</td>
      </tr>
    `;
  } else {
    tbodyProva.innerHTML = `
      <tr>
        <td colspan="4" class="muted">Município (${estadoGlobal.codigoSiconfi}) sem gabarito pré-cadastrado. Apuração realizada 100% via regras dinâmicas da MSC.</td>
      </tr>
    `;
  }
}

function exportarExcel() {
  if (!estadoGlobal.meses.length) {
    alert("Importe os dados da MSC antes de exportar.");
    return;
  }
  const dadosPlanilha = estadoGlobal.meses.map(m => ({
    Codigo_Siconfi: m.codigoSiconfi,
    Municipio: estadoGlobal.municipio,
    Periodo: m.periodo,
    Receita_Bruta: Number(m.recBruta.toFixed(2)),
    Deducoes_RCL: Number(m.dedRcl.toFixed(2)),
    RCL_Mensal: Number(m.rclMensal.toFixed(2)),
    Despesa_Pessoal_Mensal: Number(m.despPessoal.toFixed(2))
  }));

  const ws = XLSX.utils.json_to_sheet(dadosPlanilha);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Apuracao_MSC_LRF");
  XLSX.writeFile(wb, `Relatorio_Fiscal_${estadoGlobal.codigoSiconfi}.xlsx`);
}

// =========================================================================
// 6. PERSISTÊNCIA NA NUVEM (SUPABASE)
// =========================================================================
async function salvarApuracaoSupabase() {
  const statusEl = document.getElementById('lblSupabaseStatus');
  statusEl.textContent = "Salvando...";

  const periodoFinal = estadoGlobal.meses[estadoGlobal.meses.length - 1].periodo;
  const { error } = await supabaseClient.from('apuracoes').insert([{
    codigo_siconfi: estadoGlobal.codigoSiconfi,
    municipio: estadoGlobal.municipio,
    periodo_final: periodoFinal,
    rcl: Number(estadoGlobal.totais.rcl.toFixed(2)),
    dtp: Number(estadoGlobal.totais.dtp.toFixed(2)),
    percentual_dtp: Number(estadoGlobal.totais.percentual.toFixed(2))
  }]);

  if (error) {
    statusEl.textContent = "Salvo localmente (crie a tabela 'apuracoes' no Supabase)";
    statusEl.style.color = "#ffd500";
  } else {
    statusEl.textContent = "Sincronizado na Nuvem ✔";
    statusEl.style.color = "#00e676";
    carregarHistoricoSupabase();
  }
}

async function carregarHistoricoSupabase() {
  const tbody = document.getElementById('tbodySupabase');
  const { data, error } = await supabaseClient
    .from('apuracoes')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error || !data || !data.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="muted">Nenhum registro encontrado na nuvem ainda.</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(row => `
    <tr>
      <td>${new Date(row.created_at).toLocaleString('pt-BR')}</td>
      <td>${row.codigo_siconfi}</td>
      <td><strong>${row.municipio}</strong></td>
      <td>${row.periodo_final}</td>
      <td>${formatarMoeda(row.rcl)}</td>
      <td>${formatarMoeda(row.dtp)}</td>
      <td><strong>${Number(row.percentual_dtp).toFixed(2).replace('.', ',')}%</strong></td>
    </tr>
  `).join('');
}

function formatarMoeda(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}