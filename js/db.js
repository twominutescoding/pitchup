/**
 * db.js — Apstrakcijski sloj za perzistenciju podataka
 *
 * Backend: Firebase Firestore s real-time listenerima
 * Fallback: localStorage (offline / file:// protokol)
 *
 * Firestore kolekcije:
 *   users    → whitelist igrača s rolama (doc ID = email)
 *   config   → session doc (doc ID = "session")
 *   players  → prijavljeni igrači (doc ID = player id)
 *   history  → povijest rezultata (doc ID = auto)
 *   ratings  → ocjene igrača (doc ID = auto)
 *
 * Javno sučelje ostaje identično — getteri, setteri, subscribe.
 */

const DB = (() => {

  // ── localStorage ključevi (fallback / cache) ────────────────────────────
  const KEYS = {
    users:   'nfg_users',
    session: 'nfg_session',
    players: 'nfg_players',
    history: 'nfg_history',
    ratings: 'nfg_ratings',
  };

  // Fallback seed podaci
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
    status:     'closed',
    date:       null,
    field:      'Velesajam 2',
    time:       '19–20h',
    teamsDrawn: false,
    markerTeam: null,
  };

  // ── State ───────────────────────────────────────────────────────────────

  let _db = null;          // Firestore instance
  let _useFirestore = false;
  let _subscribers = [];   // callback funkcije za re-render
  let _unsubscribers = []; // Firestore onSnapshot unsubscribe funkcije

  // In-memory cache (populira se iz Firestore listenera ili localStorage)
  let _cache = {
    users:   null,
    session: null,
    players: null,
    history: null,
    ratings: null,
  };

  // ── localStorage helpers ────────────────────────────────────────────────

  function lsLoad(key) {
    try   { return JSON.parse(localStorage.getItem(key)); }
    catch { return null; }
  }

  function lsSave(key, value) {
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

  // ── Firestore helpers ───────────────────────────────────────────────────

  function initFirestore() {
    try {
      if (typeof firebase === 'undefined' || !firebase.firestore) return false;
      if (!firebase.apps.length) {
        firebase.initializeApp(FIREBASE_CONFIG);
      }
      _db = firebase.firestore();
      // Omogući offline persistence (radi i bez interneta)
      _db.enablePersistence({ synchronizeTabs: true }).catch(err => {
        if (err.code !== 'failed-precondition' && err.code !== 'unimplemented') {
          console.warn('Firestore persistence:', err);
        }
      });
      return true;
    } catch (e) {
      console.warn('Firestore init neuspješan, koristim localStorage:', e);
      return false;
    }
  }

  // Seeda Firestore ako su kolekcije prazne
  async function seedFirestore() {
    // Users
    const usersSnap = await _db.collection('users').limit(1).get();
    if (usersSnap.empty) {
      const users = await fetchJSON('data/users.json', SEED_USERS);
      const batch = _db.batch();
      users.forEach(u => {
        batch.set(_db.collection('users').doc(u.email), u);
      });
      await batch.commit();
      console.info('DB: Firestore users seeded');
    }

    // Session
    const sessionDoc = await _db.doc('config/session').get();
    if (!sessionDoc.exists) {
      await _db.doc('config/session').set(DEFAULT_SESSION);
      console.info('DB: Firestore session seeded');
    }

    // History
    const histSnap = await _db.collection('history').limit(1).get();
    if (histSnap.empty) {
      const history = await fetchJSON('data/history.json', SEED_HISTORY);
      const batch = _db.batch();
      history.forEach(h => {
        batch.set(_db.collection('history').doc(), h);
      });
      await batch.commit();
      console.info('DB: Firestore history seeded');
    }

    // Players i ratings — prazne kolekcije, ne treba seed
  }

  function notifySubscribers() {
    _subscribers.forEach(fn => {
      try { fn(); } catch (e) { console.error('DB subscriber error:', e); }
    });
  }

  function setupListeners() {
    // Users
    _unsubscribers.push(
      _db.collection('users').onSnapshot(snap => {
        _cache.users = snap.docs.map(d => d.data());
        lsSave(KEYS.users, _cache.users);
        notifySubscribers();
      })
    );

    // Session
    _unsubscribers.push(
      _db.doc('config/session').onSnapshot(doc => {
        _cache.session = doc.exists ? doc.data() : { ...DEFAULT_SESSION };
        lsSave(KEYS.session, _cache.session);
        notifySubscribers();
      })
    );

    // Players
    _unsubscribers.push(
      _db.collection('players').onSnapshot(snap => {
        _cache.players = snap.docs.map(d => d.data());
        lsSave(KEYS.players, _cache.players);
        notifySubscribers();
      })
    );

    // History — sortiraj po datumu desc
    _unsubscribers.push(
      _db.collection('history').orderBy('date', 'desc').onSnapshot(snap => {
        _cache.history = snap.docs.map(d => d.data());
        lsSave(KEYS.history, _cache.history);
        notifySubscribers();
      })
    );

    // Ratings
    _unsubscribers.push(
      _db.collection('ratings').onSnapshot(snap => {
        _cache.ratings = snap.docs.map(d => d.data());
        lsSave(KEYS.ratings, _cache.ratings);
        notifySubscribers();
      })
    );
  }

  // ── localStorage-only init (fallback) ───────────────────────────────────

  async function initLocalStorage() {
    if (!lsLoad(KEYS.users)) {
      const users = await fetchJSON('data/users.json', SEED_USERS);
      lsSave(KEYS.users, users);
    }
    if (!lsLoad(KEYS.history)) {
      const history = await fetchJSON('data/history.json', SEED_HISTORY);
      lsSave(KEYS.history, history);
    }
    if (!lsLoad(KEYS.session)) {
      lsSave(KEYS.session, DEFAULT_SESSION);
    }
    if (!lsLoad(KEYS.players)) {
      lsSave(KEYS.players, []);
    }
    if (!lsLoad(KEYS.ratings)) {
      lsSave(KEYS.ratings, []);
    }

    // Popuni cache iz localStorage
    _cache.users   = lsLoad(KEYS.users);
    _cache.session = lsLoad(KEYS.session);
    _cache.players = lsLoad(KEYS.players);
    _cache.history = lsLoad(KEYS.history);
    _cache.ratings = lsLoad(KEYS.ratings);
  }

  // ── Javno sučelje ──────────────────────────────────────────────────────

  return {

    async init() {
      _useFirestore = initFirestore();

      if (_useFirestore) {
        // Popuni cache iz localStorage odmah (brz start dok Firestore učitava)
        _cache.users   = lsLoad(KEYS.users)   ?? SEED_USERS;
        _cache.session = lsLoad(KEYS.session) ?? { ...DEFAULT_SESSION };
        _cache.players = lsLoad(KEYS.players) ?? [];
        _cache.history = lsLoad(KEYS.history) ?? [];
        _cache.ratings = lsLoad(KEYS.ratings) ?? [];
        console.info('DB: Firestore inicijaliziran (čeka auth za listenere)');
      } else {
        await initLocalStorage();
        console.info('DB: localStorage fallback');
      }
    },

    /** Pozovi NAKON Firebase Auth login-a. Pokreće seed + real-time listenere. */
    async startListeners() {
      if (!_useFirestore || _unsubscribers.length > 0) return; // već pokrenuto
      try {
        await seedFirestore();
      } catch (e) {
        console.warn('DB: Seed nije uspio:', e.message);
      }
      // Dohvati users SINHRONO iz Firestore-a prije pokretanja listenera
      // — sprječava race condition kod whitelist checka
      try {
        const usersSnap = await _db.collection('users').get();
        _cache.users = usersSnap.docs.map(d => d.data());
        lsSave(KEYS.users, _cache.users);
      } catch (e) {
        console.warn('DB: Fetch users nije uspio:', e.message);
      }
      setupListeners();
      console.info('DB: Real-time listeneri pokrenuti');
    },

    // ── Getteri (čitaju iz in-memory cachea) ──────────────────────────────

    getUsers()   { return _cache.users   ?? SEED_USERS; },
    getSession() { return _cache.session ?? { ...DEFAULT_SESSION }; },
    getPlayers() { return _cache.players ?? []; },
    getHistory() { return _cache.history ?? []; },
    getRatings() { return _cache.ratings ?? []; },

    // ── Setteri ───────────────────────────────────────────────────────────

    saveSession(s) {
      _cache.session = s;
      lsSave(KEYS.session, s);
      if (_useFirestore) {
        _db.doc('config/session').set(s).catch(e => console.error('saveSession:', e));
      }
    },

    savePlayers(p) {
      _cache.players = p;
      lsSave(KEYS.players, p);
      if (_useFirestore) {
        // Batch: obriši sve pa postavi nove
        const col = _db.collection('players');
        col.get().then(snap => {
          const batch = _db.batch();
          snap.docs.forEach(d => batch.delete(d.ref));
          p.forEach(player => {
            batch.set(col.doc(player.id), player);
          });
          return batch.commit();
        }).catch(e => console.error('savePlayers:', e));
      }
    },

    addResult(result) {
      const history = this.getHistory();
      history.unshift(result);
      _cache.history = history;
      lsSave(KEYS.history, history);
      if (_useFirestore) {
        _db.collection('history').add(result).catch(e => console.error('addResult:', e));
      }
      return history;
    },

    addRating(rating) {
      const ratings = this.getRatings();
      ratings.push(rating);
      _cache.ratings = ratings;
      lsSave(KEYS.ratings, ratings);
      if (_useFirestore) {
        _db.collection('ratings').add(rating).catch(e => console.error('addRating:', e));
      }
    },

    hasRated(matchDate, rater, rated) {
      return this.getRatings().some(r =>
        r.matchDate === matchDate && r.rater === rater && r.rated === rated
      );
    },

    getPlayerAvgRatings(playerName) {
      const all = this.getRatings().filter(r => r.rated === playerName);
      if (!all.length) return null;
      const cats = ['tehnika', 'brzina', 'izdrzljivost', 'timska', 'pozicioniranje'];
      const avgs = {};
      cats.forEach(c => {
        const vals = all.map(r => r.scores[c]).filter(v => v != null);
        avgs[c] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      });
      avgs._count = all.length;
      return avgs;
    },

    // ── Real-time subscribe ──────────────────────────────────────────────

    /**
     * Registriraj callback koji se poziva kad se bilo koji podatak promijeni.
     * Koristi se umjesto pollinga — Firestore listeneri triggeraju ovo automatski.
     */
    subscribe(fn) {
      if (typeof fn === 'function') _subscribers.push(fn);
    },

    unsubscribe(fn) {
      _subscribers = _subscribers.filter(f => f !== fn);
    },

    // ── Dev alat ─────────────────────────────────────────────────────────

    async reset() {
      // Unsubscribe listenere
      _unsubscribers.forEach(unsub => unsub());
      _unsubscribers = [];

      // Očisti localStorage
      Object.values(KEYS).forEach(k => localStorage.removeItem(k));

      if (_useFirestore) {
        // Obriši Firestore kolekcije
        const collections = ['users', 'players', 'history', 'ratings'];
        for (const col of collections) {
          const snap = await _db.collection(col).get();
          const batch = _db.batch();
          snap.docs.forEach(d => batch.delete(d.ref));
          await batch.commit();
        }
        // Obriši session doc
        await _db.doc('config/session').delete();
      }

      await this.init();
      console.info('DB resetiran na seed podatke. Refreshaj stranicu.');
    },

    // Exposed za debug
    isFirestore() { return _useFirestore; },
  };

})();
