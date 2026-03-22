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

    // Prosječna ocjena
    const avgData = DB.getPlayerAvgRatings(player.name);
    if (avgData) {
      const cats = ['tehnika', 'brzina', 'izdrzljivost', 'timska', 'pozicioniranje'];
      const overall = cats.reduce((s, c) => s + (avgData[c] || 0), 0) / cats.length;
      const rating = document.createElement('span');
      rating.className = 'player-rating clickable';
      rating.textContent = `★ ${overall.toFixed(1)}`;
      rating.title = 'Pogledaj profil';
      rating.onclick = (e) => { e.stopPropagation(); openPlayerProfile(player.name); };
      chip.appendChild(rating);
    }

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

function historyItemCompact(m) {
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
}

function historyItemFull(m) {
  const date     = new Date(m.date).toLocaleDateString('hr-HR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const diff     = m.scoreA - m.scoreB;
  const outcome  = diff > 0 ? 'win-a' : diff < 0 ? 'win-b' : 'draw';
  const label    = diff > 0 ? 'Tim A pobijedio' : diff < 0 ? 'Tim B pobijedio' : 'Neriješeno';
  const teamA    = (m.teamA || []);
  const teamB    = (m.teamB || []);
  return `
    <div class="hf-card">
      <div class="hf-header">
        <span class="hf-date">${date}</span>
        <span class="hf-venue">${m.field} · ${m.time}</span>
      </div>
      <div class="hf-score-row">
        <span class="hf-team-label ${outcome === 'win-a' ? 'hf-winner' : ''}">Tim A</span>
        <span class="hf-score">${m.scoreA} – ${m.scoreB}</span>
        <span class="hf-team-label ${outcome === 'win-b' ? 'hf-winner' : ''}">Tim B</span>
      </div>
      <div class="hf-outcome ${outcome}">${label}</div>
      <div class="hf-rosters">
        <div class="hf-roster">
          ${teamA.map(n => `<span class="hf-player clickable" onclick="openPlayerProfile('${n}')">${n}</span>`).join('')}
        </div>
        <div class="hf-roster hf-roster-right">
          ${teamB.map(n => `<span class="hf-player clickable" onclick="openPlayerProfile('${n}')">${n}</span>`).join('')}
        </div>
      </div>
      <button class="btn-rate-match" onclick="openRatingModal('${m.date}')">⭐ Ocijeni igrače</button>
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
    (m.teamA || []).forEach(name => {
      if (!stats[name]) stats[name] = { w: 0, d: 0, l: 0, gp: 0 };
      stats[name].gp++;
      if (diff > 0) stats[name].w++;
      else if (diff === 0) stats[name].d++;
      else stats[name].l++;
    });
    (m.teamB || []).forEach(name => {
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
          </tr>
        </thead>
        <tbody>
          ${rows.map((r, i) => `
            <tr${i === 0 ? ' class="st-first"' : ''}>
              <td class="st-pos">${i + 1}.</td>
              <td class="st-name clickable" onclick="openPlayerProfile('${r.name}')">${r.name}</td>
              <td class="st-num">${r.w}</td>
              <td class="st-num">${r.d}</td>
              <td class="st-num">${r.l}</td>
              <td class="st-num">${r.gp}</td>
              <td class="st-num st-pts">${r.pts}</td>
            </tr>`).join('')}
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

  const allPlayers = [...(match.teamA || []), ...(match.teamB || [])];
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
      <div class="rate-player-card" id="rpc-${name}">
        <div class="rpc-header">
          <div class="rpc-avatar">${name.charAt(0).toUpperCase()}</div>
          <span class="rpc-name">${name}</span>
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
        <span class="rpc-label">${c.label}</span>
        <div class="star-row" data-player="${playerName}" data-cat="${c.key}">
          ${[1,2,3,4,5].map(v => `<span class="star" data-val="${v}" onclick="pickStar(this)">★</span>`).join('')}
        </div>
      </div>`).join('')}
    <button class="btn-rate-submit" onclick="submitPlayerRating('${playerName}')">Spremi ocjenu</button>
    <p class="rate-note" id="rate-note-${playerName}"></p>
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
    const note = document.getElementById(`rate-note-${playerName}`);
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
  const card = document.getElementById(`rpc-${playerName}`);
  card.innerHTML = `
    <div class="rpc-header">
      <div class="rpc-avatar">${playerName.charAt(0).toUpperCase()}</div>
      <span class="rpc-name">${playerName}</span>
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
  document.getElementById('profile-title').textContent = playerName;

  if (!avgs) {
    body.innerHTML = '<div class="empty-state">Nema ocjena za ovog igrača.</div>';
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
        <div class="prof-avatar">${playerName.charAt(0).toUpperCase()}</div>
        <div class="prof-info">
          <div class="prof-name">${playerName}</div>
          <div class="prof-meta">${avgs._count} ocjen${avgs._count === 1 ? 'a' : avgs._count < 5 ? 'e' : 'a'}</div>
        </div>
      </div>
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

// ── Utils ──────────────────────────────────────────────────────────────────

function svgEl(tag) { return document.createElementNS('http://www.w3.org/2000/svg', tag); }
function trunc(s, n) { return s.length > n ? s.slice(0, n - 1) + '.' : s; }
function uid()       { return Math.random().toString(36).slice(2); }

// ── Start ──────────────────────────────────────────────────────────────────

init();
