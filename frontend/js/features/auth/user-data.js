import { checkAdminStatus } from '../../services/admin-service.js';

var _presenceTimer = null;

export function startPresenceHeartbeat(uid) {
  clearInterval(_presenceTimer);
  function _beat() {
    var _sbToken = window._sbToken;
    if (!uid || !_sbToken) return;
    var SUPA_URL = window.SUPA_URL || '';
    fetch(SUPA_URL + '/rest/v1/profiles?id=eq.' + encodeURIComponent(uid), {
      method: 'PATCH',
      headers: Object.assign(window._sbHeaders ? window._sbHeaders() : {}, {
        Prefer: 'return=minimal'
      }),
      body: JSON.stringify({ last_seen: new Date().toISOString() })
    }).catch(function () {});
  }
  _beat();
  _presenceTimer = setInterval(_beat, 60000);
}

export async function loadUserData(uid) {
  try {
    try {
      var cached = localStorage.getItem('profile_cache_' + uid);
      if (cached) {
        var cp = JSON.parse(cached);
        if (cp && cp.full_name && window.applyProfile) window.applyProfile(cp);
        if (cp && cp.courses && window._loadUserCourses) window._loadUserCourses(cp.courses);
      }
    } catch (e) {}

    var _sb = window._sb;
    var profile = await _sb.from('profiles').select('*').eq('id', uid).single();
    if (profile && profile.full_name) {
      try {
        localStorage.setItem('profile_cache_' + uid, JSON.stringify(profile));
      } catch (e) {}
      if (window.applyProfile) window.applyProfile(profile);
    }
    if (profile && profile.courses) {
      if (window._loadUserCourses) window._loadUserCourses(profile.courses);
    } else {
      if (window.restoreState) window.restoreState();
    }

    var _currentUser = window._currentUser;
    if (_currentUser && _currentUser.email) {
      fetch((window.SUPA_URL || '') + '/rest/v1/profiles?id=eq.' + encodeURIComponent(uid), {
        method: 'PATCH',
        headers: Object.assign(window._sbHeaders ? window._sbHeaders() : {}, {
          Prefer: 'return=minimal'
        }),
        body: JSON.stringify({ auth_email: _currentUser.email })
      }).catch(function () {});
    }

    startPresenceHeartbeat(uid);

    var settings = await _sb.from('settings').select('*').eq('id', uid).single();
    if (settings && window.applySettings) window.applySettings(settings);

    var sub = await _sb.from('subscriptions').select('*').eq('user_id', uid).single();
    if (window.applySubscription) window.applySubscription(sub || {});

    // Check admin status before deciding whether to show the paywall.
    // Admin accounts bypass the subscription gate.
    checkAdminStatus()
      .then(function (data) {
        var isAdmin = !!(data && data.isAdmin);
        window._userIsAdmin = isAdmin;
        if (isAdmin) {
          var btn = document.getElementById('psbAdmin');
          if (btn) btn.style.display = '';
        }
        if (!window._userIsPro && !isAdmin && window._showPaywall) {
          setTimeout(window._showPaywall, 800);
        }
      })
      .catch(function () {
        // If admin check fails, fall back to subscription-only gate
        if (!window._userIsPro && window._showPaywall) setTimeout(window._showPaywall, 800);
      });

    var loadLectureNotes =
      window._lnLoadFromSupabase ||
      window.lnLoadFromSupabase ||
      (typeof lnLoadFromSupabase === 'function' ? lnLoadFromSupabase : null);
    if (loadLectureNotes) {
      await loadLectureNotes(uid);
    } else {
      console.warn('Lecture notes loader is not ready yet');
    }

    if (typeof window._dwLoadAndRender === 'function') window._dwLoadAndRender();
  } catch (e) {
    console.warn('loadUserData error:', e);
  }
}

