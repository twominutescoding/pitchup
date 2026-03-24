# Firebase Firestore — Uputa za Pitchup

## Dio 1: Kako Firestore radi (za ljude koji znaju SQL)

### Relacijska baza vs Firestore

```
RELACIJSKA BAZA (SQL)              FIRESTORE (NoSQL)
─────────────────────              ─────────────────────
Database                           Project (pitchup-491011)
Table                              Collection (users, players, history...)
Row                                Document
Column                             Field (polje unutar dokumenta)
Primary Key                        Document ID
Foreign Key                        Ne postoji — denormalizacija
JOIN                               Ne postoji — podatke dupliciraš
```

### Primjer: tablica `users`

**SQL (relacijska baza):**
```sql
CREATE TABLE users (
  nick VARCHAR(50) PRIMARY KEY,
  role VARCHAR(10),
  email VARCHAR(100)
);

INSERT INTO users VALUES ('LukaB', 'admin', 'luka.b@gmail.com');
INSERT INTO users VALUES ('Tomo',  'user',  'tomo@gmail.com');
```

**Firestore:**
```
Collection: users
  ├── Document: "LukaB"
  │     ├── nick: "LukaB"
  │     ├── role: "admin"
  │     └── email: "luka.b@gmail.com"
  │
  └── Document: "Tomo"
        ├── nick: "Tomo"
        ├── role: "user"
        └── email: "tomo@gmail.com"
```

Zamišljaj kolekciju kao **ladicu** u kojoj su **mape** (dokumenti).
Svaka mapa ima **etiketu** (Document ID) i unutra **papire** (polja).

### Kako čitamo podatke

**SQL:**
```sql
SELECT * FROM users;
SELECT * FROM users WHERE nick = 'LukaB';
```

**Firestore:**
```javascript
// Svi dokumenti iz kolekcije
db.collection('users').get()

// Jedan dokument po ID-u
db.doc('users/LukaB').get()
```

### Kako pišemo podatke

**SQL:**
```sql
INSERT INTO players (id, name, team) VALUES ('abc123', 'Tomo', null);
UPDATE config SET status = 'open' WHERE id = 'session';
```

**Firestore:**
```javascript
// Dodaj dokument (set = znaš ID, add = auto ID)
db.collection('players').doc('abc123').set({ id: 'abc123', name: 'Tomo', team: null })
db.collection('history').add({ date: '2026-03-04', scoreA: 5, scoreB: 4 })

// Update postojećeg dokumenta
db.doc('config/session').set({ status: 'open', field: 'Velesajam 2' })
```

### Nema JOIN-ova — i to je OK

U SQL-u bi imao:
```sql
SELECT p.name, u.role FROM players p JOIN users u ON p.name = u.nick;
```

U Firestore-u **dupliciraš podatke** umjesto da joinaš. To je normalno za NoSQL.
Kod nas: `players` kolekcija ima `name` polje koje je isti string kao `nick` u `users`.
Nema foreign key-a — samo se programski paziš da su konzistentni.

### Real-time listeneri — ubojita prednost

Ovo je razlog zašto smo prešli na Firestore. U SQL-u moraš pollati:

```javascript
// SQL pristup: svake 3 sekunde pitaj bazu "ima li nešto novo?"
setInterval(() => {
  fetch('/api/players').then(r => r.json()).then(updateUI);
}, 3000);
```

**Firestore pristup:**
```javascript
// Kažeš "obavijesti me kad se bilo što promijeni"
db.collection('players').onSnapshot(snapshot => {
  // Ovo se pozove ODMAH kad netko doda/obriše igrača
  // Bez čekanja, bez pollinga, bez dodatnih poziva
  const players = snapshot.docs.map(d => d.data());
  updateUI(players);
});
```

Kada Tomo otvori app u jednom tabu i prijavi se, Marko u drugom tabu
**odmah** vidi promjenu. Firestore šalje podatke kroz WebSocket konekciju.

### Naša Firestore struktura

