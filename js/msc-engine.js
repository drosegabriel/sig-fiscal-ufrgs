window.OFICIAL_SICONFI = {
  "4312476EX": { nome: "Morro Reuter/RS", rcl: 52618477.73, dtpExec: 21953074.40, dtpLeg: 1420500.00 },
  "4308102EX": { nome: "Morro Reuter/RS", rcl: 52618477.73, dtpExec: 21953074.40, dtpLeg: 1420500.00 },
  "4314423EX": { nome: "Picada Café/RS", rcl: 54846798.61, dtpExec: 25531005.01, dtpLeg: 1580200.00 }
};

window.MscEngine = {
  STORAGE_KEY: 'sig_msc_estado_v3',

  salvarEstado(estado) { sessionStorage.setItem(this.STORAGE_KEY, JSON.stringify(estado)); },

  carregarEstado() {
    try { return JSON.parse(sessionStorage.getItem(this.STORAGE_KEY) || 'null'); }
    catch { return null; }
  },

  formatarMoeda(v) {
    return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  },

  formatarPct(v) {
    return Number(v || 0).toFixed(2).replace('.', ',') + '%';
  },

  parseValorAmericano(str) {
    if (!str) return 0;
    const num = Number(String(str).trim().replace(',', '.'));
    return Number.isFinite(num) ? num : 0;
  },

  // Aceita arquivos .csv soltos E/OU arquivos .zip (extraindo CSVs internos via JSZip)
  async extrairTextosCSV(fileList) {
    const textos = [];
    for (const file of Array.from(fileList)) {
      const nomeLower = file.name.toLowerCase();
      if (nomeLower.endsWith('.zip') && window.JSZip) {
        const zip = await window.JSZip.loadAsync(file);
        for (const [entryName, entry] of Object.entries(zip.files)) {
          if (!entry.dir && entryName.toLowerCase().endsWith('.csv')) {
            textos.push({ nome: entryName, conteudo: await entry.async('string') });
          }
        }
      } else if (nomeLower.endsWith('.csv')) {
        textos.push({ nome: file.name, conteudo: await file.text() });
      }
    }
    return textos;
  },

  async processarArquivos(fileList, salvarNaNuvem = true) {
    const csvs = await this.extrairTextosCSV(fileList);
    if (!csvs.length) return null;

    const arquivosProcessados = [];
    let totalDebitos = 0, totalCreditos = 0, totalLinhasLidas = 0;
    let temValoresNegativos = false, detectouEncerramento = false, faltouPO = false;

    for (const item of csvs) {
      const linhas = item.conteudo.split(/\r?\n/).filter(l => l.trim() !== '');
      if (linhas.length < 3) continue;

      const meta = linhas[0].split(';');
      const codigoSiconfi = String(meta[0] || 'DESCONHECIDO').trim();
      const periodo = String(meta[1] || item.nome).trim();
      if (periodo.endsWith('-13') || item.nome.toLowerCase().includes('encerramento')) {
        detectouEncerramento = true;
      }

      const headers = linhas[1].split(';').map(h => String(h).trim());
      const idxConta = headers.indexOf('ContaContabil');
      const idxValor = headers.indexOf('Valor');
      const idxTipoValor = headers.indexOf('TipoValor');
      const idxNat = headers.indexOf('NaturezaValor');

      const icMap = [];
      for (let k = 1; k <= 6; k++) {
        icMap.push({
          valIdx: headers.indexOf(`InformacaoComplementar${k}`),
          tipoIdx: headers.indexOf(`TipoInformacaoComplementar${k}`)
        });
      }

      let recCorrentes = 0, dedRcl = 0, dedEmendasAcs = 0;
      let dtpExecBruta = 0, dtpExecDed = 0;
      let dtpLegBruta = 0, dtpLegDed = 0;
      let dtpJudBruta = 0, dtpJudDed = 0;
      let impostos = 0, transferencias = 0, outrasRec = 0;

      for (let i = 2; i < linhas.length; i++) {
        const cols = linhas[i].split(';');
        if (cols.length < 5) continue;
        totalLinhasLidas++;

        // Preservação estrita como string (mantém zeros à esquerda)
        const conta = String(cols[idxConta] || '').trim();
        const tipoValor = String(cols[idxTipoValor] || '').trim();
        const nat = String(cols[idxNat] || '').trim().toUpperCase();
        const valor = this.parseValorAmericano(cols[idxValor]);

        if (valor < 0) temValoresNegativos = true;
        if (tipoValor !== 'period_change') continue;

        if (nat === 'D') totalDebitos += valor;
        if (nat === 'C') totalCreditos += valor;

        const ics = {};
        for (const pair of icMap) {
          if (pair.tipoIdx >= 0 && pair.valIdx >= 0) {
            const t = String(cols[pair.tipoIdx] || '').trim();
            const v = String(cols[pair.valIdx] || '').trim();
            if (t) ics[t] = v;
          }
        }
        if (!ics['PO']) faltouPO = true;

        // Natureza da Classe 6 (Orçamentária Executada): Credora (C positivo, D negativo)
        const valCredor = (nat === 'C' ? valor : -valor);
        const valDevedor = (nat === 'D' ? valor : -valor);

        const nr = ics['NR'] || '';
        const co = ics['CO'] || '';
        const fr = ics['FR'] || '';
        const fr3 = fr.length >= 4 ? fr.substring(1, 4) : fr; // Pos. inicial 2, tamanho 3
        const po = ics['PO'] || '';
        const nd = ics['ND'] || '';

        // ============================================================
        // 1. ANEXO 3 RREO — RECEITA CORRENTE LÍQUIDA (Mapeamentos.xlsx)
        // ============================================================
        const ehContaRcl = conta.startsWith('6212') || conta.startsWith('62132') ||
                           conta.startsWith('62133') || conta.startsWith('62138') || conta.startsWith('62139');
        const ehReceitaCorrente = /^(11|12|13|14|15|16|17|19)/.test(nr);

        if (ehContaRcl && ehReceitaCorrente) {
          recCorrentes += valCredor;

          if (nr.startsWith('11')) impostos += valCredor;
          else if (nr.startsWith('17')) transferencias += valCredor;
          else outrasRec += valCredor;

          // Deduções (II) por Natureza da Receita: Previdência Servidor, Compensação e Rendimentos RPPS
          if (/^(121501|121502|121503|121550|121551|199903|132104)/.test(nr)) {
            dedRcl += valCredor;
          }

          // Ajustes RCL p/ Pessoal (IX): Emendas (IV/VI) e ACS/ACE (VII)
          if (nr.startsWith('171')) {
            const ehEmendaInd = (co === '3110' || co === '3111');
            const ehEmendaBanc = (co === '3120' || co === '3121') && fr3 !== '604';
            const ehAcs = (fr3 === '604');
            if (ehEmendaInd || ehEmendaBanc || ehAcs) {
              dedEmendasAcs += valCredor;
            }
          }
        }

        // Dedução para Formação do FUNDEB (Conta 6.2.1.3.1.01.00)
        if (conta.startsWith('6213101')) {
          dedRcl += valDevedor;
        }

        // ============================================================
        // 2. ANEXO 1 RGF — DESPESA COM PESSOAL EXECUTADA/LIQUIDADA
        // Contas 6221303, 6221304, 6221307 (Classe 6: natureza Credora)
        // ============================================================
        const ehContaDtp = conta.startsWith('6221303') || conta.startsWith('6221304') || conta.startsWith('6221307');
        const ehControleTerceiriz = conta.startsWith('86332') || (conta.startsWith('86331') && nat === 'C');

        if (ehContaDtp || ehControleTerceiriz) {
          const elem = nd.length >= 6 ? nd.substring(4, 6) : '';
          const ehPessoal = ehControleTerceiriz || nd.startsWith('31') || nd.startsWith('339004') ||
                            (nd.startsWith('33') && elem === '34') ||
                            nd.startsWith('33909134') || nd.startsWith('33909234');

          if (ehPessoal) {
            // Identificação oficial de Poder (Leiaute MSC 2026 - aba PO)
            const ehLegislativo = po.startsWith('2023') || po.startsWith('2021') || po.startsWith('2022');
            const ehJudiciario = po.startsWith('303');
            const ehExecutivo = !ehLegislativo && !ehJudiciario; // 10131 Prefeitura, 10132 RPPS

            // Despesas Não Computadas (II) — art. 19 § 1º LRF (Mapeamentos.xlsx)
            const ehFrVinculadaPrev = ['800', '801', '802', '803', '804'].includes(fr3);
            const ehFrAcs = (fr3 === '604');
            const ehElemNaoComp = nd.startsWith('31') && ['91', '92', '94'].includes(elem);
            const ehTerceirizAnterior = nd.startsWith('33909134') || nd.startsWith('33909234');
            const ehInativoVinc = ehFrVinculadaPrev && nd.startsWith('31') && ['01', '03', '86', '91', '92', '94'].includes(elem);

            const dedutivel = ehInativoVinc || ehFrAcs || ehElemNaoComp || ehTerceirizAnterior;

            if (ehLegislativo) {
              dtpLegBruta += valCredor;
              if (dedutivel) dtpLegDed += valCredor;
            } else if (ehJudiciario) {
              dtpJudBruta += valCredor;
              if (dedutivel) dtpJudDed += valCredor;
            } else if (ehExecutivo) {
              dtpExecBruta += valCredor;
              if (dedutivel) dtpExecDed += valCredor;
            }
          }
        }
      }

      const rclMensal = recCorrentes - dedRcl;
      const dtpExecutivo = dtpExecBruta - dtpExecDed;
      const dtpLegislativo = dtpLegBruta - dtpLegDed;
      const dtpJudiciario = dtpJudBruta - dtpJudDed;

      arquivosProcessados.push({
        codigoSiconfi, periodo,
        recBruta: recCorrentes, dedRcl, rclMensal,
        dedAjustePessoal: dedEmendasAcs,
        dtpExecutivo, dtpLegislativo, dtpJudiciario,
        dtpConsolidado: dtpExecutivo + dtpLegislativo + dtpJudiciario,
        impostos, transferencias, outrasRec
      });
    }

    if (!arquivosProcessados.length) return null;
    arquivosProcessados.sort((a, b) => a.periodo.localeCompare(b.periodo));
    const meses = arquivosProcessados.slice(-12);

    const cod = meses[0].codigoSiconfi;
    const ref = window.OFICIAL_SICONFI[cod];
    const municipio = ref ? ref.nome : `Município Siconfi ${cod}`;

    const auditoria = {
      qtdMeses: meses.length, totalLinhasLidas, totalDebitos, totalCreditos,
      diffPartidas: Math.abs(totalDebitos - totalCreditos),
      temValoresNegativos, detectouEncerramento, faltouPO
    };

    const estado = this.montarConsolidado(cod, municipio, meses, auditoria, false);
    this.salvarEstado(estado);

    if (salvarNaNuvem && window.CloudRepo) {
      const saved = await window.CloudRepo.salvarApuracao(estado);
      if (saved.data) { estado.cloudId = saved.data.id; this.salvarEstado(estado); }
    }
    return estado;
  },

  async carregarBaseDemo(cod, salvarNaNuvem = false) {
    const info = window.OFICIAL_SICONFI[cod];
    if (!info) return null;

    const periodos = [
      '2025-07','2025-08','2025-09','2025-10','2025-11','2025-12',
      '2026-01','2026-02','2026-03','2026-04','2026-05','2026-06'
    ];
    const rclBase = info.rcl / 12, execBase = info.dtpExec / 12, legBase = info.dtpLeg / 12;

    const meses = periodos.map((p, i) => {
      const fator = 0.945 + (i * 0.01);
      const rb = (rclBase * 1.13) * fator;
      const ded = (rclBase * 0.13) * fator;
      const rclM = rb - ded;
      const dExec = execBase * fator;
      const dLeg = legBase * fator;
      return {
        codigoSiconfi: cod, periodo: p,
        recBruta: rb, dedRcl: ded, rclMensal: rclM, dedAjustePessoal: 0,
        dtpExecutivo: dExec, dtpLegislativo: dLeg, dtpJudiciario: 0,
        dtpConsolidado: dExec + dLeg,
        impostos: rclM * 0.27, transferencias: rclM * 0.66, outrasRec: rclM * 0.07
      };
    });

    const somaRcl = meses.reduce((a, m) => a + m.rclMensal, 0);
    const somaExec = meses.reduce((a, m) => a + m.dtpExecutivo, 0);
    const somaLeg = meses.reduce((a, m) => a + m.dtpLegislativo, 0);
    meses[11].rclMensal += (info.rcl - somaRcl);
    meses[11].dtpExecutivo += (info.dtpExec - somaExec);
    meses[11].dtpLegislativo += (info.dtpLeg - somaLeg);
    meses[11].dtpConsolidado = meses[11].dtpExecutivo + meses[11].dtpLegislativo;

    const auditoria = {
      qtdMeses: 12, totalLinhasLidas: 118940, totalDebitos: info.rcl * 2, totalCreditos: info.rcl * 2,
      diffPartidas: 0, temValoresNegativos: false, detectouEncerramento: false, faltouPO: false
    };

    const estado = this.montarConsolidado(cod, info.nome, meses, auditoria, true);
    this.salvarEstado(estado);
    if (salvarNaNuvem && window.CloudRepo) {
      const saved = await window.CloudRepo.salvarApuracao(estado);
      if (saved.data) { estado.cloudId = saved.data.id; this.salvarEstado(estado); }
    }
    return estado;
  },

  montarConsolidado(codigoSiconfi, municipio, meses, auditoria, ehDemo) {
    const rcl = meses.reduce((a, m) => a + m.rclMensal, 0);
    const dedAjuste = meses.reduce((a, m) => a + m.dedAjustePessoal, 0);
    const rclAjustada = rcl - dedAjuste;
    const dtpExecutivo = meses.reduce((a, m) => a + m.dtpExecutivo, 0);
    const dtpLegislativo = meses.reduce((a, m) => a + m.dtpLegislativo, 0);
    const dtpJudiciario = meses.reduce((a, m) => a + (m.dtpJudiciario || 0), 0);
    const dtpConsolidado = dtpExecutivo + dtpLegislativo + dtpJudiciario;
    const basePct = rclAjustada > 0 ? rclAjustada : 1;

    return {
      codigoSiconfi, municipio, ehDemo,
      periodoInicial: meses[0].periodo,
      periodoFinal: meses[meses.length - 1].periodo,
      meses, auditoria,
      totais: {
        rcl, rclAjustada, dedAjuste,
        dtpExecutivo, dtpLegislativo, dtpJudiciario, dtpConsolidado,
        pctExecutivo: (dtpExecutivo / basePct) * 100,
        pctLegislativo: (dtpLegislativo / basePct) * 100,
        pctJudiciario: (dtpJudiciario / basePct) * 100,
        pctConsolidado: (dtpConsolidado / basePct) * 100
      },
      composicaoReceita: {
        impostos: meses.reduce((a, m) => a + m.impostos, 0),
        transferencias: meses.reduce((a, m) => a + m.transferencias, 0),
        outras: meses.reduce((a, m) => a + m.outrasRec, 0)
      }
    };
  }
};