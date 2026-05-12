// ── EARLY OAUTH HASH EXTRACTION ───────────────────────────────────────────
// app.js calls _ssReplaceHistory() at top-level, which overwrites the URL hash
// (#access_token=...) with #portal=dashboard BEFORE the ss-ready handler runs.
// We must grab the token NOW — supabase.js loads via <script src> before app.js,
// so the original hash is still intact here.
(function () {
  try {
    var h = window.location.hash;
    if (h && h.indexOf('access_token') !== -1) {
      var hp = new URLSearchParams(h.slice(1));
      var tok = hp.get('access_token');
      var ref = hp.get('refresh_token') || '';
      if (tok) {
        localStorage.setItem('sb_token', tok);
        if (ref) localStorage.setItem('sb_refresh', ref);
      }
    }
  } catch (e) {}
})();

// ── Supabase REST client (no SDK needed) ──────────────────────────────────
var _SBCFG = window.MinalloConfig || {};
var SUPA_URL = _SBCFG.supabaseUrl || window._SUPA || '';
var SUPA_KEY = _SBCFG.supabaseAnonKey || window._SAKEY || '';
var _sbToken = null; // access token after login
var _currentUser = null;
var _sbAuthCallbacks = [];
var _SS = window.Minallo;

function _ssAuth(status, detail) {
  if (!_SS || typeof _SS.setAuth !== 'function') return;
  _SS.setAuth(status, detail || {});
}

function _ssEmit(name, detail) {
  if (!_SS || typeof _SS.emit !== 'function') return;
  _SS.emit(name, detail || {});
}

function _sbHeaders(extra) {
  var h = {
    'Content-Type': 'application/json',
    apikey: SUPA_KEY,
    Authorization: 'Bearer ' + (_sbToken || SUPA_KEY)
  };
  return Object.assign(h, extra || {});
}