```
pitchup-491011 (Firebase projekt)
│
├── Collection: users          — whitelist igrača
│   ├── Doc "LukaB"           { nick, role, email }
│   ├── Doc "Tomo"             { nick, role, email }
│   └── ...
│
├── Collection: config         — postavke aplikacije
│   └── Doc "session"          { status, date, field, time, teamsDrawn, markerTeam }
│
├── Collection: players        — trenutno prijavljeni igrači
│   ├── Doc "abc123"           { id, name, team }
│   └── ...
│
├── Collection: history        — sve odigrane utakmice
│   ├── Doc (auto ID)          { date, field, time, scoreA, scoreB, teamA, teamB }
│   └── ...
│
└── Collection: ratings        — ocjene igrača
    ├── Doc (auto ID)          { matchDate, rater, rated, scores }
    └── ...
```

### Kako naša app koristi Firestore

```
┌─────────────────────────────────────────────────────────┐
│                    BROWSER (app.js)                      │
│                                                         │
│  state.players ← DB.getPlayers() ← in-memory cache     │
│       │                                  ↑              │
│       │                                  │              │
│       ▼                                  │              │
│  renderPlayers()                  onSnapshot listener   │
│  renderPitch()                   (real-time update)     │
│                                          ↑              │
├──────────────────────────────────────────│──────────────┤
│                    DB.js                  │              │
│                                          │              │
│  savePlayers(p) ──► Firestore.set() ───► │              │
│                 └─► localStorage         │              │
│                                          │              │
├──────────────────────────────────────────│──────────────┤
│                 FIRESTORE (cloud)         │              │
│                                          │              │
│  Collection: players ────────────────────┘              │
│  (kad se promijeni, šalje update svim klijentima)       │
└─────────────────────────────────────────────────────────┘
```

1. Korisnik klikne "Prijavi se"
2. `app.js` pozove `DB.savePlayers()`
3. `db.js` spremi u localStorage (instant) I pošalje u Firestore (async)
4. Firestore primi promjenu
5. Firestore pošalje `onSnapshot` event SVIM otvorenim tabovima/browserima
6. `db.js` listener primi event, updatea cache, pozove `DB.subscribe()` callback
7. `app.js` callback re-renderira UI

### Offline podrška

Firestore ima ugrađeni offline cache (IndexedDB u browseru).
Ako korisnik izgubi internet:
- **Čitanje** radi normalno (iz cachea)
- **Pisanje** se sprema lokalno i automatski synca kad se internet vrati

Plus mi imamo i localStorage fallback kao dodatnu sigurnost.

---

## Dio 2: Google Cloud Console — Setup od nule

### Preduvjeti
- Google račun
- Chrome browser (preporučeno)

### Korak 1: Kreiranje Google Cloud projekta

1. Idi na https://console.cloud.google.com/
2. Klikni na dropdown **"Select a project"** (gore lijevo, pored "Google Cloud" loga)
3. Klikni **"NEW PROJECT"** (gore desno u popupu)
4. Unesi:
   - **Project name:** `pitchup` (ili što god želiš)
   - **Organization:** ostavi prazno ili odaberi svoju
5. Klikni **"CREATE"**
6. Pričekaj 10-30 sekundi dok se kreira

### Korak 2: Omogući Google Identity (za OAuth login)

1. U Cloud Console idi na **"APIs & Services" → "OAuth consent screen"**
   - Ili traži u search baru: "OAuth consent screen"
2. Odaberi **"External"** → klikni **"CREATE"**
3. Popuni:
   - **App name:** `Srijeda Nogomet`
   - **User support email:** tvoj email
   - **Developer contact email:** tvoj email
4. Klikni **"SAVE AND CONTINUE"** kroz sve korake (Scopes, Test users, Summary)
5. Na kraju klikni **"BACK TO DASHBOARD"**

### Korak 3: Kreiraj OAuth Client ID

1. Idi na **"APIs & Services" → "Credentials"**
2. Klikni **"+ CREATE CREDENTIALS" → "OAuth client ID"**
3. Odaberi:
   - **Application type:** Web application
   - **Name:** `pitchup-web`
