import { initAuthModal } from './auth-modal.js';
import {
  startPresenceHeartbeat,
  loadUserData,
  applyProfile,
  applyUserTypeUI
} from './user-data.js';

export function initAuthBridge(options) {
  var authModal = initAuthModal({
    sb: options.sb,
    t: options.t,
    getCurrentUser: options.getCurrentUser,
    verifyAndEnter: options.verifyAndEnter,
    enterApp: options.enterApp,
    resetActivityTimer: options.resetActivityTimer
  });

  function setAuthMode(mode) {
    authModal.setAuthMode(mode);
  }

  function updateAuthIndicator(user) {
    authModal.updateAuthIndicator(user);
  }

  function handleAuthClick() {
    authModal.handleAuthClick();
  }

  function applyUserTypeUiBridge() {
    applyUserTypeUI();
  }

  window._setAuthMode = setAuthMode;
  Object.defineProperty(window, '_authMode', {
    configurable: true,
    get: function () {
      return authModal.getAuthMode();
    }
  });
  window.updateAuthIndicator = updateAuthIndicator;
  window.loadUserData = loadUserData;
  window.applyProfile = applyProfile;
  window._applyUserTypeUI = applyUserTypeUiBridge;

  return {
    showAuthModal: function (mode) {
      authModal.showAuthModal(mode);
    },
    getAuthMode: function () {
      return authModal.getAuthMode();
    },
    setAuthMode: setAuthMode,
    updateAuthIndicator: updateAuthIndicator,
    handleAuthClick: handleAuthClick,
    startPresenceHeartbeat: startPresenceHeartbeat,
    loadUserData: loadUserData,
    applyProfile: applyProfile,
    applyUserTypeUI: applyUserTypeUiBridge
  };
}
