(function () {
  function _subT(key, fallback) {
    return (window._t && window._t(key)) || fallback;
  }
  var feature = {
    sectionId: 'psec-subscription',
    html: 'views/subscription/subscription.html',
    css: 'views/subscription/subscription.css'
  };
  if (window.Minallo) {
    window.Minallo.registerFeature('subscription', feature);
  } else {
    window.MinalloFeatures = window.MinalloFeatures || {};
    window.MinalloFeatures.subscription = feature;
  }

  var section = document.getElementById('psec-subscription');
  if (section) section.dataset.feature = 'subscription';
})();

var _userIsPro = false;
var _stripeCustomerId = null;
var _hadTrial = false;
var _paypalRendered = false;
var _paywallPaypalRendered = false;
var _paypalRenderPending = false;
var _paywallPaypalRenderPending = false;
var _paypalPlanId = '';
var _billingConfigPromise = null;

function _loadBillingConfig() {
  if (_billingConfigPromise) return _billingConfigPromise;
  _billingConfigPromise = window._subService
    ? window._subService.loadBillingConfig()
    : Promise.reject(new Error('Subscription service not ready'));
  return _billingConfigPromise;
}

function _ensurePayPalPlanId() {
  if (_paypalPlanId) return Promise.resolve(_paypalPlanId);
  var cfg = window.MinalloConfig || {};
  if (cfg.paypalPlanId) {
    _paypalPlanId = String(cfg.paypalPlanId);
    return Promise.resolve(_paypalPlanId);
  }
  return _loadBillingConfig().then(function (payload) {
    _paypalPlanId = String((payload && payload.paypalPlanId) || '').trim();
    if (!_paypalPlanId) throw new Error('Missing PayPal plan configuration');
    window.MinalloConfig = Object.assign({}, window.MinalloConfig || {}, {
      paypalPlanId: _paypalPlanId
    });
    return _paypalPlanId;
  });
}

async function _activatePayPalSubscription(data, closePaywall) {
  if (!_currentUser) return;
  await window._subService.activatePayPalSubscription(data && data.subscriptionID);
  applySubscription({ plan: 'pro', status: 'active' });
  if (closePaywall) {
    var modal = document.getElementById('paywallModal');
    if (modal) modal.style.display = 'none';
  }
  showToast(_subT('sub_pro_activated', 'Pro activated!'), _subT('sub_pro_enjoy', 'Enjoy unlimited access.'));
}

function applySubscription(sub) {
  var expiresAt = sub && sub.expires_at ? Date.parse(sub.expires_at) : null;
  var isExpired = Number.isFinite(expiresAt) && expiresAt <= Date.now();
  _userIsPro = !!(sub && sub.plan === 'pro' && (sub.status === 'active' || sub.status === 'trialing') && !isExpired);
  if (sub && sub.stripe_customer_id) _stripeCustomerId = sub.stripe_customer_id;
  if (sub && sub.had_trial) _hadTrial = true;
  var proStatus = document.getElementById('subProStatus');
  var upgradeBtn = document.getElementById('subUpgradeBtn');
  var manageBtn = document.getElementById('subManageBtn');
  var payMethods = document.getElementById('subPayMethods');
  var paypalCont = document.getElementById('paypalButtonContainer');
  if (_userIsPro) {
    if (proStatus) proStatus.style.display = '';
    if (upgradeBtn) upgradeBtn.style.display = 'none';
    if (manageBtn) manageBtn.style.display = '';
    if (payMethods) payMethods.style.display = 'none';
    if (paypalCont) paypalCont.style.display = 'none';
  } else {
    if (proStatus) proStatus.style.display = 'none';
    if (upgradeBtn) {
      upgradeBtn.textContent = _hadTrial
        ? _subT('sub_subscribe', 'Subscribe — €11.99/month')
        : _subT('sub_start_trial', 'Start free 7-day trial');
      upgradeBtn.disabled = false;
      upgradeBtn.style.display = '';
      upgradeBtn.style.opacity = '';
    }
    if (manageBtn) manageBtn.style.display = 'none';
    if (payMethods) payMethods.style.display = '';
    if (paypalCont) paypalCont.style.display = '';
  }
  _bindSubscriptionControls();
}