export function applyProfile(p) {
  if (!p) return;
  var n = document.getElementById('profileName');
  var e = document.getElementById('profileEmail');
  var u = document.getElementById('profileUniversity');
  var pr = document.getElementById('profileProgramme');
  var pv = document.getElementById('profileVertiefung');
  var m = document.getElementById('profileMatrikel');
  var i = document.getElementById('profileInitial');
  if (n && p.full_name) n.value = p.full_name;
  if (e && p.email) e.value = p.email;
  if (u && p.university) u.value = p.university;
  if (pr && p.programme) pr.value = p.programme;
  if (pv && p.vertiefung) pv.value = p.vertiefung;
  if (m && p.matrikel) m.value = p.matrikel;
  if (i && p.full_name) i.textContent = p.full_name.charAt(0).toUpperCase();
  if (p.vertiefung) {
    window._userVertiefung = p.vertiefung;
    localStorage.setItem('ss_vertiefung', p.vertiefung);
  }
  if (p.programme) {
    var MAJOR_LIST = window.MAJOR_LIST || [];
    var _rawMajor = p.programme.split(',')[0].trim();
    var _matchedMajor = MAJOR_LIST.find(function (m) {
      return m.toLowerCase() === _rawMajor.toLowerCase();
    });
    if (_matchedMajor) {
      window._userMajor = _matchedMajor;
      localStorage.setItem('ss_major', _matchedMajor);
    }
  }
  if (p.chat_username) window._chatUsername = p.chat_username;
  if (p.full_name && typeof window.updateAuthIndicator === 'function' && window._currentUser) {
    window.updateAuthIndicator(window._currentUser);
  }
  var _dcAv = document.getElementById('dcUserAv');
  var _dcNm = document.getElementById('dcUserName2');
  var _displayName =
    p.full_name ||
    (window._currentUser && window._currentUser.email
      ? window._currentUser.email.split('@')[0]
      : 'You');
  var _initial = _displayName.charAt(0).toUpperCase();
  if (_dcAv) _dcAv.textContent = _initial;
  if (_dcNm) _dcNm.textContent = _displayName;
  var _uid = (window._currentUser && window._currentUser.id) || '';
  window._userType = p.user_type || localStorage.getItem('ss_user_type_' + _uid) || 'enrolled';
  window._germanTest = p.german_test || localStorage.getItem('ss_german_test_' + _uid) || '';
  window._germanLevel = p.german_level || localStorage.getItem('ss_german_level_' + _uid) || '';
  if (_uid) {
    localStorage.setItem('ss_user_type_' + _uid, window._userType);
    localStorage.setItem('ss_german_test_' + _uid, window._germanTest);
    localStorage.setItem('ss_german_level_' + _uid, window._germanLevel);
  }
  applyUserTypeUI();
  window.dispatchEvent(new Event('ss-profile-updated'));
}

export function applyUserTypeUI() {
  var _userType = window._userType || 'enrolled';
  var _germanTest = window._germanTest || '';
  var _germanLevel = window._germanLevel || '';
  var isLearner = _userType === 'learner';

  var sub = document.getElementById('sbUserSub');
  if (sub)
    sub.textContent = isLearner
      ? (_germanTest || 'German Test') + (_germanLevel ? ' · ' + _germanLevel : '')
      : 'TU Braunschweig';

  var coursesNav = document.getElementById('pcStudip');
  var germanNav = document.getElementById('psbGerman');
  if (coursesNav) coursesNav.style.display = isLearner ? 'none' : '';
  if (germanNav) germanNav.style.display = isLearner ? '' : 'none';

  var glSub = document.getElementById('glTestBadge');
  var glChip = document.getElementById('glLevelChip');
  if (glSub) glSub.textContent = (_germanTest || 'German Test') + ' preparation';
  if (glChip) glChip.textContent = _germanLevel || '–';

  document.querySelectorAll('.pf-enrolled-field').forEach(function (el) {
    el.style.display = isLearner ? 'none' : '';
  });
  document.querySelectorAll('.pf-learner-field').forEach(function (el) {
    el.style.display = isLearner ? '' : 'none';
  });
  var gt = document.getElementById('profileGermanTest');
  var gl = document.getElementById('profileGermanLevel');
  if (gt && _germanTest) gt.value = _germanTest;
  if (gl && _germanLevel) gl.value = _germanLevel;
}
