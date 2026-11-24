const SUPABASE_URL = 'https://byojzikfumvajfsublgr.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_wGo87VGrhJH5svvF_29-Ng_imB-Atav';

window.dbClient = null;
try {
  if (window.supabase && typeof window.supabase.createClient === 'function') {
    window.dbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
} catch (err) {
  console.warn('Supabase indisponível:', err);
}

window.AuthService = {
  async login(email, password) {
    if (!window.dbClient) return { error: { message: 'Cliente Supabase não carregado.' } };
    const result = await window.dbClient.auth.signInWithPassword({ email, password });
    if (!result.error) {
      sessionStorage.setItem('sig_user_email', email);
      sessionStorage.setItem('sig_user_role', 'tecnico');
    }
    return result;
  },

  entrarDemo(perfil) {
    const rotulos = {
      tecnico: 'Técnico Contábil (Demo)',
      gestor: 'Gestor / Secretário (Demo)',
      cidadao: 'Cidadão — Controle Social'
    };
    sessionStorage.setItem('sig_user_email', rotulos[perfil] || 'Visitante');
    sessionStorage.setItem('sig_user_role', perfil);
  },

  async logout() {
    if (window.dbClient) await window.dbClient.auth.signOut();
    sessionStorage.removeItem('sig_user_email');
    sessionStorage.removeItem('sig_user_role');
    window.location.href = 'index.html';
  },

  getUsuarioAtual() {
    return {
      email: sessionStorage.getItem('sig_user_email') || 'Visitante (Sessão Local)',
      role: sessionStorage.getItem('sig_user_role') || 'tecnico'
    };
  },

  preencherCabecalho() {
    const el = document.getElementById('userPill');
    if (el) el.textContent = this.getUsuarioAtual().email;
  }
};

window.CloudRepo = {
  async listarApuracoes() {
    if (!window.dbClient) return { data: [], error: 'Sem conexão' };
    return await window.dbClient
      .from('apuracoes')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(40);
  },

  async salvarApuracao(estado, parecer = '', favorito = false) {
    if (!window.dbClient) return { ok: false };
    const payloadCompleto = {
      codigo_siconfi: estado.codigoSiconfi,
      municipio: estado.municipio,
      periodo_final: estado.periodoFinal,
      rcl: Number(estado.totais.rclAjustada.toFixed(2)),
      dtp: Number(estado.totais.dtpConsolidado.toFixed(2)),
      percentual_dtp: Number(estado.totais.pctConsolidado.toFixed(2)),
      dtp_executivo: Number(estado.totais.dtpExecutivo.toFixed(2)),
      dtp_legislativo: Number(estado.totais.dtpLegislativo.toFixed(2)),
      favorito: Boolean(favorito),
      parecer_analise: parecer
    };

    let res = await window.dbClient.from('apuracoes').insert([payloadCompleto]).select();
    if (res.error) {
      // Fallback caso o usuário ainda não tenha rodado o ALTER TABLE no Supabase
      const payloadBasico = {
        codigo_siconfi: estado.codigoSiconfi,
        municipio: estado.municipio,
        periodo_final: estado.periodoFinal,
        rcl: Number(estado.totais.rclAjustada.toFixed(2)),
        dtp: Number(estado.totais.dtpConsolidado.toFixed(2)),
        percentual_dtp: Number(estado.totais.pctConsolidado.toFixed(2))
      };
      res = await window.dbClient.from('apuracoes').insert([payloadBasico]).select();
    }
    return { ok: !res.error, data: res.data?.[0] || null, error: res.error };
  },

  async excluirApuracao(id) {
    if (!window.dbClient) return { ok: false };
    const { error } = await window.dbClient.from('apuracoes').delete().eq('id', id);
    return { ok: !error, error };
  },

  async alternarFavorito(id, novoEstado) {
    // Salva localmente também para garantir funcionamento imediato
    const favs = JSON.parse(localStorage.getItem('sig_favs_ids') || '{}');
    favs[id] = Boolean(novoEstado);
    localStorage.setItem('sig_favs_ids', JSON.stringify(favs));

    if (!window.dbClient) return { ok: true };
    const { error } = await window.dbClient
      .from('apuracoes')
      .update({ favorito: Boolean(novoEstado) })
      .eq('id', id);
    return { ok: !error, error };
  }
};