function _initPayPalButton(attempt) {
  if (_paypalRendered || _paypalRenderPending) return;
  var container = document.getElementById('paypalButtonContainer');
  if (!container) return;
  if (typeof paypal === 'undefined') {
    _ssEnsurePayPalSdk()
      .then(function () {
        _initPayPalButton(attempt || 0);
      })
      .catch(function (err) {
        console.warn('PayPal SDK failed to load:', err);
      });
    return;
  }
  _paypalRenderPending = true;
  _ensurePayPalPlanId()
    .then(function (planId) {
      _paypalRendered = true;
      return paypal
        .Buttons({
          style: {
            layout: 'horizontal',
            color: 'blue',
            shape: 'rect',
            label: 'subscribe',
            height: 40
          },
          createSubscription: function (data, actions) {
            return actions.subscription.create({
              plan_id: planId,
              custom_id: _currentUser && _currentUser.id
            });
          },
          onApprove: async function (data) {
            showToast(_subT('sub_payment_received', 'Payment received'), _subT('sub_activating', 'Activating your Pro plan...'));
            try {
              await _activatePayPalSubscription(data, false);
              return;
            } catch (e) {
              showToast(_subT('sub_activation_error', 'Activation error'), _subT('sub_activation_error_sub', 'Contact support.'));
            }
          },
          onError: function (err) {
            console.error('PayPal error:', err);
            showToast(
              _subT('sub_paypal_error', 'PayPal error'),
              typeof err === 'string'
                ? err
                : (err && err.message) || _subT('sub_paypal_error_default', 'Please try again or use card.')
            );
          }
        })
        .render('#paypalButtonContainer');
    })
    .catch(function (err) {
      _paypalRendered = false;
      console.warn('PayPal plan config failed to load:', err);
      showToast(_subT('sub_payment_unavailable', 'Payment unavailable'), _subT('sub_payment_unavailable_sub', 'Subscription configuration is missing.'));
    })
    .finally(function () {
      _paypalRenderPending = false;
    });
}

function _showPaywall() {
  var btn = document.getElementById('paywallUpgradeBtn');
  if (btn)
    btn.textContent = _hadTrial
      ? _subT('sub_subscribe', 'Subscribe — €11.99/month')
      : _subT('sub_start_trial', 'Start free 7-day trial');
  var modal = document.getElementById('paywallModal');
  if (_hadTrial && modal) {
    var trialBadge = modal.querySelector('.sub-trial-badge');
    if (trialBadge) trialBadge.style.display = 'none';
    var desc = modal.querySelector('[data-paywall-desc]');
    if (desc) {
      desc.textContent = _subT('pw_desc_trialed', 'Subscribe to access all Minallo features for €11.99/month.');
      desc.removeAttribute('data-i18n');
    }
    var afterTrial = modal.querySelector('[data-after-trial]');
    if (afterTrial) {
      afterTrial.textContent = window._lang === 'de' ? '/ Monat' : '/ month';
      afterTrial.removeAttribute('data-i18n');
    }
    var cancelNote = modal.querySelector('[data-cancel-note]');
    if (cancelNote) {
      cancelNote.textContent = window._lang === 'de' ? 'Jederzeit kündbar.' : 'Cancel anytime.';
      cancelNote.removeAttribute('data-i18n');
    }
  }
  if (modal) modal.style.display = 'flex';
  if (!_paywallPaypalRendered && typeof paypal === 'undefined') {
    _ssEnsurePayPalSdk()
      .then(function () {
        _showPaywall();
      })
      .catch(function (err) {
        console.warn('PayPal SDK failed to load:', err);
      });
    return;
  }
  if (!_paywallPaypalRendered && !_paywallPaypalRenderPending && typeof paypal !== 'undefined') {
    var container = document.getElementById('paywallPaypal');
    if (container) {
      _paywallPaypalRenderPending = true;
      _ensurePayPalPlanId()
        .then(function (planId) {
          _paywallPaypalRendered = true;
          return paypal
            .Buttons({
              style: {
                layout: 'horizontal',
                color: 'blue',
                shape: 'rect',
                label: 'subscribe',
                height: 38
              },
              createSubscription: function (data, actions) {
                return actions.subscription.create({
                  plan_id: planId,
                  custom_id: _currentUser && _currentUser.id
                });
              },
              onApprove: async function (data) {
                showToast(_subT('sub_payment_received', 'Payment received'), _subT('sub_activating', 'Activating your Pro plan...'));
                try {
                  await _activatePayPalSubscription(data, true);
                  return;
                } catch (e) {
                  showToast(_subT('sub_activation_error', 'Activation error'), _subT('sub_activation_error_sub', 'Contact support.'));
                }
              },
              onError: function (err) {
                console.error('PayPal error:', err);
                showToast(_subT('sub_paypal_error', 'PayPal error'), _subT('sub_paypal_error_default', 'Please try again or use card.'));
              }
            })
            .render('#paywallPaypal');
        })
        .catch(function (err) {
          _paywallPaypalRendered = false;
          console.warn('PayPal plan config failed to load:', err);
          showToast(_subT('sub_payment_unavailable', 'Payment unavailable'), _subT('sub_payment_unavailable_sub', 'Subscription configuration is missing.'));
        })
        .finally(function () {
          _paywallPaypalRenderPending = false;
        });
    }
  }
}