4. Pod **"Authorized JavaScript origins"** dodaj:
   - `http://localhost:3000` (za lokalni razvoj)
   - `http://localhost:5500` (ako koristiš Live Server)
   - `https://tvoj-username.github.io` (za GitHub Pages)
5. Klikni **"CREATE"**
6. Kopiraj **Client ID** — to je ono što ide u `auth.js`:
   ```
   const CLIENT_ID = '937947977264-xxxxx.apps.googleusercontent.com';
   ```

### Korak 4: Publish OAuth App (da ne istekne svaka 7 dana)

1. Idi na **"APIs & Services" → "OAuth consent screen"**
2. Gore vidiš status **"Testing"**
3. Klikni **"PUBLISH APP"** → potvrdi
4. Status se mijenja u **"In production"**
   - Za interne appove ovo je dovoljno, Google neće tražiti review

---

## Dio 3: Firebase Console — Setup od nule

### Korak 5: Dodaj Firebase u postojeći Cloud projekt

1. Idi na https://console.firebase.google.com/
2. Klikni **"Add project"** (ili "Get started by setting up a Firebase project")
3. **VAŽNO:** Ne kreiraj novi projekt! Odaberi **"Add Firebase to an existing Google Cloud project"**
4. Iz dropdown-a odaberi svoj projekt (npr. `pitchup`)
5. Klikni **"Continue"**
6. Google Analytics — preskoči (disable toggle) ili uključi, svejedno
7. Klikni **"Create project"**
8. Pričekaj 30-60 sekundi

### Korak 6: Kreiraj Firestore bazu

1. U Firebase Console, u lijevom sidebaru klikni **"Databases & Storage"**
2. Klikni **"Firestore Database"**
3. Klikni **"Create database"**
4. Lokacija: odaberi **"eur3 (europe-west)"** (najbliže Hrvatskoj)
   - **PAŽNJA:** Ovo se NE MOŽE promijeniti nakon kreiranja!
5. Odaberi **"Start in test mode"**
   - Test mode dozvoljava svima čitanje/pisanje 30 dana
   - Kasnije ćemo zaštititi s pravilima
6. Klikni **"Create"**

### Korak 7: Omogući Google Auth u Firebase

1. U sidebaru klikni **"Security"** → **"Authentication"**
2. Klikni **"Get started"**
3. Pod **"Sign-in method"** klikni **"Google"**
4. Toggle **"Enable"** na ON
5. Odaberi svoj **support email**
6. Klikni **"Save"**

### Korak 8: Registriraj web app i dobij Firebase config

1. Klikni na **ikonu zupčanika** ⚙️ pokraj "Project Overview" (gore lijevo)
2. Klikni **"Project settings"**
3. Skrolaj dolje do **"Your apps"**
4. Klikni **web ikonu `</>`**
5. Unesi nickname: `pitchup-web`
6. **NE** označi "Firebase Hosting"
7. Klikni **"Register app"**
8. Pojavi se `firebaseConfig` objekt — kopiraj vrijednosti
9. Zalijepi ih u `js/config.js`:
   ```javascript
   const FIREBASE_CONFIG = {
     apiKey:            'tvoj-api-key',
     authDomain:        'tvoj-projekt.firebaseapp.com',
     projectId:         'tvoj-projekt',
     storageBucket:     'tvoj-projekt.firebasestorage.app',
     messagingSenderId: 'tvoj-sender-id',
     appId:             'tvoj-app-id',
   };
   ```

### Korak 9: Dodaj korisnike u Firestore

1. U Firebase Console idi na **"Firestore Database"**
2. Klikni **"+ Start collection"**
3. Collection ID: `users`
4. Za prvi dokument:
   - Document ID: `LukaB` (nick igrača)
   - Dodaj polja:
     - `nick` (string): `LukaB`
     - `role` (string): `admin`
     - `email` (string): `luka.b@gmail.com`
5. Klikni **"Save"**
6. Za dodavanje još igrača: klikni **"Add document"** unutar `users` kolekcije

