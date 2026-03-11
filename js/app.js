'use strict';

// ── In-memory state (učitan iz DB na init) ─────────────────────────────────
const state = {
  users:       [],  // whitelist — iz DB.getUsers()
  session:     {},  // tekuća sesija — iz DB.getSession()
  players:     [],  // prijavljeni — iz DB.getPlayers()
  mockUserIdx: 0,   // koji je "korisnik" aktivan (UI simulacija, ne perzistira)
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

// ── Helpers ────────────────────────────────────────────────────────────────

function currentUser()  { return state.users[state.mockUserIdx] || state.users[0]; }
function currentNick()  { return currentUser().nick; }
function isAdmin()      { return currentUser().role === 'admin'; }
function sessionOpen()  { return state.session.status === 'open'; }

function getActiveCount() {
  const n = state.players.length;
  if (n >= 10) return 10;
  if (n >= 8)  return 8;
  return 0;
}

// ── Init ───────────────────────────────────────────────────────────────────

async function init() {
  await DB.init();

  state.users   = DB.getUsers();
  state.session = DB.getSession();
  state.players = DB.getPlayers();

  renderNextWednesday();
  renderRegistrationStatus();
  updateMockUserUI();
  updateRegCard();
  render();
  renderHistory();

  document.addEventListener('click', e => {
    if (!e.target.closest('.cs')) closeAllCs();
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
      available.map(u => `<option value="${u.nick}">${u.nick}</option>`).join('')
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
    teamA:  state.players.filter(p => p.team === 'a').map(p => p.name),
    teamB:  state.players.filter(p => p.team === 'b').map(p => p.name),
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
  drawBtn.classList.toggle('hidden', !isAdmin() || count < 8);

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

    const av = document.createElement('div');
    av.className   = 'player-avatar';
    av.textContent = player.name.charAt(0).toUpperCase();

    const nm = document.createElement('span');
    nm.className   = 'player-name';
    nm.textContent = player.name;

    chip.appendChild(av);
    chip.appendChild(nm);

    if (player.team && !onBench) {
      const tag = document.createElement('span');
      tag.className   = 'player-team-tag';
      tag.textContent = player.team.toUpperCase();
      chip.appendChild(tag);
    }
    if (onBench) {
      const tag = document.createElement('span');
      tag.className   = 'player-team-tag bench-tag';
      tag.textContent = 'čeka';
      chip.appendChild(tag);
    }

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
    return;
  }

  const teamA = state.players.filter(p => p.team === 'a');
  const teamB = state.players.filter(p => p.team === 'b');
  const pos   = POSITIONS[teamA.length] || POSITIONS[5];

  teamA.forEach((p, i) => { if (i < pos.a.length) drawPlayerMarker(container, p, pos.a[i].x, pos.a[i].y, 'rg-gold'); });
  teamB.forEach((p, i) => { if (i < pos.b.length) drawPlayerMarker(container, p, pos.b[i].x, pos.b[i].y, 'rg-blue'); });

  hint.textContent = `${state.session.markerTeam === 'a' ? 'Tim A' : 'Tim B'} donosi markere.`;
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

function drawPlayerMarker(container, player, x, y, gradId) {
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

  const name = trunc(player.name, 8);
  const lw   = Math.max(26, name.length * 5.0 + 8);
  const lx   = x - lw / 2;
  const ly   = y + 12;

  const labelBg = svgEl('rect');
  labelBg.setAttribute('x', lx);
  labelBg.setAttribute('y', ly);
  labelBg.setAttribute('width', lw);
  labelBg.setAttribute('height', 11);
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
  container.appendChild(g);
}

// ── History ────────────────────────────────────────────────────────────────

function renderHistory() {
  const list    = document.getElementById('history-list');
  const history = DB.getHistory();

  if (!history.length) {
    list.innerHTML = '<div class="empty-state">Nema zapisanih rezultata.</div>';
    return;
  }

  list.innerHTML = history.map(m => {
    const date     = new Date(m.date).toLocaleDateString('hr-HR', { day: 'numeric', month: 'numeric', year: 'numeric' });
    const diff     = m.scoreA - m.scoreB;
    const outcome  = diff > 0 ? 'win-a' : diff < 0 ? 'win-b' : 'draw';
    const label    = diff > 0 ? 'Tim A pobijedio' : diff < 0 ? 'Tim B pobijedio' : 'Neriješeno';
    const playersA = (m.teamA || []).join(', ') || '—';
    const playersB = (m.teamB || []).join(', ') || '—';
    return `
      <div class="history-item">
        <div class="history-meta">${date} · ${m.field} · ${m.time}</div>
        <div class="history-score">
          <div class="hs-side">
            <span class="hs-team ${outcome === 'win-a' ? 'hs-winner' : ''}">Tim A</span>
            <span class="hs-players">${playersA}</span>
          </div>
          <span class="hs-num">${m.scoreA} – ${m.scoreB}</span>
          <div class="hs-side hs-side-right">
            <span class="hs-team ${outcome === 'win-b' ? 'hs-winner' : ''}">Tim B</span>
            <span class="hs-players">${playersB}</span>
          </div>
        </div>
        <div class="history-outcome ${outcome}">${label}</div>
      </div>`;
  }).join('');
}

// ── Utils ──────────────────────────────────────────────────────────────────

function svgEl(tag) { return document.createElementNS('http://www.w3.org/2000/svg', tag); }
function trunc(s, n) { return s.length > n ? s.slice(0, n - 1) + '.' : s; }
function uid()       { return Math.random().toString(36).slice(2); }

// ── Start ──────────────────────────────────────────────────────────────────

init();
