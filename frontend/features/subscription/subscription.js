(function () {
  var feature = {
    sectionId: 'psec-subscription',
    html: 'features/subscription/subscription.html',
    css: 'features/subscription/subscription.css'
  };
  if (window.StudySphere) {
    window.StudySphere.registerFeature('subscription', feature);
  } else {
    window.StudySphereFeatures = window.StudySphereFeatures || {};
    window.StudySphereFeatures.subscription = feature;
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
  var cfg = window.StudySphereConfig || {};
  if (cfg.paypalPlanId) {
    _paypalPlanId = String(cfg.paypalPlanId);
    return Promise.resolve(_paypalPlanId);
  }
  return _loadBillingConfig().then(function (payload) {
    _paypalPlanId = String((payload && payload.paypalPlanId) || '').trim();
    if (!_paypalPlanId) throw new Error('Missing PayPal plan configuration');
    window.StudySphereConfig = Object.assign({}, window.StudySphereConfig || {}, {
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
  showToast('Ã°Å¸Å½â€° Pro activated!', 'Enjoy unlimited access.');
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
        ? 'ðŸš€ Subscribe â€” â‚¬11.99/month'
        : 'ðŸŽ‰ Start free 7-day trial';
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
            showToast('Payment received', 'Activating your Pro plan...');
            try {
              await _activatePayPalSubscription(data, false);
              return;
            } catch (e) {
              showToast('Activation error', 'Contact support.');
            }
          },
          onError: function (err) {
            console.error('PayPal error:', err);
            showToast(
              'PayPal error',
              typeof err === 'string'
                ? err
                : (err && err.message) || 'Please try again or use card.'
            );
          }
        })
        .render('#paypalButtonContainer');
    })
    .catch(function (err) {
      _paypalRendered = false;
      console.warn('PayPal plan config failed to load:', err);
      showToast('Payment unavailable', 'Subscription configuration is missing.');
    })
    .finally(function () {
      _paypalRenderPending = false;
    });
}

function _showPaywall() {
  var btn = document.getElementById('paywallUpgradeBtn');
  if (btn)
    btn.textContent = _hadTrial
      ? 'ðŸš€ Subscribe â€” â‚¬11.99/month'
      : 'ðŸŽ‰ Start free 7-day trial';
  var modal = document.getElementById('paywallModal');
  if (_hadTrial && modal) {
    var trialBadge = modal.querySelector('.sub-trial-badge');
    if (trialBadge) trialBadge.style.display = 'none';
    var desc = modal.querySelector('[data-paywall-desc]');
    if (desc) desc.textContent = 'Subscribe to access all StudySphere features for â‚¬11.99/month.';
    var afterTrial = modal.querySelector('[data-after-trial]');
    if (afterTrial) afterTrial.textContent = '/ month';
    var cancelNote = modal.querySelector('[data-cancel-note]');
    if (cancelNote) cancelNote.textContent = 'Cancel anytime.';
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
                showToast('Payment received', 'Activating your Pro plan...');
                try {
                  await _activatePayPalSubscription(data, true);
                  return;
                } catch (e) {
                  showToast('Activation error', 'Contact support.');
                }
              },
              onError: function (err) {
                console.error('PayPal error:', err);
                showToast('PayPal error', 'Please try card instead.');
              }
            })
            .render('#paywallPaypal');
        })
        .catch(function (err) {
          _paywallPaypalRendered = false;
          console.warn('PayPal plan config failed to load:', err);
          showToast('Payment unavailable', 'Subscription configuration is missing.');
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
        showToast('Not available', 'No Stripe account found.');
        return;
      }
      this.textContent = 'Loading...';
      this.disabled = true;
      try {
        var data = await window._subService.createPortalSession();
        if (data.url) location.href = data.url;
        else showToast('Error', data.error || 'Could not open portal.');
      } catch (e) {
        showToast('Error', e.message);
      }
      this.textContent = 'âš™ï¸ Manage / Cancel subscription';
      this.disabled = false;
    });
  }

  var upgradeBtn = document.getElementById('subUpgradeBtn');
  if (upgradeBtn && !upgradeBtn.dataset.bound) {
    upgradeBtn.dataset.bound = '1';
    upgradeBtn.addEventListener('click', async function () {
      if (!_currentUser) {
        showToast('Sign in required', 'Please log in first.');
        return;
      }
      this.textContent = 'Redirecting...';
      this.disabled = true;
      try {
        var data = await window._subService.createCheckoutSession(_hadTrial);
        if (data.url) {
          location.href = data.url;
        } else {
          showToast('Error', data.error || 'Could not start checkout.');
          this.textContent = 'ðŸš€ Upgrade to Pro';
          this.disabled = false;
        }
      } catch (e) {
        showToast('Error', e.message);
        this.textContent = 'ðŸš€ Upgrade to Pro';
        this.disabled = false;
      }
    });
  }

  var paywallBtn = document.getElementById('paywallUpgradeBtn');
  if (paywallBtn && !paywallBtn.dataset.bound) {
    paywallBtn.dataset.bound = '1';
    paywallBtn.addEventListener('click', async function () {
      if (!_currentUser) return;
      this.textContent = 'Redirecting...';
      this.disabled = true;
      try {
        var data = await window._subService.createCheckoutSession(_hadTrial);
        if (data.url) location.href = data.url;
      } catch (e) {}
      this.textContent = 'ðŸŽ‰ Start free 7-day trial';
      this.disabled = false;
    });
  }
}

document.addEventListener('click', function (e) {
  if (e.target.closest('#psbSubscription'))
    setTimeout(function () {
      _bindSubscriptionControls();
      _initPayPalButton();
    }, 400);
});

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
    showToast('ðŸŽ‰ Payment successful!', 'Activating your Pro plan...');
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
          showToast('âœ… Pro activated!', 'Enjoy unlimited access.');
        }
      } catch (e) {
        console.warn('Verify payment error:', e);
      }
    }, 500);
  } else if (params.get('payment') === 'cancelled') {
    history.replaceState(null, '', location.pathname);
  }
})();