function _requirePro(featureMsg) {
  if (_userIsPro) return true;
  _showPaywall();
  return false;
}

function _bindSubscriptionControls() {
  var manageBtn = document.getElementById('subManageBtn');
  if (manageBtn && !manageBtn.dataset.bound) {
    manageBtn.dataset.bound = '1';
    manageBtn.addEventListener('click', async function () {
      if (!_stripeCustomerId) {
        showToast(_subT('sub_not_available', 'Not available'), _subT('sub_no_stripe', 'No Stripe account found.'));
        return;
      }
      this.textContent = _subT('sub_loading', 'Loading...');
      this.disabled = true;
      try {
        var data = await window._subService.createPortalSession();
        if (data.url) location.href = data.url;
        else showToast(_subT('sub_error', 'Error'), data.error || _subT('sub_portal_failed', 'Could not open portal.'));
      } catch (e) {
        showToast(_subT('sub_error', 'Error'), e.message);
      }
      this.textContent = _subT('sub_manage', '⚙️ Manage / Cancel subscription');
      this.disabled = false;
    });
  }

  var upgradeBtn = document.getElementById('subUpgradeBtn');
  var consentBox = document.getElementById('subConsentWiderruf');
  if (consentBox && upgradeBtn && !consentBox.dataset.bound) {
    consentBox.dataset.bound = '1';
    var syncEnabled = function () {
      // Button stays disabled until the user actively ticks the Widerruf-Verzicht
      // consent. We capture this client-side and the create-checkout function
      // then records the choice in Stripe metadata so we have evidence of consent
      // per § 312j Abs. 3 / § 356 Abs. 5 BGB.
      upgradeBtn.disabled = !consentBox.checked;
    };
    consentBox.addEventListener('change', syncEnabled);
    syncEnabled();
  }

  if (upgradeBtn && !upgradeBtn.dataset.bound) {
    upgradeBtn.dataset.bound = '1';
    upgradeBtn.addEventListener('click', async function () {
      if (!_currentUser) {
        showToast(_subT('sub_signin_required', 'Sign in required'), _subT('sub_login_first', 'Please log in first.'));
        return;
      }
      if (consentBox && !consentBox.checked) {
        showToast('Hinweis', 'Bitte bestaetige die Widerrufs-Information, bevor du fortfaehrst.');
        return;
      }
      this.textContent = _subT('sub_redirecting', 'Redirecting...');
      this.disabled = true;
      try {
        var data = await window._subService.createCheckoutSession(_hadTrial, {
          consentWiderrufVerzicht: !!(consentBox && consentBox.checked),
          consentTimestamp: new Date().toISOString()
        });
        if (data.url) {
          location.href = data.url;
        } else {
          showToast(_subT('sub_error', 'Error'), data.error || _subT('sub_checkout_failed', 'Could not start checkout.'));
          this.textContent = _subT('sub_upgrade', 'Upgrade to Pro');
          this.disabled = false;
        }
      } catch (e) {
        showToast(_subT('sub_error', 'Error'), e.message);
        this.textContent = _subT('sub_upgrade', 'Upgrade to Pro');
        this.disabled = false;
      }
    });
  }

  var paywallBtn = document.getElementById('paywallUpgradeBtn');
  if (paywallBtn && !paywallBtn.dataset.bound) {
    paywallBtn.dataset.bound = '1';
    paywallBtn.addEventListener('click', async function () {
      if (!_currentUser) return;
      // Paywall has no inline consent block — route the user to the full
      // subscription view where the consent checkbox lives. This ensures the
      // Widerruf-Verzicht is captured before checkout in every flow.
      var modal = document.getElementById('paywallModal');
      if (modal) modal.style.display = 'none';
      if (typeof window.showPortalSection === 'function') {
        window.showPortalSection('subscription');
      }
    });
  }

  var paywallLogoutBtn = document.getElementById('paywallLogoutBtn');
  if (paywallLogoutBtn && !paywallLogoutBtn.dataset.bound) {
    paywallLogoutBtn.dataset.bound = '1';
    paywallLogoutBtn.addEventListener('click', function () {
      if (typeof window._sbSignOut === 'function') window._sbSignOut();
      else if (typeof window._obLogout === 'function') window._obLogout();
      else {
        localStorage.removeItem('sb_token');
        localStorage.removeItem('sb_refresh');
        sessionStorage.clear();
        window.location.reload();
      }
    });
  }
}