// ── AUTH ──────────────────────────────────────────────────────────────────
var _sb = {
  auth: {
    signUp: async function (email, password, redirectTo) {
      var body = { email: email, password: password };
      var url = SUPA_URL + '/auth/v1/signup';
      if (redirectTo) url += '?redirect_to=' + encodeURIComponent(redirectTo);
      var r = await fetch(url, {
        method: 'POST',
        headers: _sbHeaders(),
        body: JSON.stringify(body)
      });
      var d = await r.json();
      return d;
    },
    signIn: async function (email, password) {
      var r = await fetch(SUPA_URL + '/auth/v1/token?grant_type=password', {
        method: 'POST',
        headers: _sbHeaders(),
        body: JSON.stringify({ email: email, password: password })
      });
      var d = await r.json();
      if (d.access_token) {
        _sbToken = d.access_token;
        _currentUser = d.user;
        _ssAuth('signed-in', { source: 'password', user: _currentUser });
        // Always persist — user stays logged in across browser restarts until explicit sign-out
        localStorage.setItem('sb_token', d.access_token);
        localStorage.setItem('sb_refresh', d.refresh_token || '');
        sessionStorage.removeItem('sb_sess_token');
        _sbAuthCallbacks.forEach(function (cb) {
          cb('SIGNED_IN', d);
        });
        if (typeof _enterApp === 'function' && _currentUser) {
          _enterApp(_currentUser);
        }
      }
      return d;
    },
    signOut: function () {
      return fetch(SUPA_URL + '/auth/v1/logout', {
        method: 'POST',
        headers: _sbHeaders()
      }).then(function () {
        _sbToken = null;
        _currentUser = null;
        _ssAuth('signed-out', { source: 'signOut' });
        localStorage.removeItem('sb_token');
        localStorage.removeItem('sb_refresh');
        localStorage.removeItem('ss_state');
        sessionStorage.removeItem('sb_sess_token');
        sessionStorage.removeItem('ss_last_active');
        // ── Session routing: clear the login flag so next page load shows landing ─
        try {
          sessionStorage.removeItem('ss_logged_in');
        } catch (e) {}
        try {
          sessionStorage.removeItem('ss_portal_tab');
        } catch (e) {}
        clearTimeout(_activityTimer);
        _sbAuthCallbacks.forEach(function (cb) {
          cb('SIGNED_OUT', null);
        });
      });
    },
    getUser: function () {
      if (!_sbToken) return Promise.resolve(null);
      return fetch(SUPA_URL + '/auth/v1/user', {
        headers: _sbHeaders()
      })
        .then(function (r) {
          if (!r.ok) return null;
          return r.json();
        })
        .then(function (data) {
          if (!data || data.error || !data.id) return null;
          return data;
        });
    },
    onAuthStateChange: function (cb) {
      _sbAuthCallbacks.push(cb);
    },
    refreshSession: function () {
      var ref = localStorage.getItem('sb_refresh');
      if (!ref) return Promise.resolve(null);
      return fetch(SUPA_URL + '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        headers: _sbHeaders(),
        body: JSON.stringify({ refresh_token: ref })
      })
        .then(function (r) {
          return r.json();
        })
        .then(function (d) {
          if (d.access_token) {
            _sbToken = d.access_token;
            _currentUser = d.user || _currentUser;
            localStorage.setItem('sb_token', d.access_token);
            if (d.refresh_token) localStorage.setItem('sb_refresh', d.refresh_token);
            return _currentUser;
          }
          _sbToken = null;
          localStorage.removeItem('sb_token');
          localStorage.removeItem('sb_refresh');
          return null;
        })
        .catch(function () {
          return null;
        });
    },
    restoreSession: function () {
      _ssAuth('checking', { source: 'restoreSession' });
      var token = localStorage.getItem('sb_token');
      if (!token) {
        _ssAuth('signed-out', { source: 'restoreSession' });
        window._sbSessionReady = Promise.resolve(null);
        return window._sbSessionReady;
      }
      _sbToken = token;
      window._sbSessionReady = _sb.auth
        .getUser()
        .then(function (user) {
          if (user && user.id) {
            _currentUser = user;
            _ssAuth('signed-in', { source: 'restoreSession', user: user });
            _sbAuthCallbacks.forEach(function (cb) {
              cb('SIGNED_IN', { user: user });
            });
            return user;
          }
          // Token expired — try refresh token before giving up
          return _sb.auth.refreshSession().then(function (user) {
            if (user && user.id) {
              _currentUser = user;
              _ssAuth('signed-in', { source: 'refreshSession', user: user });
              _sbAuthCallbacks.forEach(function (cb) {
                cb('SIGNED_IN', { user: user });
              });
              return user;
            }
            _sbToken = null;
            localStorage.removeItem('sb_token');
            _ssAuth('signed-out', { source: 'restoreSession' });
            return null;
          });
        })
        .catch(function () {
          _sbToken = null;
          localStorage.removeItem('sb_token');
          _ssAuth('signed-out', { source: 'restoreSession' });
          return null;
        });
      return window._sbSessionReady;
    }
  },

  // ── DATA (REST API) ──────────────────────────────────────────────────────
  from: function (table) {
    return {
      select: function (cols) {
        return {
          eq: function (col, val) {
            return {
              single: function () {
                return fetch(
                  SUPA_URL +
                    '/rest/v1/' +
                    table +
                    '?select=' +
                    (cols || '*') +
                    '&' +
                    col +
                    '=eq.' +
                    encodeURIComponent(val) +
                    '&limit=1',
                  {
                    headers: Object.assign(_sbHeaders(), { Prefer: 'return=representation' })
                  }
                )
                  .then(function (r) {
                    if (!r.ok) return null;
                    return r.json().then(function (d) {
                      return Array.isArray(d) ? d[0] || null : null;
                    });
                  })
                  .catch(function () {
                    return null;
                  });
              }
            };
          }
        };
      },
      upsert: function (data) {
        return fetch(SUPA_URL + '/rest/v1/' + table, {
          method: 'POST',
          headers: Object.assign(_sbHeaders(), {
            Prefer: 'resolution=merge-duplicates,return=minimal'
          }),
          body: JSON.stringify(data)
        }).then(function (r) {
          return r.ok
            ? { error: null }
            : r.json().then(function (e) {
                return { error: e };
              });
        });
      }
    };
  }
};

