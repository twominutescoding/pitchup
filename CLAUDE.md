# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A static HTML/CSS/JS web app for organizing Wednesday amateur football (soccer) games. The UI is in Croatian. Deployed on GitHub Pages — no backend, no build step, no bundler.

## Running the Project

Open `index.html` in a browser via local dev server (e.g. `npx serve` or VS Code Live Server). `file://` works with localStorage fallback only (Firebase SDK needs HTTP).

To reset app state during development, run `DB.reset()` in the browser console.

## Architecture

**Single-page app with two-panel layout**: left panel has registration, player list, admin controls, and match history; right panel renders an SVG football pitch with player positions.

**Source files loaded in order** (no modules, no bundler):
1. Firebase SDK (CDN, compat version) — `firebase-app-compat.js`, `firebase-firestore-compat.js`, `firebase-auth-compat.js`
2. `js/config.js` — `FIREBASE_CONFIG` constant with Firebase project credentials
3. `js/db.js` — `DB` singleton (IIFE). Persistence layer using **Firebase Firestore** with real-time listeners (`onSnapshot`). Falls back to `localStorage` when Firebase SDK is unavailable (e.g. `file://` protocol). All reads/writes go through `DB.getX()` / `DB.saveX()`. On first load, seeds Firestore from `data/users.json` and `data/history.json` (or hardcoded seed data).
4. `js/auth.js` — Google Identity Services login + Firebase Auth (`signInWithCredential` using Google ID token). Whitelist-based access via `users` collection in Firestore.
5. `js/app.js` — All application logic and rendering. Global `state` object holds `users`, `session`, `players`, `mockUserIdx`. No framework — DOM manipulation via `document.getElementById` and `innerHTML`.
6. `css/style.css` — All styles.

**Data flow**: `DB.init()` → seeds Firestore if empty → sets up `onSnapshot` real-time listeners → populates in-memory cache → `render()` updates DOM. User actions mutate `state`, call `DB.saveX()` (writes to both localStorage and Firestore), then re-render. Firestore listeners automatically trigger `DB.subscribe()` callbacks for real-time updates across tabs/devices.

**Auth flow**: Google Sign-In → JWT credential → check email against `users` collection → if whitelisted, `firebase.auth().signInWithCredential()` → app loads. Dev mode (mock users) available via login screen button.

**Pitch rendering**: SVG-based (not Canvas), with `viewBox="0 0 500 320"`. Player positions are defined in the `POSITIONS` constant (4v4 and 5v5 formations). Players are drawn as gradient spheres with name labels via `drawPlayerMarker()` into the `#pitch-players` group.

## Firebase / Firestore

**Backend**: Firebase Firestore (NoSQL document database) with real-time listeners. No custom server.

**Firestore collections**:
| Collection | Document ID | Fields |
|------------|-------------|--------|
| `users` | nick | nick, role, email |
| `config` | `session` (single doc) | status, date, field, time, teamsDrawn, markerTeam |
| `players` | player id | id, name, team |
| `history` | auto-generated | date, field, time, scoreA, scoreB, teamA, teamB |
| `ratings` | auto-generated | matchDate, rater, rated, scores |

**Config**: `js/config.js` contains `FIREBASE_CONFIG` with project credentials (public, security via Firestore Rules).

**Offline support**: Firestore offline persistence enabled + localStorage fallback. App works without internet using cached data.

## Core Business Rules

- Admin opens/closes registration per session (no automatic Sunday–Wednesday window yet)
- Default field: **Velesajam 2**; default time: **19–20h**
- Team draw available when **8+** players registered; uses first 8 (4v4) or 10 (5v5) players, extras go to bench
- Adding a player after teams are drawn resets the draw
- One team randomly assigned to bring markers (bibs)
- Match results are stored in history with both team rosters
- Player ratings: 5 categories (tehnika, brzina, izdržljivost, timska igra, pozicioniranje), 1–5 stars
- User whitelist: only emails present in `users` Firestore collection can log in

## Original Requirements (Croatian)

Stranica za nogomet srijedom za amaterske ekipe. Prijave od nedjelje do srijede. Popis ljudi u Firestore bazi. Deploy na GitHub Pages. Default teren: Velesajam dvojka, default termin: 19-20h. Mogući broj igrača: 8 (4v4) ili 10 (5v5). Random podjela timova i random odabir tima koji nosi markere. Prikaz nogometnog terena s kružićima i imenima igrača. Login preko Google OAutha s whitelistom emailova u Firestore-u.

## Documentation

- `docs/FIREBASE-UPUTA.md` — Firebase/Firestore setup guide (Croatian), includes SQL-to-Firestore comparison, Google Cloud Console setup, and FAQ
