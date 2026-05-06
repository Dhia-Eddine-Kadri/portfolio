export function spawnConfetti() {
  var cols = ['#FFD93D', '#FF6B35', '#FF6FB7', '#9B5DE5', '#4CC9F0', '#06D6A0'];
  for (var i = 0; i < 16; i++) {
    (function () {
      var el = document.createElement('div');
      el.className = 'confetti-piece';
      el.style.cssText =
        'left:' +
        Math.random() * 100 +
        'vw;background:' +
        cols[Math.floor(Math.random() * cols.length)] +
        ';animation-delay:' +
        Math.random() * 0.5 +
        's;animation-duration:' +
        (1 + Math.random()) +
        's;';
      document.body.appendChild(el);
      setTimeout(function () {
        el.remove();
      }, 2200);
    })();
  }
}

export function initAiConfettiBridge() {
  window.spawnConfetti = spawnConfetti;
  return {
    spawnConfetti: spawnConfetti
  };
}