console.log('Supabase REST client ready ✓');
// Quick connectivity test
fetch(SUPA_URL + '/auth/v1/health', { headers: { apikey: SUPA_KEY } })
  .then(function (r) {
    console.log('Supabase reachable ✓ status:', r.status);
  })
  .catch(function (e) {
    console.error('Supabase NOT reachable:', e.message);
  });

// ── SESSION PERSISTENCE ──────────────────────────────────────────────────
var _activityTimer = null;

function _resetActivityTimer() {
  // Auto-logout disabled — users stay logged in indefinitely
}

// Track activity
['mousemove', 'keydown', 'click', 'touchstart', 'scroll'].forEach(function (ev) {
  document.addEventListener(ev, _resetActivityTimer, { passive: true });
});

// Global auth helpers
function _enterApp(user) {
  _currentUser = user;
  _ssAuth('entering', { source: 'enterApp', user: user });
  if (user && user.email) sessionStorage.removeItem('pendingConfirm');
  if (user && user.id) {
    try {
      localStorage.setItem('ss_last_uid', user.id);
    } catch (e) {}
  }

  // ── Session routing: mark browser session as logged-in ─────────────────
  // _onLoginSuccess (defined in index.html) sets ss_logged_in = 'true' and
  // reloads so loader.js can boot the full app instead of the landing page.
  // Guard: only call it when the flag is not already set, so subsequent
  // _enterApp calls (e.g. activity-timer resets) do NOT trigger extra reloads.
  if (typeof window._onLoginSuccess === 'function') {
    var _alreadyIn = false;
    try {
      _alreadyIn = sessionStorage.getItem('ss_logged_in') === 'true';
    } catch (e) {}
    if (!_alreadyIn) {
      window._onLoginSuccess(); // → sets flag → reloads → loader.js shows app
      return; // stop here; reload re-runs _enterApp with flag set
    }
  }
  // ───────────────────────────────────────────────────────────────────────

  // Sync nightBtn safely — nightOn may not be defined yet if app.js hasn't run
  var _nb = document.getElementById('nightBtn');
  var _nightOn =
    typeof nightOn !== 'undefined' ? nightOn : sessionStorage.getItem('ss_dark') !== '0';
  if (_nb) _nb.textContent = _nightOn ? '☀️' : '🌙';
  var modal = document.getElementById('authModal');
  if (modal) modal.style.display = 'none';

  // Only reset to portal view on the first entry into the app.
  // If the user is already in the app (Stud.IP or files view), a repeated
  // _enterApp call (e.g. from signIn or a silent One Tap refresh) must NOT
  // hide #app and jump the user back to the portal.
  var _inAppAlready = false;
  try {
    _inAppAlready = JSON.parse(localStorage.getItem('ss_state') || '{}').inApp === true;
  } catch (e) {}

  console.log(
    '[Auth] _enterApp: _inAppAlready=',
    _inAppAlready,
    'ss_state=',
    localStorage.getItem('ss_state')
  );
  var _appEl = document.getElementById('app');
  var _portalEl = document.getElementById('portal');
  // Determine which section to restore before anything else changes the state
  var _restoreSec = null;
  try {
    _restoreSec =
      sessionStorage.getItem('ss_portal_tab') || localStorage.getItem('ss_last_section');
  } catch (e) {}

  if (!_inAppAlready) {
    if (_appEl) _appEl.style.display = 'none';
    if (_portalEl) {
      _portalEl.classList.add('show');
      _portalEl.style.display = 'block';
      _portalEl.style.opacity = '1';
      _portalEl.style.pointerEvents = 'auto';
      _portalEl.style.zIndex = '200';
    }
  }
  // Always restore the last section, falling back to dashboard
  var _targetSec = _restoreSec && _restoreSec !== 'dashboard' ? _restoreSec : 'dashboard';
  if (typeof setNavActive === 'function')
    setNavActive(
      {
        chat: 'psbChat',
        editor: 'psbEditor',
        notes: 'psbNotes',
        aipage: 'psbAIPage',
        games: 'psbGames',
        lounge: 'psbLounge',
        notifications: 'psbNotifications',
        profile: 'psbProfile',
        settings: 'psbSettings',
        subscription: 'psbSubscription',
        german: 'psbGerman',
        studip: 'pcStudip',
        admin: 'psbAdmin'
      }[_targetSec] || 'psbDashboard'
    );
  if (typeof showPortalSection === 'function') showPortalSection(_targetSec);
  if (typeof updateAuthIndicator === 'function') updateAuthIndicator(user);
  if (user && typeof loadUserData === 'function') loadUserData(user.id);
  if (typeof window._ssHideSplash === 'function') window._ssHideSplash();
  _ssAuth('entered', { source: 'enterApp', user: user });
  if (_SS && typeof _SS.markReady === 'function')
    _SS.markReady('auth', { userId: user && user.id });
  _resetActivityTimer();
  // Check DB — new user has no profile row → show onboarding form
  if (user && user.id) {
    var _showOb = function () {
      setTimeout(function () {
        var modal = document.getElementById('onboardModal');
        if (modal) {
          var ef = document.getElementById('obEmail');
          if (ef && user.email) ef.value = user.email;
          modal.style.display = 'flex';
        }
      }, 500);
    };
    // Fast guard: if onboarding was completed this browser, skip fetch
    if (localStorage.getItem('ob_done_' + user.id) === '1') return;
    // Use maybeSingle approach: fetch with limit=1, no error on empty
    fetch(
      SUPA_URL + '/rest/v1/profiles?select=id&id=eq.' + encodeURIComponent(user.id) + '&limit=1',
      {
        headers: Object.assign({
          'Content-Type': 'application/json',
          apikey: SUPA_KEY,
          Authorization: 'Bearer ' + _sbToken
        })
      }
    )
      .then(function (r) {
        return r.json();
      })
      .then(function (rows) {
        var hasProfile = Array.isArray(rows) && rows.length > 0;
        if (hasProfile) {
          localStorage.setItem('ob_done_' + user.id, '1');
        } else {
          _showOb();
        }
      })
      .catch(function () {
        /* on fetch error, don't force onboarding */
      });
  }
}

