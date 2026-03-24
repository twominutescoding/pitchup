'use strict';

// ── In-memory state (učitan iz DB na init) ─────────────────────────────────
const state = {
  users:       [],  // whitelist — iz DB.getUsers()
  session:     {},  // tekuća sesija — iz DB.getSession()
  players:     [],  // prijavljeni — iz DB.getPlayers()
  mockUserIdx: 0,   // koji je "korisnik" aktivan (UI simulacija, ne perzistira)
  authMode:    null, // 'google' | 'dev'
  googleUser:  null, // { email, name, picture }
};

// Pozicije igrača na SVG terenu (viewBox 500×320)
const POSITIONS = {
  5: {
    a: [{ x: 33,  y: 160 }, { x: 115, y: 75  }, { x: 115, y: 160 }, { x: 115, y: 245 }, { x: 200, y: 160 }],
    b: [{ x: 467, y: 160 }, { x: 385, y: 75  }, { x: 385, y: 160 }, { x: 385, y: 245 }, { x: 300, y: 160 }],
  },
  4: {
    a: [{ x: 33,  y: 160 }, { x: 125, y: 95  }, { x: 125, y: 225 }, { x: 210, y: 160 }],
    b: [{ x: 467, y: 160 }, { x: 375, y: 95  }, { x: 375, y: 225 }, { x: 290, y: 160 }],
  },
};

// ── Security helpers ───────────────────────────────────────────────────────

function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escAttr(str) {
  return escHtml(str);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function currentUser() {
  if (state.authMode === 'google' && state.googleUser) {
    const match = state.users.find(u => u.email === state.googleUser.email);
    if (match) return match;
  }
  return state.users[state.mockUserIdx] || state.users[0];
}
function currentNick()  { return currentUser().nick; }
function isAdmin()      { return currentUser().role === 'admin'; }
function sessionOpen()  { return state.session.status === 'open'; }

function getActiveCount() {
  const n = state.players.length;
  if (n < 2) return 0;
  return n % 2 === 0 ? n : n - 1;
}

// ── resolveNick — email→nick lookup za history podatke ─────────────────────

function resolveNick(nameOrEmail) {
  if (!nameOrEmail) return '';
  // Ako izgleda kao email, potraži u users listi
  if (nameOrEmail.includes('@')) {
    const user = state.users.find(u => u.email === nameOrEmail);
    return user ? user.nick : nameOrEmail;
  }
  return nameOrEmail;
}

// ── Init ───────────────────────────────────────────────────────────────────

async function init() {
  try {
    await DB.init();
  } catch (e) {
    console.error('DB init greška:', e);
  }
  state.users = DB.getUsers();

  // Provjeri postojeću Google sesiju
  try {
    const existingUser = Auth.check();
    if (existingUser) {
      // Auth + listeneri moraju biti aktivni prije whitelist checka
      await Auth.restoreFirebaseAuth();
      await DB.startListeners();
      state.users = DB.getUsers();

      const whitelisted = state.users.find(u => u.email === existingUser.email);
      if (whitelisted) {
        loginWithGoogle(existingUser);
        return;
      }
    }
  } catch (e) {
    console.error('Auth check greška:', e);
  }

  // Nema valjane sesije → prikaži login ekran
  showLoginScreen();
}

function showLoginScreen() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('main-content').classList.add('hidden');

  // Sakrij dev mode gumb na produkciji
  const devBtn = document.querySelector('.btn-dev-mode');
  if (devBtn) devBtn.classList.toggle('hidden', !isLocalhost());

  const note = document.getElementById('login-note');
  note.textContent = '';

  let attempts = 0;
  const MAX_ATTEMPTS = 25; // 25 × 200ms = 5 sekundi

  function tryInitGoogleBtn() {
    attempts++;
    if (typeof google !== 'undefined' && google.accounts) {
      try {
        Auth.initGoogleButton('google-btn-container', handleGoogleLogin);
      } catch (e) {
        console.error('GSI init greška:', e);
        note.textContent = 'Greška pri inicijalizaciji Google prijave. Pokušaj refreshati stranicu.';
        note.classList.add('login-error');
      }
    } else if (attempts >= MAX_ATTEMPTS) {
      note.textContent = 'Google prijava se nije učitala. Provjeri internet vezu ili koristi Dev mode.';
      note.classList.add('login-error');
    } else {
      setTimeout(tryInitGoogleBtn, 200);
    }
  }
  tryInitGoogleBtn();
}

async function handleGoogleLogin(response) {
  const note = document.getElementById('login-note');
  note.textContent = '';
  note.classList.remove('login-error');

  if (!response || !response.credential) {
    note.textContent = 'Google nije vratio podatke za prijavu. Pokušaj ponovo.';
    note.classList.add('login-error');
    return;
  }

  const user = await Auth.handleCredential(response);
  if (!user) {
    note.textContent = 'Neuspješno dekodiranje prijave. Pokušaj ponovo.';
    note.classList.add('login-error');
    return;
  }

  // Firebase Auth mora biti aktivan PRIJE čitanja Firestore-a (security rules)
  await Auth.restoreFirebaseAuth();
  await DB.startListeners();

  // Sada osvježi users iz Firestore-a (nakon auth-a)
  state.users = DB.getUsers();

  const whitelisted = state.users.find(u => u.email === user.email);
  if (!whitelisted) {
    Auth.clear();
    note.innerHTML = `<strong>${escHtml(user.email)}</strong> nije na popisu igrača.<br>Kontaktiraj admina za pristup.`;
    note.classList.add('login-error');
    return;
  }

  loginWithGoogle(user);
}

async function loginWithGoogle(googleUser) {
  state.authMode   = 'google';
  state.googleUser = googleUser;

  // Firebase Auth + Firestore listeneri (ako još nisu pokrenuti)
  await Auth.restoreFirebaseAuth();
  await DB.startListeners();
  state.users = DB.getUsers();

  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('main-content').classList.remove('hidden');

  // Google user pill u headeru
  const pill = document.getElementById('google-user-pill');
  pill.classList.remove('hidden');
  document.getElementById('google-avatar').src = googleUser.picture || '';
  const match = state.users.find(u => u.email === googleUser.email);
  document.getElementById('google-nick').textContent = match ? match.nick : googleUser.name;

  const badge = document.getElementById('google-role-badge');
  if (match) {
    badge.textContent = match.role.toUpperCase();
    badge.className   = `role-badge role-${match.role}`;
  }

  // Sakrij mock pill
  document.getElementById('mock-user-pill').classList.add('hidden');

  bootApp();
}

function isLocalhost() {
  const h = location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '';
}

function enterDevMode() {
  if (!isLocalhost()) {
    console.warn('Dev mode dostupan samo na localhost.');
    return;
  }
  state.authMode = 'dev';

  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('main-content').classList.remove('hidden');

  // Prikaži mock pill, sakrij google pill
  document.getElementById('mock-user-pill').classList.remove('hidden');
  document.getElementById('google-user-pill').classList.add('hidden');

  bootApp();
}

function doLogout() {
  Auth.logout(); // clearsa storage i reloada
}

