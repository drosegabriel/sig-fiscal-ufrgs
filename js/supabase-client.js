// Camada isolada de conexão e autenticação (Supabase)
const SUPABASE_URL = 'https://byojzikfumvajfsublgr.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_wGo87VGrhJH5svvF_29-Ng_imB-Atav';

window.dbClient = null;
try {
  if (window.supabase && typeof window.supabase.createClient === 'function') {
    window.dbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
} catch (err) {
  console.warn("Supabase indisponível no momento:", err);
}

// Controle de sessão compartilhado entre os arquivos HTML
window.AuthService = {
  async login(email, password) {
    if (!window.dbClient) {
      return { error: { message: "Cliente Supabase não carregado." } };
    }
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
    sessionStorage.setItem('sig_user_email', rotulos[perfil] || 'Demonstração');
    sessionStorage.setItem('sig_user_role', perfil);
  },

  async logout() {
    if (window.dbClient) {
      await window.dbClient.auth.signOut();
    }
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
    if (el) {
      const u = this.getUsuarioAtual();
      el.textContent = u.email;
    }
  }
};