function _showModal() {
  _sbToken = null;
  _currentUser = null;
  _ssAuth('signed-out', { source: 'showModal' });

  localStorage.removeItem('sb_token');
  localStorage.removeItem('sb_refresh');
  localStorage.removeItem('ss_state');

  sessionStorage.removeItem('sb_sess_token');
  sessionStorage.removeItem('ss_last_active');
  sessionStorage.removeItem('ss_logged_in');
  sessionStorage.removeItem('ss_try_saved_login');
  sessionStorage.removeItem('ss_show_auth');
  sessionStorage.removeItem('ss_portal_tab');

  if (typeof window._ssHideSplash === 'function') window._ssHideSplash();

  var modal = document.getElementById('authModal');
  if (modal) modal.style.display = 'flex';

  var portal = document.getElementById('portal');
  if (portal) {
    portal.classList.remove('show');
    portal.style.display = 'none';
  }

  var appEl = document.getElementById('app');
  if (appEl) appEl.style.display = 'none';
}

// Try to get a fresh access token using the stored refresh token
function _sbRefreshAccessToken() {
  var ref = null;
  try {
    ref = localStorage.getItem('sb_refresh');
  } catch (e) {}
  if (!ref) return Promise.resolve(null);
  return fetch(SUPA_URL + '/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPA_KEY },
    body: JSON.stringify({ refresh_token: ref })
  })
    .then(function (r) {
      return r.json();
    })
    .then(function (d) {
      if (d && d.access_token) {
        _sbToken = d.access_token;
        localStorage.setItem('sb_token', d.access_token);
        if (d.refresh_token) localStorage.setItem('sb_refresh', d.refresh_token);
        return d.access_token;
      }
      return null;
    })
    .catch(function () {
      return null;
    });
}

