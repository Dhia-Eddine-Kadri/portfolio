import { adminShowIfEligible } from '../admin/admin-panel.js';
import { showOnboarding } from './onboarding.js';

export function initLandingAuthBridge(options) {
  var authBridge = options.authBridge;

  function showAuth(mode) {
    if (authBridge && typeof authBridge.showAuthModal === 'function') {
      authBridge.showAuthModal(mode);
    }
  }

  window._adminShowIfEligible = adminShowIfEligible;
  window._showOnboarding = showOnboarding;
  window.landShowAuth = showAuth;

  return {
    showAuth: showAuth,
    showOnboarding: showOnboarding,
    adminShowIfEligible: adminShowIfEligible
  };
}