function _renderAiUsage() {
  if (typeof window.refreshAiUsage !== 'function') return;
  window.refreshAiUsage().then(function (u) {
    if (!u) return;
    var wrap = document.getElementById('subUsage');
    if (!wrap) return;
    var interactive = u.interactive || { used: u.used, limit: u.limit, percentUsed: u.percentUsed };
    var generation = u.generation || { used: 0, limit: 0, percentUsed: 0 };

    var fill = document.getElementById('subUsageFill');
    var count = document.getElementById('subUsageCount');
    if (fill && count) {
      fill.style.width = Math.min(100, interactive.percentUsed) + '%';
      count.textContent = interactive.used + ' / ' + interactive.limit + ' chat calls';
    }
    var fillGen = document.getElementById('subUsageFillGen');
    var countGen = document.getElementById('subUsageCountGen');
    if (fillGen && countGen) {
      fillGen.style.width = Math.min(100, generation.percentUsed) + '%';
      countGen.textContent = generation.used + ' / ' + generation.limit + ' generations';
    }
    wrap.hidden = false;
    var peak = Math.max(interactive.percentUsed, generation.percentUsed);
    wrap.classList.toggle('sub-usage--warn', peak >= 80 && peak < 100);
    wrap.classList.toggle('sub-usage--cap', peak >= 100);
  });
}

document.addEventListener('click', function (e) {
  if (e.target.closest('#psbSubscription'))
    setTimeout(function () {
      _bindSubscriptionControls();
      _initPayPalButton();
      _renderAiUsage();
    }, 400);
});

// Also initialise when the user lands on the subscription view directly
// (hash like #portal=subscription, or a page refresh while already there).
// The click handler above only fires when the menu item is actually clicked.
//
// Two timing problems to handle:
//   1. subscription.html is injected lazily by loader.js, so #subUsage may
//      not exist when our module first runs. We poll briefly until it does.
//   2. ss-ready (fired by loader.js when all features are loaded) is the
//      best one-shot signal — listen for it too.
function _initSubscriptionViewIfActive() {
  var hash = String(window.location.hash || '');
  if (!/portal=subscription/.test(hash)) return;
  var tries = 0;
  function attempt() {
    var el = document.getElementById('subUsage');
    if (el) {
      _bindSubscriptionControls();
      _initPayPalButton();
      _renderAiUsage();
      return;
    }
    if (tries++ < 20) setTimeout(attempt, 200);
  }
  attempt();
}
window.addEventListener('ss-ready', _initSubscriptionViewIfActive);
window.addEventListener('hashchange', _initSubscriptionViewIfActive);
// Re-apply translated button labels + paywall override text when the user
// switches language; data-i18n covers static text but the upgrade button
// label is set imperatively by applySubscription().
window.addEventListener('minallo:lang-changed', function () {
  try {
    if (typeof applySubscription === 'function' && _userIsPro !== undefined) {
      applySubscription({ plan: _userIsPro ? 'pro' : 'free', status: _userIsPro ? 'active' : 'inactive', had_trial: _hadTrial });
    }
  } catch (e) { /* ignore */ }
});
if (document.readyState !== 'loading') _initSubscriptionViewIfActive();
else document.addEventListener('DOMContentLoaded', _initSubscriptionViewIfActive);

document.addEventListener(
  'keydown',
  function (e) {
    if (e.key === 'Escape' && !_userIsPro) e.stopImmediatePropagation();
  },
  true
);

(function () {
  var params = new URLSearchParams(location.search);
  if (params.get('payment') === 'success') {
    var sessionId = params.get('session_id');
    history.replaceState(null, '', location.pathname);
    showToast(_subT('sub_payment_success', 'Payment successful!'), _subT('sub_activating', 'Activating your Pro plan...'));
    var attempts = 0;
    var verify = setInterval(async function () {
      attempts++;
      if (!_currentUser && attempts < 20) return;
      clearInterval(verify);
      if (!_currentUser || !sessionId) return;
      try {
        var data = await window._subService.verifyPayment(sessionId);
        if (data.ok) {
          applySubscription({ plan: 'pro', status: 'active', expires_at: data.expires_at || null });
          var modal = document.getElementById('paywallModal');
          if (modal) modal.style.display = 'none';
          showToast(_subT('sub_pro_activated', '✅ Pro activated!'), _subT('sub_pro_enjoy', 'Enjoy unlimited access.'));
        }
      } catch (e) {
        console.warn('Verify payment error:', e);
      }
    }, 500);
  } else if (params.get('payment') === 'cancelled') {
    history.replaceState(null, '', location.pathname);
  }
})();