function _verifyAndEnter(tok) {
  _ssAuth('checking', { source: 'verifyAndEnter' });
  _ssEmit('auth:verify:start', { hasToken: !!tok });
  _sbToken = tok;
  _sb.auth
    .getUser()
    .then(function (user) {
      if (user && user.id) {
        _ssEmit('auth:verify:success', { userId: user.id });
        _enterApp(user);
      } else {
        // Access token may be expired — try refreshing silently
        _sbRefreshAccessToken().then(function (newTok) {
          if (newTok) {
            _sb.auth
              .getUser()
              .then(function (user2) {
                if (user2 && user2.id) {
                  _ssEmit('auth:verify:success', { userId: user2.id, refreshed: true });
                  _enterApp(user2);
                } else {
                  _ssAuth('failed', { source: 'verifyAndEnter' });
                  _showModal();
                }
              })
              .catch(function () {
                _ssAuth('failed', { source: 'verifyAndEnter' });
                _showModal();
              });
          } else {
            _ssAuth('failed', { source: 'verifyAndEnter' });
            _showModal();
          }
        });
      }
    })
    .catch(function () {
      _sbRefreshAccessToken().then(function (newTok) {
        if (newTok) {
          _sb.auth
            .getUser()
            .then(function (user2) {
              if (user2 && user2.id) {
                _ssEmit('auth:verify:success', { userId: user2.id, refreshed: true });
                _enterApp(user2);
              } else {
                _ssAuth('failed', { source: 'verifyAndEnter' });
                _showModal();
              }
            })
            .catch(function () {
              _ssAuth('failed', { source: 'verifyAndEnter' });
              _showModal();
            });
        } else {
          _ssAuth('failed', { source: 'verifyAndEnter' });
          _showModal();
        }
      });
    });
}