function bootApp() {
  state.session = DB.getSession();
  state.players = DB.getPlayers();

  renderNextWednesday();
  renderRegistrationStatus();
  if (state.authMode === 'dev') updateMockUserUI();
  else {
    document.getElementById('admin-card').classList.toggle('hidden', !isAdmin());
    if (isAdmin()) refreshAdminPanel();
    document.getElementById('register-btn').disabled =
      state.players.some(p => p.name === currentNick());
    document.getElementById('reg-nick').textContent    = currentNick();
    document.getElementById('reg-avatar').textContent  = currentNick().charAt(0).toUpperCase();
  }
  updateRegCard();
  render();
  renderHistory();

  // Real-time listeneri — Firestore automatski triggeraju re-render
  DB.subscribe(() => {
    state.users   = DB.getUsers();
    state.session = DB.getSession();
    state.players = DB.getPlayers();

    updateRegCard();
    if (state.authMode === 'dev') updateMockUserUI();
    else {
      document.getElementById('admin-card').classList.toggle('hidden', !isAdmin());
      if (isAdmin()) refreshAdminPanel();
      document.getElementById('register-btn').disabled =
        state.players.some(p => p.name === currentNick());
    }
    render();
    renderHistory();
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.cs')) closeAllCs();

    // Centralni delegirani event handler za data-action atribute
    const actionEl = e.target.closest('[data-action]');
    if (actionEl) {
      const action = actionEl.dataset.action;
      switch (action) {
        case 'logout':           doLogout(); break;
        case 'next-mock-user':   nextMockUser(); break;
        case 'dev-mode':         enterDevMode(); break;
        case 'toggle-cs':        toggleCs(actionEl.dataset.cs); break;
        case 'pick-cs':          pickCs(actionEl.dataset.cs, actionEl, actionEl.dataset.label); break;
        case 'register':         registerPlayer(); break;
        case 'draw-teams':       drawTeams(); break;
        case 'open-session':     openSession(); break;
        case 'close-session':    closeSession(); break;
        case 'add-player-admin': addPlayerAsAdmin(); break;
        case 'submit-result':    submitResult(); break;
        case 'show-history':     showHistoryTab(); break;
        case 'hide-history':     hideHistoryTab(); break;
        case 'close-rating':     closeRatingModal(); break;
        case 'close-profile':    closePlayerProfile(); break;
        case 'open-my-profile':  openMyProfile(); break;
        case 'close-my-profile': closeMyProfile(); break;
        case 'save-my-profile':  saveMyProfile(); break;
      }
      return;
    }

    // Delegirani listeneri za dinamički generirani sadržaj
    const profileEl = e.target.closest('[data-profile]');
    if (profileEl) { openPlayerProfile(profileEl.dataset.profile); return; }

    const matchDateEl = e.target.closest('[data-match-date]');
    if (matchDateEl) { openRatingModal(matchDateEl.dataset.matchDate); return; }

    const ratePlayerEl = e.target.closest('[data-rate-player]');
    if (ratePlayerEl) { submitPlayerRating(ratePlayerEl.dataset.ratePlayer); return; }

    const starEl = e.target.closest('.star[data-val]');
    if (starEl) { pickStar(starEl); return; }
  });
}

// ── Mock user (zamijenit će Google OAuth) ──────────────────────────────────

function nextMockUser() {
  state.mockUserIdx = (state.mockUserIdx + 1) % state.users.length;
  updateMockUserUI();
  render(); // draw gumb ovisi o roli
}

function updateMockUserUI() {
  const user    = currentUser();
  const initial = user.nick.charAt(0).toUpperCase();

  document.getElementById('mock-nick').textContent   = user.nick;
  document.getElementById('mock-avatar').textContent = initial;
  document.getElementById('reg-nick').textContent    = user.nick;
  document.getElementById('reg-avatar').textContent  = initial;
  document.getElementById('register-btn').disabled   =
    state.players.some(p => p.name === user.nick);

  const badge = document.getElementById('mock-role-badge');
  badge.textContent = user.role.toUpperCase();
  badge.className   = `role-badge role-${user.role}`;

  document.getElementById('admin-card').classList.toggle('hidden', !isAdmin());
  if (isAdmin()) refreshAdminPanel();
}

// ── Admin panel ────────────────────────────────────────────────────────────

function refreshAdminPanel() {
  const isOpen = sessionOpen();

  document.getElementById('ui-session-closed').classList.toggle('hidden', isOpen);
  document.getElementById('ui-session-open').classList.toggle('hidden', !isOpen);
  document.getElementById('admin-actions').classList.toggle('hidden', !isOpen);

  document.getElementById('next-wed-display').textContent =
    getNextWednesday().toLocaleDateString('hr-HR', { weekday: 'long', day: 'numeric', month: 'long' });

  if (!isOpen) return;

  // "Dodaj igrača" select — samo neprijavljeni korisnici
  const registered = new Set(state.players.map(p => p.name));
  const available  = state.users.filter(u => !registered.has(u.nick));
  const select     = document.getElementById('admin-player-select');
  select.innerHTML = available.length
    ? '<option value="">— odaberi —</option>' +
      available.map(u => `<option value="${escAttr(u.nick)}">${escHtml(u.nick)}</option>`).join('')
    : '<option value="">Svi su prijavljeni</option>';

  // Labele tima za formu rezultata
  if (state.session.teamsDrawn) {
    const a = state.players.filter(p => p.team === 'a').map(p => p.name).join(', ');
    const b = state.players.filter(p => p.team === 'b').map(p => p.name).join(', ');
    document.getElementById('result-label-a').textContent = `Tim A (${a})`;
    document.getElementById('result-label-b').textContent = `Tim B (${b})`;
  } else {
    document.getElementById('result-label-a').textContent = 'Tim A';
    document.getElementById('result-label-b').textContent = 'Tim B';
  }
}

// ── Session management ─────────────────────────────────────────────────────

function openSession() {
  state.session = {
    ...state.session,
    status:     'open',
    date:       getNextWednesday().toISOString().slice(0, 10),
    field:      document.getElementById('cs-field').querySelector('.cs-val').textContent,
    time:       document.getElementById('cs-time').querySelector('.cs-val').textContent,
    teamsDrawn: false,
    markerTeam: null,
  };
  DB.saveSession(state.session);
  updateRegCard();
  refreshAdminPanel();
  render();
}

function closeSession() {
  if (!confirm('Zatvori prijave i resetiraj listu igrača za ovu srijedu?')) return;
  state.session = {
    ...state.session,
    status:     'closed',
    date:       null,
    teamsDrawn: false,
    markerTeam: null,
  };
  state.players = [];
  DB.saveSession(state.session);
  DB.savePlayers(state.players);
  updateRegCard();
  refreshAdminPanel();
  render();
}

function updateRegCard() {
  const isOpen = sessionOpen();
  document.getElementById('reg-locked').classList.toggle('hidden', isOpen);
  document.getElementById('reg-open').classList.toggle('hidden', !isOpen);
}

