'use strict';

/**
 * config.js — Firebase konfiguracija
 *
 * Ove vrijednosti dobivaju se iz Firebase Console:
 * Project settings → General → Your apps → Web app → Firebase SDK snippet
 *
 * NAPOMENA: Ovo su javni identifikatori (kao Google Client ID) — sigurnost
 * se osigurava kroz Firestore Security Rules, ne kroz skrivanje configa.
 */
const FIREBASE_CONFIG = {
  apiKey:            'AIzaSyDuW-LV0-bD6ueVTgIbOSctZf-ioPFVQaE',
  authDomain:        'pitchup-491011.firebaseapp.com',
  projectId:         'pitchup-491011',
  storageBucket:     'pitchup-491011.firebasestorage.app',
  messagingSenderId: '937947977264',
  appId:             '1:937947977264:web:e499a212cdc9539c9fbff5',
};