**TIP:** Ako pokreneš app bez igrača u Firestore-u, `db.js` će automatski
seedati podatke iz `data/users.json` ili hardkodiranih seed podataka.

### Korak 10: Zaštiti bazu (Security Rules)

Ovo napravi kad si gotov s testiranjem (ili kad istekne test mode za 30 dana).

#### Opcija A: Deploy putem Firebase CLI (preporučeno)

1. Instaliraj Firebase CLI: `npm install -g firebase-tools`
2. Prijavi se: `firebase login`
3. U root direktoriju projekta već postoje `firebase.json`, `.firebaserc` i `firestore.rules`
4. Deploy:
   ```bash
   firebase deploy --only firestore:rules
   ```

#### Opcija B: Ručno u Firebase Console

1. U Firebase Console → **"Firestore Database"** → tab **"Rules"**
2. Kopiraj sadržaj iz `firestore.rules` datoteke u projektu
3. Klikni **"Publish"**

#### Kako pravila rade

Pravila koriste **dvoslojnu zaštitu**:

1. **Firebase Auth** — korisnik mora biti autentificiran putem Google OAuth-a
2. **Email whitelist** — korisnikov email mora postojati u `users` Firestore kolekciji (doc ID = email)

Kolekcija `users` koristi **email kao Document ID**, što omogućuje security rules da direktno provjere `exists(users/$(request.auth.token.email))`.

#### Pregled pravila po kolekcijama

| Kolekcija | Čitanje | Pisanje |
|-----------|---------|---------|
| `users` | Autentificirani (za whitelist provjeru) | Samo admini |
| `config` | Whitelisted korisnici | Samo admini |
| `players` | Whitelisted korisnici | Whitelisted korisnici |
| `history` | Whitelisted korisnici | Samo admini |
| `ratings` | Whitelisted korisnici | Whitelisted (samo za sebe kao `rater`) |

Ovo znači: **čak i da netko ima Firebase config, bez Google računa koji je u whitelisti, ne može ništa čitati ni pisati.**

#### Dodavanje novog korisnika u whitelist

Dodaj dokument u `users` kolekciju s **Document ID = email adresa**:
- `nick` (string): nadimak igrača
- `role` (string): `admin` ili `user`
- `email` (string): email adresa

---

## Dio 4: Česta pitanja

### "Koliko košta Firestore?"

Spark plan (besplatni):
- **50,000 čitanja/dan** — za 10 igrača koji refreshaju app, to je više nego dovoljno
- **20,000 pisanja/dan**
- **1 GB storage**
- Naša app troši možda 100-200 čitanja dnevno

### "Što ako izbrišem dokument u Firestore Consoleu?"

Promjena se **odmah** propagira svim otvorenim tabovima. Real-time listeneri
detektiraju brisanje i updatiraju UI. Pazi što brišeš!

### "Kako resetiram sve podatke?"

Otvori browser konzolu (F12) i upiši:
```javascript
DB.reset()
```
Ovo briše sve kolekcije u Firestore-u i localStorage-u, pa ponovno seeda.

### "Mogu li gledati podatke bez Firestore Consolea?"

Da, u browser konzoli:
```javascript
DB.getUsers()     // svi korisnici
DB.getSession()   // stanje sesije
DB.getPlayers()   // prijavljeni igrači
DB.getHistory()   // rezultati
DB.getRatings()   // ocjene
DB.isFirestore()  // true ako koristi Firestore, false ako localStorage
```

### "Što ako Firebase SDK ne radi (file:// protokol)?"

App automatski pada na **localStorage** fallback. Sve radi lokalno,
ali nema real-time synca između tabova/uređaja.

### "Kako dodam novog igrača u whitelist?"

Opcija A — Firebase Console:
1. Firestore Database → `users` kolekcija → "Add document"
2. Document ID = nick igrača
3. Dodaj polja: nick, role, email

Opcija B — Dodaj u `data/users.json` i pozovi `DB.reset()` u konzoli.
