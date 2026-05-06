export function initPullToRefresh() {
  var THRESHOLD = 80;
  var startY = 0;
  var curY = 0;
  var active = false;

  var ind = document.createElement('div');
  ind.id = 'ptr-indicator';
  ind.innerHTML =
    '<svg id="ptr-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="4" x2="12" y2="20"/><polyline points="18 14 12 20 6 14"/></svg>';
  ind.style.cssText =
    'position:fixed;top:-50px;left:50%;transform:translateX(-50%);width:32px;height:32px;border-radius:50%;background:rgba(20,15,40,.88);box-shadow:0 2px 12px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:9999;transition:top .15s ease,opacity .15s ease;opacity:0;color:#fff;pointer-events:none';
  document.body.appendChild(ind);

  var arrow = ind.querySelector('#ptr-arrow');

  function setProgress(dy) {
    var p = Math.min(dy / THRESHOLD, 1);
    var top = Math.min(-60 + dy * 0.9, 16);
    ind.style.top = top + 'px';
    ind.style.opacity = p;
    arrow.style.transform = 'rotate(' + (-180 + 180 * p) + 'deg)';
    arrow.style.transition = 'transform .1s';
  }

  function reset() {
    ind.style.top = '-60px';
    ind.style.opacity = '0';
    arrow.style.transform = 'rotate(0deg)';
  }

  document.addEventListener(
    'touchstart',
    function (e) {
      var appEl = document.getElementById('app');
      var inPdf = appEl && appEl.style.display === 'flex';
      startY = e.touches[0].clientY;
      active = !inPdf && (window.scrollY === 0 || document.documentElement.scrollTop === 0);
    },
    { passive: true }
  );

  document.addEventListener(
    'touchmove',
    function (e) {
      if (!active) return;
      curY = e.touches[0].clientY;
      var dy = curY - startY;
      if (dy > 0) setProgress(dy);
    },
    { passive: true }
  );

  document.addEventListener(
    'touchend',
    function () {
      if (!active) return;
      active = false;
      var dy = curY - startY;
      if (dy >= THRESHOLD) {
        arrow.style.transition = 'transform .4s';
        arrow.style.transform = 'rotate(360deg)';
        ind.style.top = '16px';
        setTimeout(function () {
          location.reload();
        }, 400);
      } else {
        reset();
      }
    },
    { passive: true }
  );
}