// ── Admin akcije ───────────────────────────────────────────────────────────

function addPlayerAsAdmin() {
  const select = document.getElementById('admin-player-select');
  const nick   = select.value;
  if (!nick || state.players.some(p => p.name === nick)) return;

  state.players.push({ id: uid(), name: nick, team: null });
  if (state.session.teamsDrawn) {
    state.session = { ...state.session, teamsDrawn: false, markerTeam: null };
    state.players.forEach(p => { p.team = null; });
    DB.saveSession(state.session);
  }
  DB.savePlayers(state.players);
  render();
  refreshAdminPanel();
}

function submitResult() {
  const scoreA = Math.max(0, parseInt(document.getElementById('score-a').value) || 0);
  const scoreB = Math.max(0, parseInt(document.getElementById('score-b').value) || 0);

  const result = {
    date:   new Date().toISOString().slice(0, 10),
    field:  state.session.field,
    time:   state.session.time,
    scoreA,
    scoreB,
    teamA:  state.players.filter(p => p.team === 'a').map(p => {
      const user = state.users.find(u => u.nick === p.name);
      return user ? user.email : p.name;
    }),
    teamB:  state.players.filter(p => p.team === 'b').map(p => {
      const user = state.users.find(u => u.nick === p.name);
      return user ? user.email : p.name;
    }),
  };

  DB.addResult(result);

  document.getElementById('score-a').value = 0;
  document.getElementById('score-b').value = 0;
  renderHistory();

  const note = document.getElementById('result-note');
  note.textContent = '✓ Rezultat je spremljen!';
  note.className   = 'admin-note success';
  clearTimeout(note._t);
  note._t = setTimeout(() => { note.textContent = ''; note.className = 'admin-note'; }, 3000);
}

// ── Registration ───────────────────────────────────────────────────────────

function registerPlayer() {
  if (!sessionOpen()) return;
  const nick = currentNick();
  if (state.players.some(p => p.name === nick)) {
    showNote('Već si prijavljen!', 'error');
    return;
  }

  state.players.push({ id: uid(), name: nick, team: null });
  if (state.session.teamsDrawn) {
    state.session = { ...state.session, teamsDrawn: false, markerTeam: null };
    state.players.forEach(p => { p.team = null; });
    DB.saveSession(state.session);
  }
  DB.savePlayers(state.players);

  showNote(`${nick} je prijavljen! 👍`, 'success');
  document.getElementById('register-btn').disabled = true;
  if (isAdmin()) refreshAdminPanel();
  render();
}

