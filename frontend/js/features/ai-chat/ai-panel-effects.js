export function initAiPanelEffects(options) {
  options = options || {};

  var aiMsgs = options.aiMsgs || document.getElementById('aiMsgs');
  if (aiMsgs && !aiMsgs.__ssFlashWrapped) {
    var _origAppend = aiMsgs.appendChild.bind(aiMsgs);
    aiMsgs.appendChild = function (el) {
      var result = _origAppend(el);
      aiMsgs.classList.remove('new-msg');
      void aiMsgs.offsetWidth;
      aiMsgs.classList.add('new-msg');
      setTimeout(function () {
        aiMsgs.classList.remove('new-msg');
      }, 700);
      return result;
    };
    aiMsgs.__ssFlashWrapped = true;
  }

  var aiPanel = options.aiPanel || document.getElementById('aiPanel');
  if (aiPanel && !aiPanel.__ssRippleBound) {
    aiPanel.addEventListener('click', function (e) {
      var btn = e.target.closest('button, .ai-tip, .chip-sub, .ai-sel-btn');
      if (!btn) return;
      var r = document.createElement('span');
      var rect = btn.getBoundingClientRect();
      var size = Math.max(rect.width, rect.height) * 1.5;
      r.style.cssText =
        'position:absolute;border-radius:50%;background:rgba(255,255,255,.3);width:' +
        size +
        'px;height:' +
        size +
        'px;' +
        'left:' +
        (e.clientX - rect.left - size / 2) +
        'px;top:' +
        (e.clientY - rect.top - size / 2) +
        'px;' +
        'animation:rippleOut .5s ease forwards;pointer-events:none;z-index:99';
      if (getComputedStyle(btn).position === 'static') btn.style.position = 'relative';
      btn.style.overflow = 'hidden';
      btn.appendChild(r);
      setTimeout(function () {
        r.remove();
      }, 520);
    });
    aiPanel.__ssRippleBound = true;
  }
}
