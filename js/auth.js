'use strict';

/**
 * auth.js — Google Identity Services + Firebase Auth
 *
 * Flow:
 *  1. Na loadu provjeri localStorage za nfg_auth (JWT credential)
 *  2. Ako nema ili je istekao → prikaži login ekran
 *  3. Ako je validan → dekodiraj, provjeri email u whitelisti, nastavi
 *  4. Koristi Google ID token za Firebase Auth (signInWithCredential)
 *
 * JWT payload od Googlea sadrži: sub, email, name, picture, iat, exp
 */

const Auth = (() => {

  const CLIENT_ID = '937947977264-n1j2qli354f5pvte89clcf1t8ahv1r9f.apps.googleusercontent.com';
  const STORAGE_KEY = 'nfg_auth';

  // Dekodira JWT payload (base64url → JSON)
  function decodeJwt(token) {
    try {
      const payload = token.split('.')[1];
      const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(b64));
    } catch {
      return null;
    }
  }

  function getStored() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!data || !data.credential) return null;
      return data;
    } catch {
      return null;
    }
  }

  function save(credential, payload) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      credential,
      email:   payload.email,
      name:    payload.name,
      picture: payload.picture,
      exp:     payload.exp,
    }));
  }

  function clear() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function isExpired(payload) {
    if (!payload || !payload.exp) return true;
    return Date.now() / 1000 > payload.exp;
  }

  /**
   * Prijavi se u Firebase Auth koristeći Google ID token.
   * Ovo omogućuje Firestore Security Rules da provjere request.auth.
   */
  async function signInToFirebase(idToken) {
    try {
      if (typeof firebase === 'undefined' || !firebase.auth) return;
      const credential = firebase.auth.GoogleAuthProvider.credential(idToken);
      await firebase.auth().signInWithCredential(credential);
    } catch (e) {
      console.warn('Firebase Auth sign-in neuspješan:', e);
    }
  }

  return {
    CLIENT_ID,

    /**
     * Provjeri postojeću sesiju.
     * Vraća { email, name, picture } ili null.
     */
    check() {
      const stored = getStored();
      if (!stored) return null;
      if (isExpired(stored)) {
        clear();
        return null;
      }
      return {
        email:   stored.email,
        name:    stored.name,
        picture: stored.picture,
      };
    },

    /**
     * Callback od Google Sign-In.
     * Prima response s credential (JWT).
     * Vraća user objekt ili null ako dekodiranje ne uspije.
     * Također se prijavljuje u Firebase Auth.
     */
    async handleCredential(response) {
      const payload = decodeJwt(response.credential);
      if (!payload || !payload.email) return null;

      save(response.credential, payload);

      // Firebase Auth — koristi isti Google ID token
      await signInToFirebase(response.credential);

      return {
        email:   payload.email,
        name:    payload.name,
        picture: payload.picture,
      };
    },

    /**
     * Ako postoji stored credential, prijavi se u Firebase Auth.
     * Poziva se na app startu kad je sesija već validna.
     */
    async restoreFirebaseAuth() {
      const stored = getStored();
      if (stored && stored.credential && !isExpired(stored)) {
        await signInToFirebase(stored.credential);
      }
    },

    clear() {
      clear();
    },

    logout() {
      clear();
      try { google.accounts.id.disableAutoSelect(); } catch (_) {}
      try { firebase.auth().signOut(); } catch (_) {}
      location.reload();
    },

    initGoogleButton(containerId, callback) {
      google.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: callback,
        auto_select: false,
        use_fedcm_for_prompt: false,
      });
      google.accounts.id.renderButton(
        document.getElementById(containerId),
        {
          theme: 'filled_black',
          size:  'large',
          shape: 'pill',
          text:  'signin_with',
          width: 280,
        }
      );
    },
  };

})();
