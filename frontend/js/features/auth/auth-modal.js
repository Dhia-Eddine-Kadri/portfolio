export function initAuthModal(options) {
  var sb = options.sb;
  var t = options.t;
  var getCurrentUser = options.getCurrentUser;
  var verifyAndEnter = options.verifyAndEnter;
  var enterApp = options.enterApp;
  var resetActivityTimer = options.resetActivityTimer;

  var authMode = 'signin';
  var authModal = document.getElementById('authModal');
  var authEmail = document.getElementById('authEmail');
  var authPassword = document.getElementById('authPassword');
  var authSubmit = document.getElementById('authSubmit');
  var authSwitch = document.getElementById('authSwitch');
  var authError = document.getElementById('authError');
  var authTitle = document.getElementById('authTitle');
  var authConfirm = document.getElementById('authConfirm');
  var togglePw = document.getElementById('togglePw');
  var toggleConfirm = document.getElementById('toggleConfirm');
  var googleSignIn = document.getElementById('googleSignIn');

  function setSubmitIdleLabel() {
    if (!authSubmit) return;
    authSubmit.textContent =
      authMode === 'signin' ? 'Sign In' : 'Create Account';
    authSubmit.disabled = false;
  }

  function showAuthError(msg) {
    if (!authError) return;
    authError.textContent = msg;
    authError.style.display = 'block';
  }

  function hideAuthError() {
    if (!authError) return;
    authError.style.display = 'none';
  }

  function setAuthMode(mode) {
    authMode = mode;
    var isSignup = mode === 'signup';
    if (authTitle) {
      authTitle.textContent = isSignup
        ? t('auth_title_signup')
        : t('auth_title_signin');
    }
    if (authSubmit) {
      authSubmit.textContent = isSignup
        ? t('auth_submit_signup')
        : t('auth_submit_signin');
    }
    if (authSwitch) {
      authSwitch.textContent = isSignup
        ? t('auth_switch_signup')
        : t('auth_switch_signin');
    }
    var confirmWrap = document.getElementById('authConfirmWrap');
    var strengthWrap = document.getElementById('pwStrengthWrap');
    if (confirmWrap) confirmWrap.style.display = isSignup ? 'flex' : 'none';
    if (strengthWrap) strengthWrap.style.display = isSignup ? 'block' : 'none';
    if (!isSignup) {
      if (authConfirm) authConfirm.value = '';
      var hint = document.getElementById('authConfirmHint');
      if (hint) hint.textContent = '';
      ['pws1', 'pws2', 'pws3', 'pws4'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.style.background = 'rgba(255,255,255,.1)';
      });
      var lbl = document.getElementById('pwStrengthLabel');
      if (lbl) lbl.textContent = '';
    }
    hideAuthError();
  }

  function updateStrengthMeter() {
    if (authMode !== 'signup' || !authPassword) return;
    var pw = authPassword.value;
    var score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score = Math.min(score + 1, 4);
    score = Math.min(score, 4);
    var colors = ['#ef4444', '#f97316', '#eab308', '#22c55e'];
    var labels = ['Weak', 'Fair', 'Good', 'Strong'];
    ['pws1', 'pws2', 'pws3', 'pws4'].forEach(function (id, i) {
      var el = document.getElementById(id);
      if (el) {
        el.style.background =
          i < score ? colors[score - 1] : 'rgba(255,255,255,.1)';
      }
    });
    var lbl = document.getElementById('pwStrengthLabel');
    if (!lbl) return;
    lbl.textContent = pw.length ? labels[score - 1] || '' : '';
    lbl.style.color = score > 0 ? colors[score - 1] : 'rgba(255,255,255,.35)';
  }

  function updateConfirmHint() {
    if (!authConfirm) return;
    var hint = document.getElementById('authConfirmHint');
    if (!hint) return;
    var pw = authPassword ? authPassword.value : '';
    if (!authConfirm.value) {
      hint.textContent = '';
      return;
    }
    if (authConfirm.value === pw) {
      hint.textContent = 'Passwords match';
      hint.style.color = '#22c55e';
    } else {
      hint.textContent = 'Passwords do not match';
      hint.style.color = '#ef4444';
    }
  }

  async function submitAuth() {
    if (!sb) {
      showAuthError(t('err_connection'));
      return;
    }
    var email = authEmail ? authEmail.value.trim() : '';
    var password = authPassword ? authPassword.value : '';
    if (!email || !password) {
      showAuthError(t('err_fill_fields'));
      return;
    }

    if (authSubmit) {
      authSubmit.textContent = 'Please wait...';
      authSubmit.disabled = true;
    }
    hideAuthError();

    try {
      if (authMode === 'signup') {
        var confirmVal = authConfirm ? authConfirm.value : '';
        if (!confirmVal) {
          showAuthError(t('err_confirm_pw'));
          if (authSubmit) {
            authSubmit.textContent = t('auth_submit_signup');
            authSubmit.disabled = false;
          }
          return;
        }
        if (password !== confirmVal) {
          showAuthError(t('err_pw_mismatch'));
          if (authSubmit) {
            authSubmit.textContent = t('auth_submit_signup');
            authSubmit.disabled = false;
          }
          return;
        }
        if (password.length < 8) {
          showAuthError(t('err_pw_length'));
          if (authSubmit) {
            authSubmit.textContent = t('auth_submit_signup');
            authSubmit.disabled = false;
          }
          return;
        }

        var signUpResult = await sb.auth.signUp(
          email,
          password,
          'https://studysphere-website.netlify.app/'
        );

        if (signUpResult.error || signUpResult.error_description) {
          throw new Error(signUpResult.error_description || signUpResult.error);
        }

        sessionStorage.setItem('pendingConfirm', email);

        if (signUpResult.access_token) {
          localStorage.setItem('sb_token', signUpResult.access_token);
          if (signUpResult.refresh_token) {
            localStorage.setItem('sb_refresh', signUpResult.refresh_token);
          }
          verifyAndEnter(signUpResult.access_token);
          return;
        }

        if (signUpResult.id || (signUpResult.user && signUpResult.user.id)) {
          showAuthError(t('err_account_created'));
          if (authSubmit) {
            authSubmit.textContent = 'Create Account';
            authSubmit.disabled = false;
          }
          return;
        }

        throw new Error('Signup failed - please try again.');
      }

      var signInResult = await sb.auth.signIn(email, password);
      if (!signInResult.access_token) {
        var msg = (
          signInResult.error_description ||
          signInResult.error ||
          signInResult.msg ||
          ''
        ).toLowerCase();

        if (msg.includes('not confirmed') || msg.includes('email not confirmed')) {
          showAuthError(t('err_confirm_email'));
          setSubmitIdleLabel();
          return;
        }

        showAuthError(t('err_wrong_pw'));
        setSubmitIdleLabel();
        return;
      }
    } catch (e) {
      var msg = e && e.message ? e.message : String(e);
      if (msg.includes('fetch')) {
        showAuthError(t('err_network'));
      } else {
        showAuthError(msg);
      }
    } finally {
      if (authSubmit && authSubmit.textContent === 'Please wait...') {
        setSubmitIdleLabel();
      }
    }
  }

  function updateAuthIndicator(user) {
    if (!user) return;
    var profileNameEl = document.getElementById('profileName');
    var profileName = profileNameEl && profileNameEl.value ? profileNameEl.value : null;
    var name =
      profileName ||
      (user.user_metadata && user.user_metadata.full_name) ||
      (user.email ? user.email.split('@')[0] : 'User');
    var initial = name.charAt(0).toUpperCase();
    var av = document.getElementById('authAvatar');
    var nm = document.getElementById('authName');
    if (av) av.textContent = initial;
    if (nm) nm.textContent = name;
    var ai = document.getElementById('authIndicator');
    if (ai) ai.style.display = 'flex';
    var dcAv = document.getElementById('dcUserAv');
    var dcNm = document.getElementById('dcUserName2');
    if (dcAv && dcAv.textContent === '?') dcAv.textContent = initial;
    if (dcNm && dcNm.textContent === 'You') dcNm.textContent = name;
  }

  function handleAuthClick() {
    var currentUser = getCurrentUser();
    if (currentUser) {
      if (confirm('Sign out of StudySphere?')) {
        sb.auth.signOut().then(function () {
          var authAvatar = document.getElementById('authAvatar');
          var authName = document.getElementById('authName');
          if (authAvatar) authAvatar.textContent = '?';
          if (authName) authName.textContent = 'Sign in';
        });
      }
    } else if (authModal) {
      authModal.style.display = 'flex';
    }
  }

  function showAuthModal(mode) {
    var landing = document.getElementById('landing');
    if (landing) landing.classList.add('hidden');
    if (authModal) authModal.style.display = 'flex';
    if (mode === 'signup' && authMode !== 'signup') {
      setAuthMode('signup');
    } else if (mode === 'signin' && authMode !== 'signin') {
      setAuthMode('signin');
    }
  }

  if (authSwitch) {
    authSwitch.addEventListener('click', function () {
      setAuthMode(authMode === 'signin' ? 'signup' : 'signin');
    });
  }
  if (authPassword) authPassword.addEventListener('input', updateStrengthMeter);
  if (authConfirm) authConfirm.addEventListener('input', updateConfirmHint);
  if (authSubmit) authSubmit.addEventListener('click', submitAuth);
  [authEmail, authPassword].forEach(function (el) {
    if (!el) return;
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && authSubmit) authSubmit.click();
    });
  });
  if (togglePw) {
    togglePw.addEventListener('click', function () {
      if (!authPassword) return;
      authPassword.type = authPassword.type === 'password' ? 'text' : 'password';
      togglePw.textContent = authPassword.type === 'password' ? '\u{1F441}' : '\u{1F648}';
    });
  }
  if (toggleConfirm) {
    toggleConfirm.addEventListener('click', function () {
      if (!authConfirm) return;
      authConfirm.type = authConfirm.type === 'password' ? 'text' : 'password';
      toggleConfirm.textContent = authConfirm.type === 'password' ? '\u{1F441}' : '\u{1F648}';
    });
  }
  if (googleSignIn) {
    googleSignIn.addEventListener('click', function () {
      if (typeof window._googleAuth === 'function') window._googleAuth();
    });
  }

  if (sb && sb.auth && typeof sb.auth.onAuthStateChange === 'function') {
    sb.auth.onAuthStateChange(function (event, data) {
      if (event === 'SIGNED_IN') {
        var currentUser = getCurrentUser();
        if (currentUser) enterApp(currentUser);
        resetActivityTimer();
      } else if (event === 'SIGNED_OUT') {
        window.location.reload();
      }
    });
  }

  return {
    getAuthMode: function () {
      return authMode;
    },
    setAuthMode: setAuthMode,
    showAuthModal: showAuthModal,
    updateAuthIndicator: updateAuthIndicator,
    handleAuthClick: handleAuthClick
  };
}
