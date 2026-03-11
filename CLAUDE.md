# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A static HTML/CSS/JS web app for organizing Wednesday amateur football (soccer) games. Deployed on GitHub Pages with no backend — Google Sheets acts as the database (mocked with local JSON during development).

## Running the Project

Open `index.html` directly in a browser. No build step or server needed.

## Architecture

**Single-page static app** — everything lives in `index.html` (or split into `index.html` + `style.css` + `app.js` as it grows).

**Data layer** (current: mock JSON → future: Google Sheets API):
- `data/players.json` — registered players for current week
- `data/sessions.json` — available time slots and fields
- Google Sheets replaces JSON files later; each sheet = DB table

**Key modules to implement (JavaScript)**:
- `registration.js` — player sign-up (Sun–Wed window), visible to all
- `teams.js` — random team assignment when 8 or 10 players registered; random marker team assignment
- `field.js` — HTML5 Canvas rendering of football pitch with player circles and names

## Core Business Rules

- Registration opens Sunday, closes Wednesday
- Default field: **Velesajam dvojka**; default time: **19:00–20:00**
- Player counts: **8** (4v4) or **10** (5v5) — team draw triggers at these thresholds
- One team randomly assigned to bring markers (bibs)
- Future: Google OAuth login; only emails whitelisted in Google Sheets can access

## Original Requirements (Croatian)

Stanica će služiti za nogomet srijedom za amaterske ekipe. Na stranicu se mogu prijavljivati ljudi i počinje od nedjelje i traje do srijede. Popis ljudi biti će u google docsima i popis termina također. Dok se ne uspostave google docsi imati ćemo mockane jsone. Biti će jedan google excel sa više sheetova. Sheetovi će služiti kao DB tablice. Aplikacija će biti deployana na git pages kao statički resurs. Stranica treba biti u nogometnom duhu i bilo bi dobro da se doda html 5 sadržaj zbog efektnosti.

Funkcionalnosti: odabir terena za tekuću srijedu: default Velesajam dvojka
Odabir termina: default je od 19-20h
Mogući broj ljudi je 8 ili 10 za sada, odnosno 4vs4 ili 5vs5

Ljudi se mogu prijavljivati i to je vidljivo svakome
Kada se skupi 8 ili 10 igrača moguće je napraviti random dodjeljivanje tima
Također jedan tim nosi markere, drugi ne nosi i to je random određeno.

Kasnije bi trebali dodati i login pomoću google-a i samo ljudi čije email adrese su u google sheetsima mogu pristupiti aplikaciji.

Za sada je ovo koncept. Treba najprije napraviti cijeli dizanj, pa onda krenuti sa funkcionalnostima. U svakom slučaju negdje mora biti prikazan nogomenti teren i u njemu nacrtani kružići sa imenima igrača kada se podjele u timove.
