import {
  chipPrompt as _chipPrompt,
  closeAllOpts as _closeAllOpts,
  initChipListeners
} from './ai-chips.js';

export function initAiChipsBridge() {
  window.chipPrompt = function (type, level) {
    return _chipPrompt(type, level);
  };

  window.closeAllOpts = function () {
    return _closeAllOpts();
  };

  initChipListeners();

  return {
    chipPrompt: window.chipPrompt,
    closeAllOpts: window.closeAllOpts
  };
}
