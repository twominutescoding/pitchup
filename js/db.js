/**
 * db.js — Apstrakcijski sloj za perzistenciju podataka
 *
 * Trenutno: localStorage (radi i offline, preživljava refresh)
 * Budućnost: zamijeniti read/write metode s Google Sheets API pozivima
 *
 * Ključevi u localStorage:
 *   nfg_users   → whitelist igrača s rolama
 *   nfg_session → stanje tekuće sesije (otvorena/zatvorena, žrijeb, markeri)
 *   nfg_players → prijavljeni igrači za tekuću srijedu
 *   nfg_history → povijest rezultata
 */

const DB = (() => {

  const KEYS = {
    users:   'nfg_users',
    session: 'nfg_session',
    players: 'nfg_players',
    history: 'nfg_history',
  };

  // Fallback seed podaci — koriste se kad fetch ne radi (file:// protokol)
  // Na GitHub Pages fetch će učitati prave JSON datoteke iz /data/
  const SEED_USERS = [
    { nick: 'LukaB',   role: 'admin', email: 'luka.b@gmail.com'   },
    { nick: 'Marko10', role: 'user',  email: 'marko10@gmail.com'  },
    { nick: 'Tomo',    role: 'user',  email: 'tomo@gmail.com'     },
    { nick: 'IvanGol', role: 'user',  email: 'ivan.gol@gmail.com' },
    { nick: 'JojoK',   role: 'user',  email: 'jojo.k@gmail.com'   },
    { nick: 'Dino',    role: 'user',  email: 'dino@gmail.com'     },
    { nick: 'Pero',    role: 'user',  email: 'pero@gmail.com'     },
    { nick: 'Ante',    role: 'user',  email: 'ante@gmail.com'     },
    { nick: 'Zvone',   role: 'user',  email: 'zvone@gmail.com'    },
    { nick: 'Kreso',   role: 'user',  email: 'kreso@gmail.com'    },
  ];

  const SEED_HISTORY = [
    {
      date: '2026-03-04', field: 'Velesajam 2', time: '19–20h',
      scoreA: 5, scoreB: 4,
      teamA: ['LukaB', 'Tomo', 'Pero', 'Zvone'],
      teamB: ['Marko10', 'IvanGol', 'Dino', 'Ante'],
    },
    {
      date: '2026-02-26', field: 'Velesajam 2', time: '19–20h',
      scoreA: 3, scoreB: 3,
      teamA: ['LukaB', 'Marko10', 'JojoK', 'Kreso', 'Tomo'],
      teamB: ['IvanGol', 'Dino', 'Pero', 'Ante', 'Zvone'],
    },
    {
      date: '2026-02-19', field: 'Špansko', time: '19–20h',
      scoreA: 2, scoreB: 6,
      teamA: ['LukaB', 'Tomo', 'IvanGol', 'Kreso', 'Pero'],
      teamB: ['Marko10', 'JojoK', 'Dino', 'Ante', 'Zvone'],
    },
  ];

  const DEFAULT_SESSION = {
    status:     'closed', // 'closed' | 'open'
    date:       null,
    field:      'Velesajam 2',
    time:       '19–20h',
    teamsDrawn: false,
    markerTeam: null,
  };

  // ── Interni helpers ──────────────────────────────────────────────────────

  function load(key) {
    try   { return JSON.parse(localStorage.getItem(key)); }
    catch { return null; }
  }

  function save(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  async function fetchJSON(path, fallback) {
    try {
      const r = await fetch(path);
      if (!r.ok) throw new Error();
      return await r.json();
    } catch {
      console.info(`DB: fetch('${path}') nije uspio, koristim seed data.`);
      return fallback;
    }
  }

  // ── Javno sučelje ────────────────────────────────────────────────────────

  return {

    /**
     * Inicijalizacija — poziva se jednom na startu.
     * Puni localStorage iz JSON datoteka (ili seed fallbacka) ako je prazan.
     */
    async init() {
      if (!load(KEYS.users)) {
        const users = await fetchJSON('data/users.json', SEED_USERS);
        save(KEYS.users, users);
      }
      if (!load(KEYS.history)) {
        const history = await fetchJSON('data/history.json', SEED_HISTORY);
        save(KEYS.history, history);
      }
      if (!load(KEYS.session)) {
        save(KEYS.session, DEFAULT_SESSION);
      }
      if (!load(KEYS.players)) {
        save(KEYS.players, []);
      }
    },

    // ── Getteri ────────────────────────────────────────────────────────────

    getUsers()   { return load(KEYS.users)   ?? SEED_USERS; },
    getSession() { return load(KEYS.session) ?? { ...DEFAULT_SESSION }; },
    getPlayers() { return load(KEYS.players) ?? []; },
    getHistory() { return load(KEYS.history) ?? []; },

    // ── Setteri ────────────────────────────────────────────────────────────

    saveSession(s) { save(KEYS.session, s); },
    savePlayers(p) { save(KEYS.players, p); },

    addResult(result) {
      const history = this.getHistory();
      history.unshift(result);
      save(KEYS.history, history);
      return history;
    },

    // ── Dev alat: resetira sve na seed podatke ─────────────────────────────
    // Pozovi iz konzole: DB.reset()
    async reset() {
      Object.values(KEYS).forEach(k => localStorage.removeItem(k));
      await this.init();
      console.info('DB resetiran na seed podatke. Refreshaj stranicu.');
    },

  };

})();