window.addEventListener('ss-ready', function () {
  _ssEmit('auth:ss-ready', {});
  console.log(
    '[Auth] ss-ready fired. ss_logged_in=',
    sessionStorage.getItem('ss_logged_in'),
    'sb_token=',
    !!localStorage.getItem('sb_token'),
    'sb_sess_token=',
    !!sessionStorage.getItem('sb_sess_token'),
    'hash=',
    window.location.hash.slice(0, 30)
  );

  function _clearSavedAuth() {
    _sbToken = null;
    _currentUser = null;
    _ssAuth('signed-out', { source: 'clearSavedAuth' });

    try {
      localStorage.removeItem('sb_token');
      localStorage.removeItem('sb_refresh');
      localStorage.removeItem('ss_state');

      sessionStorage.removeItem('sb_sess_token');
      sessionStorage.removeItem('ss_last_active');
      sessionStorage.removeItem('ss_logged_in');
      sessionStorage.removeItem('ss_try_saved_login');
      sessionStorage.removeItem('ss_show_auth');
      sessionStorage.removeItem('ss_portal_tab');
    } catch (e) {}
  }

  function _showModalClean() {
    _clearSavedAuth();

    var modal = document.getElementById('authModal');
    if (modal) modal.style.display = 'flex';

    var portal = document.getElementById('portal');
    if (portal) {
      portal.classList.remove('show');
      portal.style.display = 'none';
    }

    var appEl = document.getElementById('app');
    if (appEl) appEl.style.display = 'none';
  }

  var hash = window.location.hash;
  var query = window.location.search;

  var hashToken = null;
  if (hash && hash.indexOf('access_token') !== -1) {
    var hp = new URLSearchParams(hash.slice(1));
    hashToken = hp.get('access_token');
  }

  var queryToken = null;
  var queryType = null;
  if (query) {
    var qp = new URLSearchParams(query);
    queryToken = qp.get('token') || qp.get('token_hash') || qp.get('confirmation_token');
    queryType = qp.get('type');
  }

  if (hashToken) {
    _ssAuth('checking', { source: 'hashToken' });
    console.log('[Auth] → path: hashToken found');
    history.replaceState(null, '', window.location.pathname);
    var ref = new URLSearchParams(hash.slice(1)).get('refresh_token') || '';
    localStorage.setItem('sb_token', hashToken);
    if (ref) localStorage.setItem('sb_refresh', ref);
    _verifyAndEnter(hashToken);
    return;
  }

  if (queryToken) {
    _ssAuth('checking', { source: 'queryToken' });
    history.replaceState(null, '', window.location.pathname);
    fetch(SUPA_URL + '/auth/v1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPA_KEY },
      body: JSON.stringify({ token: queryToken, type: queryType || 'signup' })
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        if (d.access_token) {
          localStorage.setItem('sb_token', d.access_token);
          if (d.refresh_token) localStorage.setItem('sb_refresh', d.refresh_token);
          _verifyAndEnter(d.access_token);
        } else {
          _showModalClean();
        }
      })
      .catch(function () {
        _showModalClean();
      });
    return;
  }

  var trySaved = false;
  try {
    trySaved = sessionStorage.getItem('ss_try_saved_login') === 'true';
    if (trySaved) sessionStorage.removeItem('ss_try_saved_login');
  } catch (e) {}

  if (trySaved) {
    _ssAuth('checking', { source: 'trySaved' });
    console.log('[Auth] → path: trySaved');
    var saved = null;
    var sess = null;
    var alive = false;
    var tok = null;

    try {
      saved = localStorage.getItem('sb_token');
      sess = sessionStorage.getItem('sb_sess_token');
      tok = saved || sess || null;
    } catch (e) {}

    if (tok) {
      _verifyAndEnter(tok);
    } else {
      _showModalClean();
    }
    return;
  }

  var alreadyIn = false;
  try {
    alreadyIn = sessionStorage.getItem('ss_logged_in') === 'true';
  } catch (e) {}

  if (alreadyIn) {
    _ssAuth('checking', { source: 'alreadyIn' });
    console.log('[Auth] → path: alreadyIn');
    var saved2 = null;
    var sess2 = null;
    var alive2 = false;
    var tok2 = null;

    try {
      saved2 = localStorage.getItem('sb_token');
      sess2 = sessionStorage.getItem('sb_sess_token');
      tok2 = saved2 || sess2 || null;
    } catch (e) {}

    console.log(
      '[Auth] alreadyIn: saved2=',
      !!saved2,
      'sess2=',
      !!sess2,
      'alive2=',
      alive2,
      'tok2=',
      !!tok2
    );
    if (tok2) {
      _verifyAndEnter(tok2);
    } else {
      console.log('[Auth] alreadyIn but no token → showModalClean');
      _showModalClean();
    }
    return;
  }

  // Login CTA redirect — show the auth modal immediately.
  var showAuth = false;
  try {
    showAuth = sessionStorage.getItem('ss_show_auth') === 'true';
  } catch (e) {}
  if (showAuth) {
    _ssAuth('signed-out', { source: 'showAuth' });
    console.log('[Auth] → path: showAuth → _showModal');
    _showModal();
    return;
  }

  // Persistent login: sb_token in localStorage caused the full app to boot.
  // Verify the token and enter the app, or fall back to the auth modal.
  var savedTok = null;
  try {
    savedTok = localStorage.getItem('sb_token');
  } catch (e) {}
  if (savedTok) {
    _ssAuth('checking', { source: 'persistentToken' });
    console.log('[Auth] → path: persistent sb_token restore');
    _verifyAndEnter(savedTok);
    return;
  }

  console.log(
    '[Auth] → path: fallthrough (no action taken) — page will appear blank if full app is loaded'
  );
  _ssAuth('idle', { source: 'fallthrough' });
  // Default startup path: stay on the landing page until the user clicks Login.
});
