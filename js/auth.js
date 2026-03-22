'use strict';

/**
 * auth.js — Google Identity Services autentifikacija
 *
 * Flow:
 *  1. Na loadu provjeri localStorage za nfg_auth (JWT credential)
 *  2. Ako nema ili je istekao → prikaži login ekran
 *  3. Ako je validan → dekodiraj, provjeri email u whitelisti, nastavi
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
    // exp je unix timestamp u sekundama
    return Date.now() / 1000 > payload.exp;
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
     * Vraća user objekt ili null ako email nije u whitelisti.
     */
    handleCredential(response) {
      const payload = decodeJwt(response.credential);
      if (!payload || !payload.email) return null;

      save(response.credential, payload);

      return {
        email:   payload.email,
        name:    payload.name,
        picture: payload.picture,
      };
    },

    logout() {
      clear();
      google.accounts.id.disableAutoSelect();
      location.reload();
    },

    /**
     * Inicijalizira Google Sign-In i renderira gumb.
     */
    initGoogleButton(containerId, callback) {
      google.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: callback,
        auto_select: true,
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
