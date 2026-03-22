# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A static HTML/CSS/JS web app for organizing Wednesday amateur football (soccer) games. The UI is in Croatian. Deployed on GitHub Pages — no backend, no build step, no bundler.

## Running the Project

Open `index.html` directly in a browser (`file://` works). No server, build, lint, or test commands exist.

To reset app state during development, run `DB.reset()` in the browser console.

## Architecture

**Single-page app with two-panel layout**: left panel has registration, player list, admin controls, and match history; right panel renders an SVG football pitch with player positions.

**Three source files loaded in order** (no modules, no bundler):
1. `js/db.js` — `DB` singleton (IIFE). Persistence layer using `localStorage` with keys prefixed `nfg_`. On first load, seeds from `data/users.json` and `data/history.json` (falls back to hardcoded seed data when fetch fails, e.g. `file://` protocol). Designed to be swapped for Google Sheets API later — all reads/writes go through `DB.getX()` / `DB.saveX()`.
2. `js/app.js` — All application logic and rendering. Global `state` object holds `users`, `session`, `players`, `mockUserIdx`. No framework — DOM manipulation via `document.getElementById` and `innerHTML`.
3. `css/style.css` — All styles.

**Data flow**: `DB.init()` → populate `state` from `DB` getters → `render()` updates DOM. User actions mutate `state`, call `DB.saveX()`, then re-render.

**Mock auth**: No real auth yet. A clickable "demo" pill in the header cycles through users from `data/users.json`. The first user (`LukaB`) has `role: "admin"`. Admin-only features (open/close session, draw teams, record results) check `isAdmin()`.

**Pitch rendering**: SVG-based (not Canvas), with `viewBox="0 0 500 320"`. Player positions are defined in the `POSITIONS` constant (4v4 and 5v5 formations). Players are drawn as gradient spheres with name labels via `drawPlayerMarker()` into the `#pitch-players` group.

## Core Business Rules

- Admin opens/closes registration per session (no automatic Sunday–Wednesday window yet)
- Default field: **Velesajam 2**; default time: **19–20h**
- Team draw available when **8+** players registered; uses first 8 (4v4) or 10 (5v5) players, extras go to bench
- Adding a player after teams are drawn resets the draw
- One team randomly assigned to bring markers (bibs)
- Match results are stored in history with both team rosters

## Original Requirements (Croatian)

Stranica za nogomet srijedom za amaterske ekipe. Prijave od nedjelje do srijede. Popis ljudi i termina u Google Sheetsima (mockano JSONom za sada). Deploy na GitHub Pages. Default teren: Velesajam dvojka, default termin: 19-20h. Mogući broj igrača: 8 (4v4) ili 10 (5v5). Random podjela timova i random odabir tima koji nosi markere. Prikaz nogometnog terena s kružićima i imenima igrača. Budući login preko Google OAutha s whitelistom emailova.
