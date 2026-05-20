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
var _userIsPaused = false;
var _stripeCustomerId = null;
var _paypalSubscriptionId = null;
var _hadTrial = false;
var _deviceHadTrial = false;
var _pauseResumesAt = null;
var _lastSubscription = {};
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

function _trialDeviceId() {
  var key = 'minallo_trial_device_id';
  try {
    var existing = localStorage.getItem(key);
    if (existing) return existing;
    var id = (crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : String(Date.now()) + '-' + Math.random().toString(16).slice(2);
    localStorage.setItem(key, id);
    return id;
  } catch (e) {
    return '';
  }
}

function _deviceTrialUsed() {
  try {
    return localStorage.getItem('minallo_trial_used') === '1';
  } catch (e) {
    return false;
  }
}

function _markDeviceTrialUsed() {
  _deviceHadTrial = true;
  try {
    localStorage.setItem('minallo_trial_used', '1');
  } catch (e) { /* ignore */ }
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
  await window._subService.activatePayPalSubscription(data && data.subscriptionID, _trialDeviceId());
  applySubscription({ plan: 'pro', status: 'active' });
  if (closePaywall) {
    var modal = document.getElementById('paywallModal');
    if (modal) modal.style.display = 'none';
  }
  showToast(_subT('sub_pro_activated', 'Pro activated!'), _subT('sub_pro_enjoy', 'Enjoy unlimited access.'));
}

function applySubscription(sub) {
  _lastSubscription = sub || {};
  var expiresAt = sub && sub.expires_at ? Date.parse(sub.expires_at) : null;
  var isPaused = !!(sub && sub.status === 'paused');
  var isExpired = !isPaused && Number.isFinite(expiresAt) && expiresAt <= Date.now();
  var status = sub && sub.status ? String(sub.status) : '';
  var hasBillingProvider = !!(sub && (sub.stripe_subscription_id || sub.stripe_customer_id || sub.paypal_subscription_id));
  var dbManagedPro =
    !!(sub && sub.plan === 'pro' && !hasBillingProvider && ['cancelled', 'expired', 'past_due', 'paused'].indexOf(status) === -1);
  _userIsPro = !!(
    sub &&
    sub.plan === 'pro' &&
    ((status === 'active' || status === 'trialing') || dbManagedPro) &&
    !isExpired
  );
  _userIsPaused = isPaused;
  _pauseResumesAt = sub && sub.pause_resumes_at ? sub.pause_resumes_at : null;
  if (sub && sub.stripe_customer_id) _stripeCustomerId = sub.stripe_customer_id;
  if (sub && sub.paypal_subscription_id) _paypalSubscriptionId = sub.paypal_subscription_id;
  if (sub && sub.had_trial) _hadTrial = true;
  if (_deviceTrialUsed()) _deviceHadTrial = true;
  var proStatus = document.getElementById('subProStatus');
  var upgradeBtn = document.getElementById('subUpgradeBtn');
  var manageBtn = document.getElementById('subManageBtn');
  var cancelBtn = document.getElementById('subCancelBtn');
  var pausePanel = document.getElementById('subPausePanel');
  var resumePanel = document.getElementById('subResumePanel');
  var pausedUntil = document.getElementById('subPausedUntil');
  var payMethods = document.getElementById('subPayMethods');
  var paypalCont = document.getElementById('paypalButtonContainer');
  if (_userIsPro) {
    var scheduledCancel = !!(sub && sub.cancel_at_period_end);
    if (proStatus) {
      if (scheduledCancel && expiresAt) {
        var endStr = new Date(expiresAt).toLocaleDateString();
        proStatus.textContent =
          _subT('sub_status_ends_pre', '⏳ Pro access until ') + endStr;
      } else {
        proStatus.textContent = _subT('sub_status_active', '✓ Active subscription');
      }
      proStatus.style.display = '';
    }
    if (upgradeBtn) upgradeBtn.style.display = 'none';
    if (manageBtn) manageBtn.style.display = _stripeCustomerId ? '' : 'none';
    // Hide the standalone Cancel button when a Stripe customer exists OR when
    // cancellation is already scheduled — there's nothing more to cancel.
    if (cancelBtn) cancelBtn.style.display = (_stripeCustomerId || scheduledCancel) ? 'none' : '';
    // No vacation pause when a cancellation is already pending.
    if (pausePanel) pausePanel.style.display = scheduledCancel ? 'none' : '';
    if (resumePanel) resumePanel.style.display = 'none';
    if (payMethods) payMethods.style.display = 'none';
    if (paypalCont) paypalCont.style.display = 'none';
  } else if (_userIsPaused) {
    if (proStatus) {
      proStatus.style.display = '';
      proStatus.textContent = _subT('sub_paused_status', 'Paused subscription');
    }
    if (upgradeBtn) upgradeBtn.style.display = 'none';
    if (manageBtn) manageBtn.style.display = _stripeCustomerId ? '' : 'none';
    if (cancelBtn) cancelBtn.style.display = _stripeCustomerId ? 'none' : '';
    if (pausePanel) pausePanel.style.display = 'none';
    if (resumePanel) resumePanel.style.display = '';
    if (pausedUntil) {
      var dt = _pauseResumesAt ? new Date(_pauseResumesAt) : null;
      pausedUntil.textContent =
        dt && Number.isFinite(dt.getTime())
          ? _subT('sub_paused_until_pre', 'Pro access is paused until ') + dt.toLocaleDateString() + '.'
          : _subT('sub_paused_copy', 'Pro access is paused during your vacation.');
    }
    if (payMethods) payMethods.style.display = 'none';
    if (paypalCont) paypalCont.style.display = 'none';
  } else {
    if (proStatus) proStatus.style.display = 'none';
    if (upgradeBtn) {
      upgradeBtn.textContent = (_hadTrial || _deviceHadTrial)
        ? _subT('sub_subscribe', 'Subscribe — €11.99/month')
        : _subT('sub_start_trial', 'Start free 7-day trial');
      upgradeBtn.disabled = false;
      upgradeBtn.style.display = '';
      upgradeBtn.style.opacity = '';
    }
    if (manageBtn) manageBtn.style.display = 'none';
    if (cancelBtn) cancelBtn.style.display = 'none';
    if (pausePanel) pausePanel.style.display = 'none';
    if (resumePanel) resumePanel.style.display = 'none';
    if (payMethods) payMethods.style.display = '';
    if (paypalCont) paypalCont.style.display = '';
  }
  _bindSubscriptionControls();
}

async function _refreshSubscriptionState() {
  if (!_currentUser || !_currentUser.id) return;
  var sub = null;
  try {
    if (window._sb && window._sb.from) {
      sub = await window._sb.from('subscriptions').select('*').eq('user_id', _currentUser.id).single();
    }
  } catch (e) {
    sub = null;
  }

  if (sub && sub.status !== 'paused' && sub.expires_at && Date.parse(sub.expires_at) <= Date.now()) {
    sub = Object.assign({}, sub, { status: 'expired' });
  }

  var status = sub && sub.status ? String(sub.status) : '';
  var hasBillingProvider = !!(sub && (sub.stripe_subscription_id || sub.stripe_customer_id || sub.paypal_subscription_id));
  var dbManagedPro =
    !!(sub && sub.plan === 'pro' && !hasBillingProvider && ['cancelled', 'expired', 'past_due', 'paused'].indexOf(status) === -1);
  if (sub && sub.plan === 'pro' && (['active', 'trialing', 'paused'].indexOf(status) !== -1 || dbManagedPro)) {
    applySubscription(dbManagedPro ? Object.assign({}, sub, { status: status || 'active' }) : sub);
    return;
  }

  try {
    var adminRes = await fetch('/api/admin-users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + (window._sbToken || '')
      },
      body: JSON.stringify({ action: 'status' })
    });
    var adminData = adminRes.ok ? await adminRes.json().catch(function () { return null; }) : null;
    if (adminData && adminData.isAdmin) {
      applySubscription(Object.assign({}, sub || {}, {
        plan: 'pro',
        status: sub && sub.status === 'paused' ? 'paused' : 'active',
        admin_managed: true
      }));
      return;
    }
  } catch (e) {
    // Local Vite without Netlify dev can fail this route; the DB row above is
    // still enough for normal subscribed accounts.
  }

  applySubscription(sub || {});
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
    btn.textContent = (_hadTrial || _deviceHadTrial)
      ? _subT('sub_subscribe', 'Subscribe — €11.99/month')
      : _subT('sub_start_trial', 'Start free 7-day trial');
  var modal = document.getElementById('paywallModal');
  if ((_hadTrial || _deviceHadTrial) && modal) {
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
        var data = await window._subService.createCheckoutSession(_hadTrial || _deviceHadTrial, {
          consentWiderrufVerzicht: !!(consentBox && consentBox.checked),
          consentTimestamp: new Date().toISOString()
        }, _trialDeviceId());
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

  var pauseDate = document.getElementById('subPauseResumeAt');
  if (pauseDate && !pauseDate.dataset.initialized) {
    pauseDate.dataset.initialized = '1';
    var now = new Date();
    var min = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    var max = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    var toDateValue = function (d) {
      return d.toISOString().slice(0, 10);
    };
    pauseDate.min = toDateValue(min);
    pauseDate.max = toDateValue(max);
    pauseDate.value = toDateValue(min);
  }

  var pauseBtn = document.getElementById('subPauseBtn');
  if (pauseBtn && !pauseBtn.dataset.bound) {
    pauseBtn.dataset.bound = '1';
    pauseBtn.addEventListener('click', async function () {
      if (!_currentUser) return;
      var dateInput = document.getElementById('subPauseResumeAt');
      var resumeAt = dateInput && dateInput.value ? dateInput.value + 'T12:00:00.000Z' : '';
      if (!resumeAt) {
        showToast(_subT('sub_error', 'Error'), 'Choose a resume date.');
        return;
      }
      this.textContent = _subT('sub_pausing', 'Pausing...');
      this.disabled = true;
      try {
        var data = await window._subService.pauseSubscription(resumeAt, 'Vacation pause');
        applySubscription({
          plan: 'pro',
          status: 'paused',
          pause_resumes_at: data.pause_resumes_at || null,
          stripe_customer_id: _stripeCustomerId,
          paypal_subscription_id: _paypalSubscriptionId,
          had_trial: _hadTrial
        });
        // Backend signals auto_resumes=false for PayPal — PayPal /suspend has
        // no scheduled resume, so tell the user they must manually press
        // Resume on the chosen date instead of promising it happens for them.
        if (data && data.auto_resumes === false) {
          showToast(
            _subT('sub_paused_toast_title', 'Subscription paused'),
            _subT(
              'sub_paused_manual_resume',
              'Your Pro access is paused. PayPal subscriptions do not auto-resume — come back here on your return date and tap Resume.'
            )
          );
        } else {
          showToast(
            _subT('sub_paused_toast_title', 'Subscription paused'),
            _subT('sub_paused_toast_body', 'Your Pro access is paused until the selected date.')
          );
        }
      } catch (e) {
        showToast(_subT('sub_error', 'Error'), e.message || _subT('sub_pause_failed', 'Could not pause subscription.'));
      }
      this.textContent = _subT('sub_pause_btn', 'Pause subscription');
      this.disabled = false;
    });
  }

  var resumeBtn = document.getElementById('subResumeBtn');
  if (resumeBtn && !resumeBtn.dataset.bound) {
    resumeBtn.dataset.bound = '1';
    resumeBtn.addEventListener('click', async function () {
      if (!_currentUser) return;
      this.textContent = _subT('sub_resuming', 'Resuming...');
      this.disabled = true;
      try {
        var data = await window._subService.resumeSubscription();
        applySubscription({
          plan: 'pro',
          status: 'active',
          expires_at: data.expires_at || null,
          stripe_customer_id: _stripeCustomerId,
          paypal_subscription_id: _paypalSubscriptionId,
          had_trial: _hadTrial
        });
        showToast(
          _subT('sub_resumed_toast_title', 'Subscription resumed'),
          _subT('sub_resumed_toast_body', 'Your Pro access is active again.')
        );
      } catch (e) {
        showToast(_subT('sub_error', 'Error'), e.message || _subT('sub_resume_failed', 'Could not resume subscription.'));
      }
      this.textContent = _subT('sub_resume_btn', 'Resume now');
      this.disabled = false;
    });
  }

  var cancelBtn = document.getElementById('subCancelBtn');
  if (cancelBtn && !cancelBtn.dataset.bound) {
    cancelBtn.dataset.bound = '1';
    cancelBtn.addEventListener('click', async function () {
      if (!_currentUser) return;
      if (!confirm(_subT('sub_cancel_confirm', 'Cancel this subscription now?'))) return;
      this.textContent = _subT('sub_cancelling', 'Cancelling...');
      this.disabled = true;
      try {
        var data = await window._subService.cancelSubscription();
        if (data && data.status === 'scheduled' && data.expires_at) {
          // Stripe cancel-at-period-end — user still has Pro until expires_at.
          applySubscription({
            plan: 'pro',
            status: 'active',
            expires_at: data.expires_at,
            cancel_at_period_end: true,
            stripe_customer_id: _stripeCustomerId,
            paypal_subscription_id: _paypalSubscriptionId,
            had_trial: _hadTrial
          });
          var endDate = new Date(data.expires_at);
          var endStr = Number.isFinite(endDate.getTime()) ? endDate.toLocaleDateString() : '';
          showToast(
            _subT('sub_cancelled_scheduled_title', 'Cancellation scheduled'),
            _subT('sub_cancelled_scheduled_body_pre', 'You will keep Pro access until ') + endStr + '.'
          );
        } else {
          applySubscription({ plan: 'free', status: 'cancelled', had_trial: _hadTrial });
          showToast(
            _subT('sub_cancelled_title', 'Subscription cancelled'),
            _subT('sub_cancelled_body', 'Your subscription has been cancelled.')
          );
        }
      } catch (e) {
        showToast(_subT('sub_error', 'Error'), e.message || _subT('sub_cancel_failed', 'Could not cancel subscription.'));
      }
      this.textContent = _subT('sub_cancel_btn', 'Cancel subscription');
      this.disabled = false;
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
      applySubscription(_lastSubscription);
      _bindSubscriptionControls();
      _initPayPalButton();
      _renderAiUsage();
      _refreshSubscriptionState().then(function () {
        _bindSubscriptionControls();
      });
      return;
    }
    if (tries++ < 20) setTimeout(attempt, 200);
  }
  attempt();
}
window.addEventListener('ss-ready', _initSubscriptionViewIfActive);
window.addEventListener('hashchange', _initSubscriptionViewIfActive);
window.addEventListener('ss-profile-updated', _initSubscriptionViewIfActive);
// Re-apply translated button labels + paywall override text when the user
// switches language; data-i18n covers static text but the upgrade button
// label is set imperatively by applySubscription().
window.addEventListener('minallo:lang-changed', function () {
  try {
    if (typeof applySubscription === 'function' && _userIsPro !== undefined) {
      var current = Object.assign({}, _lastSubscription || {}, {
        plan: _userIsPro || _userIsPaused ? 'pro' : ((_lastSubscription || {}).plan || 'free'),
        status: _userIsPaused ? 'paused' : (_userIsPro ? 'active' : ((_lastSubscription || {}).status || 'inactive')),
        had_trial: _hadTrial
      });
      applySubscription(current);
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
          if (data.had_trial) _markDeviceTrialUsed();
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