function showNote(msg, type) {
  const el = document.getElementById('reg-note');
  el.textContent = msg;
  el.className   = `reg-note ${type}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.textContent = ''; el.className = 'reg-note'; }, 3000);
}

// ── Team draw (admin only) ─────────────────────────────────────────────────

function drawTeams() {
  if (!isAdmin()) return;
  const n = getActiveCount();
  if (n === 0) return;

  state.players.forEach(p => { p.team = null; });

  const pool = state.players.slice(0, n).sort(() => Math.random() - 0.5);
  const idsA = new Set(pool.slice(0, n / 2).map(p => p.id));
  state.players.forEach((p, i) => {
    p.team = i >= n ? 'bench' : (idsA.has(p.id) ? 'a' : 'b');
  });

  state.session = {
    ...state.session,
    teamsDrawn: true,
    markerTeam: Math.random() < 0.5 ? 'a' : 'b',
  };

  DB.savePlayers(state.players);
  DB.saveSession(state.session);

  document.getElementById('draw-btn').textContent = '🔄 Ponovi';
  if (isAdmin()) refreshAdminPanel();
  render();
}

// ── Custom dropdowns ───────────────────────────────────────────────────────

function toggleCs(id) {
  const el = document.getElementById(id);
  const wasOpen = el.classList.contains('open');
  closeAllCs();
  if (!wasOpen) el.classList.add('open');
}

function closeAllCs() {
  document.querySelectorAll('.cs.open').forEach(el => el.classList.remove('open'));
}

function pickCs(id, optEl, label) {
  const cs = document.getElementById(id);
  cs.querySelector('.cs-val').textContent = label;
  cs.querySelectorAll('.cs-opt').forEach(o => o.classList.remove('active'));
  optEl.classList.add('active');
  closeAllCs();
}

// ── Date helpers ───────────────────────────────────────────────────────────

function getNextWednesday() {
  const today = new Date();
  const day   = today.getDay();
  const diff  = day === 3 ? 7 : (3 - day + 7) % 7;
  const wed   = new Date(today);
  wed.setDate(today.getDate() + diff);
  return wed;
}

function renderNextWednesday() {
  document.getElementById('next-wednesday').textContent =
    getNextWednesday().toLocaleDateString('hr-HR', { weekday: 'short', day: 'numeric', month: 'numeric' });
}

function renderRegistrationStatus() {
  const el  = document.getElementById('reg-status');
  const day = new Date().getDay();
  if (day === 3) {
    el.className = 'reg-status today';
    el.textContent = '⚽ Danas je utakmica!';
  } else if (day >= 0 && day <= 3) {
    el.className = 'reg-status open';
    el.textContent = '● Prijave otvorene';
  } else {
    el.className = 'reg-status closed';
    el.textContent = '○ Otvara u nedjelju';
  }
}

// ── Render ─────────────────────────────────────────────────────────────────

function render() {
  renderPlayers();
  renderPitch();
}

function renderPlayers() {
  const count      = state.players.length;
  const activeN    = getActiveCount();
  const badge      = document.getElementById('player-count');
  const drawBtn    = document.getElementById('draw-btn');
  const legend     = document.getElementById('team-legend');
  const list       = document.getElementById('players-list');

  badge.textContent = count;
  badge.className   = activeN > 0 ? 'badge full' : 'badge';
  drawBtn.classList.toggle('hidden', !isAdmin() || count < 2);

  if (state.session.teamsDrawn) {
    legend.classList.remove('hidden');
    const mk = t => state.session.markerTeam === t ? ' <strong>(markeri)</strong>' : '';
    legend.innerHTML = `
      <div class="legend-item">
        <div class="legend-dot" style="background:#c89010"></div>
        <span>Tim A${mk('a')}</span>
      </div>
      <div class="legend-item">
        <div class="legend-dot" style="background:#1860d8"></div>
        <span>Tim B${mk('b')}</span>
      </div>`;
  } else {
    legend.classList.add('hidden');
  }

  if (count === 0) {
    list.innerHTML = '<div class="empty-state">Još nema prijavljenih igrača.</div>';
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'players-grid';

  state.players.forEach(player => {
    const onBench = player.team === 'bench';
    const chip    = document.createElement('div');
    chip.className = [
      'player-chip',
      player.team && !onBench ? 'team-' + player.team : '',
      onBench ? 'bench' : '',
    ].filter(Boolean).join(' ');

    // Gornji red: badges (tim, ocjena, forma)
    const topRow = document.createElement('div');
    topRow.className = 'chip-top';

    const avgData = DB.getPlayerAvgRatings(player.name);
    if (avgData) {
      const cats = ['tehnika', 'brzina', 'izdrzljivost', 'timska', 'pozicioniranje'];
      const overall = cats.reduce((s, c) => s + (avgData[c] || 0), 0) / cats.length;
      const rating = document.createElement('span');
      rating.className = 'player-rating clickable';
      rating.textContent = `★ ${overall.toFixed(1)}`;
      rating.title = 'Pogledaj profil';
      rating.onclick = (e) => { e.stopPropagation(); openPlayerProfile(player.name); };
      topRow.appendChild(rating);
    }

    const pForm = calcPlayerForm(player.name);
    if (pForm > 1) {
      const fm = document.createElement('span');
      fm.className = 'player-form';
      fm.textContent = formIcon(pForm);
      fm.title = `Forma: ${formLabel(pForm)} (${pForm.toFixed(1)})`;
      topRow.appendChild(fm);
    }

    if (topRow.children.length) chip.appendChild(topRow);

    // Donji red: avatar + ime
    const bottomRow = document.createElement('div');
    bottomRow.className = 'chip-bottom';

    const av = document.createElement('div');
    av.className   = 'player-avatar';
    av.textContent = player.name.charAt(0).toUpperCase();

    const nm = document.createElement('span');
    nm.className   = 'player-name';
    nm.textContent = player.name;

    bottomRow.appendChild(av);
    bottomRow.appendChild(nm);
    chip.appendChild(bottomRow);

    grid.appendChild(chip);
  });

  list.innerHTML = '';
  list.appendChild(grid);

  const benchCount = state.players.filter(p => p.team === 'bench').length;
  if (benchCount > 0) {
    const note = document.createElement('p');
    note.className   = 'bench-note';
    note.textContent = `${benchCount} igrač${benchCount === 1 ? '' : 'a'} čeka sljedeću.`;
    list.appendChild(note);
  }
}

// ── Pitch rendering ────────────────────────────────────────────────────────

function renderPitch() {
  const container = document.getElementById('pitch-players');
  const hint      = document.getElementById('pitch-hint');
  container.innerHTML = '';

  if (!state.session.teamsDrawn) {
    if (state.players.length > 0) renderUnassigned(container, state.players);
    hint.textContent = isAdmin()
      ? 'Žrijebaj timove kako bi rasporedio igrače na teren.'
      : 'Admin će napraviti žrijeb kad se skupi dovoljno igrača.';
    document.getElementById('team-comparison').classList.add('hidden');
    return;
  }

  const teamA = state.players.filter(p => p.team === 'a');
  const teamB = state.players.filter(p => p.team === 'b');
  const pos   = POSITIONS[teamA.length] || generatePositions(teamA.length);

  const history = DB.getHistory();
  const allStats = calcPlayerStats(history);

  function getStatsText(player) {
    const overall = getPlayerOverall(player.name);
    const form = calcPlayerForm(player.name);
    const ps = allStats.find(s => s.name === player.name);
    let parts = [];
    if (overall != null) parts.push(`★${overall.toFixed(1)}`);
    if (form >= 1.8) parts.push(formIcon(form));
    if (ps) parts.push(`${ps.w}W-${ps.l}L`);
    return parts.join(' ');
  }

  teamA.forEach((p, i) => { if (i < pos.a.length) drawPlayerMarker(container, p, pos.a[i].x, pos.a[i].y, 'rg-gold', getStatsText(p)); });
  teamB.forEach((p, i) => { if (i < pos.b.length) drawPlayerMarker(container, p, pos.b[i].x, pos.b[i].y, 'rg-blue', getStatsText(p)); });

  hint.textContent = `${state.session.markerTeam === 'a' ? 'Tim A' : 'Tim B'} donosi markere.`;

  renderTeamComparison(teamA, teamB, allStats);
}

function renderUnassigned(container, players) {
  const active = players.filter(p => p.team !== 'bench');
  const n = active.length;
  const cx = 250, cy = 153;
  active.forEach((player, i) => {
    const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
    const r     = n === 1 ? 0 : Math.min(34, 11 * n);
    drawPlayerMarker(container, player, cx + r * Math.cos(angle), cy + r * Math.sin(angle), 'rg-neutral');
  });
}

function drawPlayerMarker(container, player, x, y, gradId, statsText) {
  const g = svgEl('g');

  const shadow = svgEl('ellipse');
  shadow.setAttribute('cx', x + 1);
  shadow.setAttribute('cy', y + 12);
  shadow.setAttribute('rx', '8');
  shadow.setAttribute('ry', '3');
  shadow.setAttribute('fill', 'rgba(0,0,0,0.50)');
  shadow.setAttribute('filter', 'url(#f-shadow)');

  const circle = svgEl('circle');
  circle.setAttribute('cx', x);
  circle.setAttribute('cy', y);
  circle.setAttribute('r', '10');
  circle.setAttribute('fill', `url(#${gradId})`);
  circle.setAttribute('stroke', 'rgba(255,255,255,0.75)');
  circle.setAttribute('stroke-width', '1.5');

  const shine = svgEl('ellipse');
  shine.setAttribute('cx', x - 3);
  shine.setAttribute('cy', y - 3.5);
  shine.setAttribute('rx', '3.5');
  shine.setAttribute('ry', '2.5');
  shine.setAttribute('fill', 'rgba(255,255,255,0.30)');
  shine.setAttribute('transform', `rotate(-25,${x - 3},${y - 3.5})`);

  const hasStats = statsText && statsText.length > 0;
  const name = trunc(player.name, 8);
  const statsW = hasStats ? Math.max(0, statsText.length * 4.2 + 8) : 0;
  const lw   = Math.max(26, name.length * 5.0 + 8, statsW);
  const lx   = x - lw / 2;
  const ly   = y + 12;
  const lh   = hasStats ? 21 : 11;

  const labelBg = svgEl('rect');
  labelBg.setAttribute('x', lx);
  labelBg.setAttribute('y', ly);
  labelBg.setAttribute('width', lw);
  labelBg.setAttribute('height', lh);
  labelBg.setAttribute('rx', '5.5');
  labelBg.setAttribute('fill', 'rgba(0,0,0,0.65)');

  const text = svgEl('text');
  text.setAttribute('x', x);
  text.setAttribute('y', ly + 8);
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('fill', 'rgba(255,255,255,0.95)');
  text.setAttribute('font-size', '7');
  text.setAttribute('font-weight', '700');
  text.setAttribute('font-family', '-apple-system,Helvetica,sans-serif');
  text.textContent = name;

  g.appendChild(shadow);
  g.appendChild(circle);
  g.appendChild(shine);
  g.appendChild(labelBg);
  g.appendChild(text);

  if (hasStats) {
    const statsEl = svgEl('text');
    statsEl.setAttribute('x', x);
    statsEl.setAttribute('y', ly + 17);
    statsEl.setAttribute('text-anchor', 'middle');
    statsEl.setAttribute('fill', 'rgba(255,255,200,0.80)');
    statsEl.setAttribute('font-size', '5.5');
    statsEl.setAttribute('font-weight', '600');
    statsEl.setAttribute('font-family', '-apple-system,Helvetica,sans-serif');
    statsEl.textContent = statsText;
    g.appendChild(statsEl);
  }

  container.appendChild(g);
}

// ── History ────────────────────────────────────────────────────────────────

function historyItemCompact(m) {
  const date     = new Date(m.date).toLocaleDateString('hr-HR', { day: 'numeric', month: 'numeric', year: 'numeric' });
  const diff     = m.scoreA - m.scoreB;
  const outcome  = diff > 0 ? 'win-a' : diff < 0 ? 'win-b' : 'draw';
  const label    = diff > 0 ? 'Tim A pobijedio' : diff < 0 ? 'Tim B pobijedio' : 'Neriješeno';
  const playersA = (m.teamA || []).map(n => escHtml(resolveNick(n))).join(', ') || '—';
  const playersB = (m.teamB || []).map(n => escHtml(resolveNick(n))).join(', ') || '—';
  return `
    <div class="history-item">
      <div class="history-meta">${escHtml(date)} · ${escHtml(m.field)} · ${escHtml(m.time)}</div>
      <div class="history-score">
        <div class="hs-side">
          <span class="hs-team ${outcome === 'win-a' ? 'hs-winner' : ''}">Tim A</span>
          <span class="hs-players">${playersA}</span>
        </div>
        <span class="hs-num">${parseInt(m.scoreA) || 0} – ${parseInt(m.scoreB) || 0}</span>
        <div class="hs-side hs-side-right">
          <span class="hs-team ${outcome === 'win-b' ? 'hs-winner' : ''}">Tim B</span>
          <span class="hs-players">${playersB}</span>
        </div>
      </div>
      <div class="history-outcome ${outcome}">${label}</div>
    </div>`;
}

function historyItemFull(m) {
  const date     = new Date(m.date).toLocaleDateString('hr-HR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const diff     = m.scoreA - m.scoreB;
  const outcome  = diff > 0 ? 'win-a' : diff < 0 ? 'win-b' : 'draw';
  const label    = diff > 0 ? 'Tim A pobijedio' : diff < 0 ? 'Tim B pobijedio' : 'Neriješeno';
  const teamA    = (m.teamA || []).map(resolveNick);
  const teamB    = (m.teamB || []).map(resolveNick);
  return `
    <div class="hf-card">
      <div class="hf-header">
        <span class="hf-date">${escHtml(date)}</span>
        <span class="hf-venue">${escHtml(m.field)} · ${escHtml(m.time)}</span>
      </div>
      <div class="hf-score-row">
        <span class="hf-team-label ${outcome === 'win-a' ? 'hf-winner' : ''}">Tim A</span>
        <span class="hf-score">${parseInt(m.scoreA) || 0} – ${parseInt(m.scoreB) || 0}</span>
        <span class="hf-team-label ${outcome === 'win-b' ? 'hf-winner' : ''}">Tim B</span>
      </div>
      <div class="hf-outcome ${outcome}">${label}</div>
      <div class="hf-rosters">
        <div class="hf-roster">
          ${teamA.map(n => `<span class="hf-player clickable" data-profile="${escAttr(n)}">${escHtml(n)}</span>`).join('')}
        </div>
        <div class="hf-roster hf-roster-right">
          ${teamB.map(n => `<span class="hf-player clickable" data-profile="${escAttr(n)}">${escHtml(n)}</span>`).join('')}
        </div>
      </div>
      <button class="btn-rate-match" data-match-date="${escAttr(m.date)}">⭐ Ocijeni igrače</button>
    </div>`;
}

function renderHistory() {
  const list    = document.getElementById('history-list');
  const allBtn  = document.getElementById('btn-history-all');
  const history = DB.getHistory();

  if (!history.length) {
    list.innerHTML = '<div class="empty-state">Nema zapisanih rezultata.</div>';
    allBtn.classList.add('hidden');
    return;
  }

  allBtn.classList.remove('hidden');
  list.innerHTML = history.slice(0, 3).map(historyItemCompact).join('');
}

// ── History tab (full view) ───────────────────────────────────────────────

function calcPlayerStats(history) {
  const stats = {};
  history.forEach(m => {
    const diff = m.scoreA - m.scoreB;
    (m.teamA || []).forEach(raw => {
      const name = resolveNick(raw);
      if (!stats[name]) stats[name] = { w: 0, d: 0, l: 0, gp: 0 };
      stats[name].gp++;
      if (diff > 0) stats[name].w++;
      else if (diff === 0) stats[name].d++;
      else stats[name].l++;
    });
    (m.teamB || []).forEach(raw => {
      const name = resolveNick(raw);
      if (!stats[name]) stats[name] = { w: 0, d: 0, l: 0, gp: 0 };
      stats[name].gp++;
      if (diff < 0) stats[name].w++;
      else if (diff === 0) stats[name].d++;
      else stats[name].l++;
    });
  });
  return Object.entries(stats)
    .map(([name, s]) => ({ name, ...s, pts: s.w * 3 + s.d }))
    .sort((a, b) => b.pts - a.pts || b.w - a.w || b.gp - a.gp);
}

function calcPlayerForm(name) {
  const history = DB.getHistory();
  const now     = Date.now();
  const DECAY   = 42; // 6 tjedana u danima
  let score = 0;
  history.forEach(m => {
    const allPlayers = [...(m.teamA || []), ...(m.teamB || [])].map(resolveNick);
    if (!allPlayers.includes(name)) return;
    const daysAgo = (now - new Date(m.date).getTime()) / 86400000;
    score += Math.max(0, 1 - daysAgo / DECAY);
  });
  // Normalizacija: ~3.5 weighted bodova = forma 5.0
  return Math.min(5, Math.max(1, 1 + (score / 3.5) * 4));
}

function formIcon(val) {
  if (val >= 4.5) return '🔥';
  if (val >= 3.5) return '💪';
  if (val >= 2.5) return '👍';
  if (val >= 1.8) return '😐';
  return '🥶';
}

function formLabel(val) {
  if (val >= 4.5) return 'Izvrsna';
  if (val >= 3.5) return 'Dobra';
  if (val >= 2.5) return 'OK';
  if (val >= 1.8) return 'Slaba';
  return 'Loša';
}

function formColor(val) {
  if (val >= 4.0) return '#5ec05e';
  if (val >= 3.0) return '#b0d0b0';
  if (val >= 2.0) return '#c89a12';
  return '#e06060';
}

function getPlayerOverall(name) {
  const avgs = DB.getPlayerAvgRatings(name);
  if (!avgs) return null;
  const cats = ['tehnika', 'brzina', 'izdrzljivost', 'timska', 'pozicioniranje'];
  return cats.reduce((s, c) => s + (avgs[c] || 0), 0) / cats.length;
}

function renderStatsTable(history) {
  const rows = calcPlayerStats(history);
  if (!rows.length) return '';
  return `
    <div class="stats-card">
      <div class="stats-title">Poredak igrača</div>
      <table class="stats-table">
        <thead>
          <tr>
            <th class="st-pos">#</th>
            <th class="st-name">Igrač</th>
            <th class="st-num">W</th>
            <th class="st-num">D</th>
            <th class="st-num">L</th>
            <th class="st-num">GP</th>
            <th class="st-num st-pts">Bod</th>
            <th class="st-num st-rating">★</th>
            <th class="st-num st-form">Forma</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r, i) => {
            const ov   = getPlayerOverall(r.name);
            const form = calcPlayerForm(r.name);
            return `
            <tr${i === 0 ? ' class="st-first"' : ''}>
              <td class="st-pos">${i + 1}.</td>
              <td class="st-name clickable" data-profile="${escAttr(r.name)}">${escHtml(r.name)}</td>
              <td class="st-num">${r.w}</td>
              <td class="st-num">${r.d}</td>
              <td class="st-num">${r.l}</td>
              <td class="st-num">${r.gp}</td>
              <td class="st-num st-pts">${r.pts}</td>
              <td class="st-num st-rating">${ov != null ? ov.toFixed(1) : '–'}</td>
              <td class="st-num st-form" title="${escAttr(formLabel(form))} (${form.toFixed(1)})">${formIcon(form)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

function showHistoryTab() {
  const history = DB.getHistory();
  const list    = document.getElementById('history-full-list');
  if (!history.length) {
    list.innerHTML = '<div class="empty-state">Nema zapisanih rezultata.</div>';
  } else {
    list.innerHTML = renderStatsTable(history) +
      '<div class="stats-title" style="margin-top:24px;margin-bottom:12px;">Sve utakmice</div>' +
      history.map(historyItemFull).join('');
  }
  document.getElementById('history-tab').classList.remove('hidden');
}

function hideHistoryTab() {
  document.getElementById('history-tab').classList.add('hidden');
}

// ── Rating categories ─────────────────────────────────────────────────────

const RATING_CATS = [
  { key: 'tehnika',        label: 'Tehnika' },
  { key: 'brzina',         label: 'Brzina' },
  { key: 'izdrzljivost',   label: 'Izdržljivost' },
  { key: 'timska',         label: 'Timska igra' },
  { key: 'pozicioniranje', label: 'Pozicioniranje' },
];

// ── Rating modal ──────────────────────────────────────────────────────────

let _ratingMatch = null; // { date, allPlayers[] }

function openRatingModal(matchDate) {
  const history = DB.getHistory();
  const match   = history.find(m => m.date === matchDate);
  if (!match) return;

  const allPlayers = [...(match.teamA || []), ...(match.teamB || [])].map(resolveNick);
  const me = currentNick();
  if (!allPlayers.includes(me)) {
    alert('Nisi sudjelovao u ovoj utakmici.');
    return;
  }

  _ratingMatch = { date: matchDate, allPlayers };
  const others = allPlayers.filter(n => n !== me);

  const body = document.getElementById('rating-modal-body');
  body.innerHTML = others.map(name => {
    const alreadyRated = DB.hasRated(matchDate, me, name);
    return `
      <div class="rate-player-card" data-rpc="${escAttr(name)}">
        <div class="rpc-header">
          <div class="rpc-avatar">${escHtml(name.charAt(0).toUpperCase())}</div>
          <span class="rpc-name">${escHtml(name)}</span>
          ${alreadyRated ? '<span class="rpc-done">Ocijenjeno</span>' : ''}
        </div>
        ${alreadyRated ? '' : renderStarInputs(name)}
      </div>`;
  }).join('');

  document.getElementById('rating-modal').classList.remove('hidden');
}

function renderStarInputs(playerName) {
  return `<div class="rpc-cats">
    ${RATING_CATS.map(c => `
      <div class="rpc-row">
        <span class="rpc-label">${escHtml(c.label)}</span>
        <div class="star-row" data-player="${escAttr(playerName)}" data-cat="${escAttr(c.key)}">
          ${[1,2,3,4,5].map(v => `<span class="star" data-val="${v}">★</span>`).join('')}
        </div>
      </div>`).join('')}
    <button class="btn-rate-submit" data-rate-player="${escAttr(playerName)}">Spremi ocjenu</button>
    <p class="rate-note" data-rate-note="${escAttr(playerName)}"></p>
  </div>`;
}

function pickStar(el) {
  const row = el.parentElement;
  const val = parseInt(el.dataset.val);
  row.querySelectorAll('.star').forEach(s => {
    s.classList.toggle('active', parseInt(s.dataset.val) <= val);
  });
  row.dataset.selected = val;
}

function submitPlayerRating(playerName) {
  if (!_ratingMatch) return;
  const me = currentNick();
  if (DB.hasRated(_ratingMatch.date, me, playerName)) return;

  const scores = {};
  let allFilled = true;
  RATING_CATS.forEach(c => {
    const row = document.querySelector(`.star-row[data-player="${playerName}"][data-cat="${c.key}"]`);
    const val = parseInt(row?.dataset.selected);
    if (!val) allFilled = false;
    scores[c.key] = val || 0;
  });

  if (!allFilled) {
    const note = document.querySelector(`[data-rate-note="${playerName}"]`);
    note.textContent = 'Odaberi ocjenu za svaku kategoriju.';
    note.className = 'rate-note error';
    return;
  }

  DB.addRating({
    matchDate: _ratingMatch.date,
    rater: me,
    rated: playerName,
    scores,
  });

  // Replace card with "done" state
  const card = document.querySelector(`[data-rpc="${playerName}"]`);
  card.innerHTML = `
    <div class="rpc-header">
      <div class="rpc-avatar">${escHtml(playerName.charAt(0).toUpperCase())}</div>
      <span class="rpc-name">${escHtml(playerName)}</span>
      <span class="rpc-done">Ocijenjeno</span>
    </div>`;
}

function closeRatingModal() {
  document.getElementById('rating-modal').classList.add('hidden');
  _ratingMatch = null;
}

// ── Player profile with radar chart ───────────────────────────────────────

function openPlayerProfile(playerName) {
  const avgs = DB.getPlayerAvgRatings(playerName);
  const body = document.getElementById('profile-body');
  const form = calcPlayerForm(playerName);
  document.getElementById('profile-title').textContent = playerName;

  // Forma sekcija — uvijek vidljiva
  const formHtml = `
    <div class="prof-form-row">
      <div class="prof-form-info">
        <span class="prof-form-label">Forma ${formIcon(form)}</span>
        <span class="prof-form-desc">${formLabel(form)}</span>
      </div>
      <div class="prof-form-bar-wrap">
        <div class="prof-form-bar" style="width:${(form / 5) * 100}%;background:${formColor(form)}"></div>
      </div>
      <span class="prof-form-val" style="color:${formColor(form)}">${form.toFixed(1)}</span>
    </div>`;

  if (!avgs) {
    body.innerHTML = `
      <div class="prof-card">
        <div class="prof-header">
          <div class="prof-avatar">${escHtml(playerName.charAt(0).toUpperCase())}</div>
          <div class="prof-info">
            <div class="prof-name">${escHtml(playerName)}</div>
            <div class="prof-meta">Nema ocjena</div>
          </div>
        </div>
        ${formHtml}
        <div class="empty-state" style="padding:14px 0">Još nema ocjena za radar graf.</div>
      </div>`;
    document.getElementById('player-profile').classList.remove('hidden');
    return;
  }

  const radarSvg = renderRadarChart(avgs);
  const catRows  = RATING_CATS.map(c =>
    `<div class="prof-stat-row">
      <span class="prof-stat-label">${c.label}</span>
      <div class="prof-stat-bar-wrap">
        <div class="prof-stat-bar" style="width:${(avgs[c.key] / 5) * 100}%"></div>
      </div>
      <span class="prof-stat-val">${avgs[c.key].toFixed(1)}</span>
    </div>`
  ).join('');

  body.innerHTML = `
    <div class="prof-card">
      <div class="prof-header">
        <div class="prof-avatar">${escHtml(playerName.charAt(0).toUpperCase())}</div>
        <div class="prof-info">
          <div class="prof-name">${escHtml(playerName)}</div>
          <div class="prof-meta">${avgs._count} ocjen${avgs._count === 1 ? 'a' : avgs._count < 5 ? 'e' : 'a'}</div>
        </div>
      </div>
      ${formHtml}
      <div class="prof-radar-wrap">${radarSvg}</div>
      <div class="prof-stats">${catRows}</div>
    </div>`;

  document.getElementById('player-profile').classList.remove('hidden');
}

function closePlayerProfile() {
  document.getElementById('player-profile').classList.add('hidden');
}

function renderRadarChart(avgs) {
  const size = 240, cx = size / 2, cy = size / 2, R = 90;
  const cats = RATING_CATS;
  const n = cats.length;

  // Compute polygon points for each ring (1–5)
  function polyPoints(radius) {
    return cats.map((_, i) => {
      const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
      return `${cx + radius * Math.cos(angle)},${cy + radius * Math.sin(angle)}`;
    }).join(' ');
  }

  // Grid rings
  const rings = [1,2,3,4,5].map(v => {
    const r = (v / 5) * R;
    return `<polygon points="${polyPoints(r)}" fill="none" stroke="rgba(94,138,94,${v === 5 ? 0.4 : 0.15})" stroke-width="${v === 5 ? 1.5 : 1}"/>`;
  }).join('');

  // Axis lines
  const axes = cats.map((_, i) => {
    const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
    const x2 = cx + R * Math.cos(angle);
    const y2 = cy + R * Math.sin(angle);
    return `<line x1="${cx}" y1="${cy}" x2="${x2}" y2="${y2}" stroke="rgba(94,138,94,0.2)" stroke-width="1"/>`;
  }).join('');

  // Data polygon
  const dataPoints = cats.map((c, i) => {
    const val   = avgs[c.key] || 0;
    const r     = (val / 5) * R;
    const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
    return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
  }).join(' ');

  // Labels
  const labels = cats.map((c, i) => {
    const angle  = (i / n) * 2 * Math.PI - Math.PI / 2;
    const lr     = R + 18;
    const lx     = cx + lr * Math.cos(angle);
    const ly     = cy + lr * Math.sin(angle);
    const anchor = Math.abs(Math.cos(angle)) < 0.1 ? 'middle' : Math.cos(angle) > 0 ? 'start' : 'end';
    return `<text x="${lx}" y="${ly + 4}" text-anchor="${anchor}" fill="#5e8a5e" font-size="9" font-weight="600">${c.label}</text>`;
  }).join('');

  return `<svg viewBox="0 0 ${size} ${size}" class="radar-svg">
    ${rings}${axes}
    <polygon points="${dataPoints}" fill="rgba(48,147,58,0.25)" stroke="#30933a" stroke-width="2"/>
    ${cats.map((c, i) => {
      const val   = avgs[c.key] || 0;
      const r     = (val / 5) * R;
      const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
      return `<circle cx="${cx + r * Math.cos(angle)}" cy="${cy + r * Math.sin(angle)}" r="3.5" fill="#30933a" stroke="#d8ecd8" stroke-width="1.5"/>`;
    }).join('')}
    ${labels}
  </svg>`;
}

// ── My profile ────────────────────────────────────────────────────────────

function openMyProfile() {
  const user = currentUser();
  const nick = user.nick;
  const email = user.email || '';
  const body = document.getElementById('my-profile-body');

  // Avatar
  const isGoogle = state.authMode === 'google' && state.googleUser;
  const avatarHtml = isGoogle && state.googleUser.picture
    ? `<img class="prof-avatar-img" src="${escAttr(state.googleUser.picture)}" alt="">`
    : `<div class="prof-avatar">${escHtml(nick.charAt(0).toUpperCase())}</div>`;

  // Stats
  const history = DB.getHistory();
  const allStats = calcPlayerStats(history);
  const myStats = allStats.find(s => s.name === nick);

  let statsHtml = '';
  if (myStats) {
    statsHtml = `
      <div class="my-prof-stats">
        <div class="my-prof-stat"><span class="my-prof-stat-label">GP</span><span class="my-prof-stat-val">${myStats.gp}</span></div>
        <div class="my-prof-stat"><span class="my-prof-stat-label">W</span><span class="my-prof-stat-val my-prof-w">${myStats.w}</span></div>
        <div class="my-prof-stat"><span class="my-prof-stat-label">D</span><span class="my-prof-stat-val">${myStats.d}</span></div>
        <div class="my-prof-stat"><span class="my-prof-stat-label">L</span><span class="my-prof-stat-val my-prof-l">${myStats.l}</span></div>
        <div class="my-prof-stat"><span class="my-prof-stat-label">Bod</span><span class="my-prof-stat-val my-prof-pts">${myStats.pts}</span></div>
      </div>`;
  }

  // Form (forma)
  const form = calcPlayerForm(nick);
  const formHtml = `
    <div class="prof-form-row">
      <div class="prof-form-info">
        <span class="prof-form-label">Forma ${formIcon(form)}</span>
        <span class="prof-form-desc">${formLabel(form)}</span>
      </div>
      <div class="prof-form-bar-wrap">
        <div class="prof-form-bar" style="width:${(form / 5) * 100}%;background:${formColor(form)}"></div>
      </div>
      <span class="prof-form-val" style="color:${formColor(form)}">${form.toFixed(1)}</span>
    </div>`;

  // Radar chart
  const avgs = DB.getPlayerAvgRatings(nick);
  let radarHtml = '';
  if (avgs) {
    radarHtml = `
      <div class="prof-radar-wrap">${renderRadarChart(avgs)}</div>
      <div class="prof-stats">
        ${RATING_CATS.map(c =>
          `<div class="prof-stat-row">
            <span class="prof-stat-label">${c.label}</span>
            <div class="prof-stat-bar-wrap">
              <div class="prof-stat-bar" style="width:${(avgs[c.key] / 5) * 100}%"></div>
            </div>
            <span class="prof-stat-val">${avgs[c.key].toFixed(1)}</span>
          </div>`
        ).join('')}
      </div>`;
  }

  body.innerHTML = `
    <div class="prof-card">
      <div class="prof-header">
        ${avatarHtml}
        <div class="prof-info">
          <div class="prof-meta">${escHtml(email)}</div>
        </div>
      </div>
      <div class="my-prof-nick-row">
        <label class="my-prof-nick-label">Nick</label>
        <div class="my-prof-nick-form">
          <input type="text" id="my-prof-nick-input" class="my-prof-nick-input" value="${escAttr(nick)}" maxlength="20">
          <button class="btn-admin" data-action="save-my-profile">Spremi</button>
        </div>
        <p class="my-prof-note" id="my-prof-note"></p>
      </div>
      ${statsHtml}
      ${formHtml}
      ${radarHtml}
    </div>`;

  document.getElementById('my-profile').classList.remove('hidden');
}

function closeMyProfile() {
  document.getElementById('my-profile').classList.add('hidden');
}

function saveMyProfile() {
  const input = document.getElementById('my-prof-nick-input');
  const note = document.getElementById('my-prof-note');
  const newNick = (input.value || '').trim();

  if (!newNick) {
    note.textContent = 'Nick ne može biti prazan.';
    note.className = 'my-prof-note error';
    return;
  }

  if (newNick.length > 20) {
    note.textContent = 'Nick može imati max 20 znakova.';
    note.className = 'my-prof-note error';
    return;
  }

  const user = currentUser();
  const oldNick = user.nick;

  // Provjeri duplikat
  if (newNick !== oldNick && state.users.some(u => u.nick === newNick)) {
    note.textContent = 'Taj nick je već zauzet.';
    note.className = 'my-prof-note error';
    return;
  }

  if (newNick === oldNick) {
    note.textContent = 'Ništa za promijeniti.';
    note.className = 'my-prof-note';
    return;
  }

  // Ažuriraj DB
  DB.updateUser(user.email, { nick: newNick });

  // Ažuriraj in-memory state
  state.users = DB.getUsers();

  // Ažuriraj prijavljene igrače ako je user prijavljen
  const playerEntry = state.players.find(p => p.name === oldNick);
  if (playerEntry) {
    playerEntry.name = newNick;
    DB.savePlayers(state.players);
  }

  // Ažuriraj header UI
  if (state.authMode === 'google') {
    document.getElementById('google-nick').textContent = newNick;
  } else {
    document.getElementById('mock-nick').textContent = newNick;
    document.getElementById('mock-avatar').textContent = newNick.charAt(0).toUpperCase();
  }
  document.getElementById('reg-nick').textContent = newNick;
  document.getElementById('reg-avatar').textContent = newNick.charAt(0).toUpperCase();

  note.textContent = 'Nick spremljen!';
  note.className = 'my-prof-note success';
  clearTimeout(note._t);
  note._t = setTimeout(() => { note.textContent = ''; note.className = 'my-prof-note'; }, 3000);

  render();
  renderHistory();
}

// ── Team comparison ────────────────────────────────────────────────────────

function renderTeamComparison(teamA, teamB, allStats) {
  const el = document.getElementById('team-comparison');

  function teamAgg(players) {
    let gp = 0, w = 0, d = 0, l = 0, pts = 0, ratingSum = 0, ratingCount = 0, formSum = 0;
    players.forEach(p => {
      const s = allStats.find(st => st.name === p.name);
      if (s) { gp += s.gp; w += s.w; d += s.d; l += s.l; pts += s.pts; }
      const ov = getPlayerOverall(p.name);
      if (ov != null) { ratingSum += ov; ratingCount++; }
      formSum += calcPlayerForm(p.name);
    });
    return {
      gp, w, d, l, pts,
      rating: ratingCount > 0 ? ratingSum / ratingCount : null,
      form: players.length > 0 ? formSum / players.length : 0,
    };
  }

  const a = teamAgg(teamA);
  const b = teamAgg(teamB);

  const rows = [
    { label: 'GP',   va: a.gp,  vb: b.gp },
    { label: 'W',    va: a.w,   vb: b.w },
    { label: 'D',    va: a.d,   vb: b.d },
    { label: 'L',    va: a.l,   vb: b.l },
    { label: 'Bod',  va: a.pts, vb: b.pts },
    { label: '★',    va: a.rating, vb: b.rating, decimal: true },
    { label: 'Forma', va: a.form, vb: b.form, decimal: true, icon: true },
  ];

  let html = `<div class="tc-header">
    <span class="tc-team tc-team-a">Tim A</span>
    <span class="tc-vs">VS</span>
    <span class="tc-team tc-team-b">Tim B</span>
  </div>`;

  rows.forEach(r => {
    const va = r.va != null ? r.va : 0;
    const vb = r.vb != null ? r.vb : 0;
    const max = Math.max(va, vb, 0.1);
    const pctA = (va / max) * 100;
    const pctB = (vb / max) * 100;
    const fmtA = r.decimal ? (r.va != null ? r.va.toFixed(1) : '–') : va;
    const fmtB = r.decimal ? (r.vb != null ? r.vb.toFixed(1) : '–') : vb;
    const iconA = r.icon ? ' ' + formIcon(va) : '';
    const iconB = r.icon ? ' ' + formIcon(vb) : '';

    html += `<div class="tc-row">
      <span class="tc-label">${r.label}</span>
      <span class="tc-val tc-val-a">${fmtA}${iconA}</span>
      <div class="tc-bars">
        <div class="tc-bar-wrap tc-bar-wrap-a"><div class="tc-bar tc-bar-a" style="width:${pctA}%"></div></div>
        <div class="tc-bar-wrap tc-bar-wrap-b"><div class="tc-bar tc-bar-b" style="width:${pctB}%"></div></div>
      </div>
      <span class="tc-val tc-val-b">${fmtB}${iconB}</span>
    </div>`;
  });

  el.innerHTML = html;
  el.classList.remove('hidden');
}

// ── Dynamic pitch positions ────────────────────────────────────────────────

function generatePositions(n) {
  const positions = { a: [], b: [] };
  if (n <= 0) return positions;
  if (n === 1) {
    positions.a = [{ x: 125, y: 160 }];
    positions.b = [{ x: 375, y: 160 }];
    return positions;
  }
  // GK + outfield spread vertically
  positions.a.push({ x: 33, y: 160 });
  positions.b.push({ x: 467, y: 160 });
  const outfield = n - 1;
  for (let i = 0; i < outfield; i++) {
    const ySpread = 240 / (outfield + 1);
    const y = 40 + ySpread * (i + 1);
    positions.a.push({ x: 100 + (i % 2) * 60, y });
    positions.b.push({ x: 400 - (i % 2) * 60, y });
  }
  return positions;
}

// ── Utils ──────────────────────────────────────────────────────────────────

function svgEl(tag) { return document.createElementNS('http://www.w3.org/2000/svg', tag); }
function trunc(s, n) { return s.length > n ? s.slice(0, n - 1) + '.' : s; }
function uid()       { return Math.random().toString(36).slice(2); }

// ── Start ──────────────────────────────────────────────────────────────────

init();
