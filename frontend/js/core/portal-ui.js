export function bindIf(id, ev, fn) {
  var el = document.getElementById(id);
  if (el) el.addEventListener(ev, fn);
}

export function initPortalUi(options) {
  options = options || {};

  function applyTheme(toNight, originEl) {
    var rect = originEl
      ? originEl.getBoundingClientRect()
      : { left: window.innerWidth / 2, top: window.innerHeight / 2, width: 0, height: 0 };
    var x = Math.round(rect.left + rect.width / 2);
    var y = Math.round(rect.top + rect.height / 2);

    function commitTheme() {
      options.setNightOn(toNight);
      document.body.classList.toggle('night', toNight);
      var nbIcon = document.getElementById('nightIcon');
      if (nbIcon) {
        nbIcon.textContent = toNight ? '🌙' : '☀️';
        var nbLbl = document.getElementById('nightLabel');
        if (nbLbl) nbLbl.textContent = toNight ? 'Night' : 'Day';
      }
      var dm = document.getElementById('settingsDarkMode');
      if (dm) dm.checked = toNight;
      localStorage.setItem('ss_dark', toNight ? '1' : '0');
      if (typeof options.saveState === 'function') options.saveState();
    }

    if (!document.startViewTransition) {
      commitTheme();
      return;
    }

    var transition = document.startViewTransition(commitTheme);
    transition.ready.then(function () {
      var endRadius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y)
      );
      document.documentElement.animate(
        {
          clipPath: [
            'circle(0px at ' + x + 'px ' + y + 'px)',
            'circle(' + endRadius + 'px at ' + x + 'px ' + y + 'px)'
          ]
        },
        {
          duration: 500,
          easing: 'ease-in-out',
          pseudoElement: '::view-transition-new(root)'
        }
      );
    });
  }

  (function syncNightButton() {
    var isNight = !!options.getNightOn();
    var bIcon = document.getElementById('nightIcon');
    if (bIcon) bIcon.textContent = isNight ? '🌙' : '☀️';
    var bLbl = document.getElementById('nightLabel');
    if (bLbl) bLbl.textContent = isNight ? 'Night' : 'Day';
  })();

  bindIf('nightBtn', 'click', function () {
    applyTheme(!options.getNightOn(), this);
  });

  (function initMobileSidebar() {
    var ham = document.getElementById('portalHamburger');
    var scrim = document.getElementById('mobScrim');
    var sb = document.querySelector('#portal .sidebar');
    if (!ham || !scrim || !sb) return;
    function openMobSb() {
      sb.classList.add('mob-open');
      scrim.classList.add('show');
    }
    function closeMobSb() {
      sb.classList.remove('mob-open');
      scrim.classList.remove('show');
    }
    ham.addEventListener('click', openMobSb);
    scrim.addEventListener('click', closeMobSb);
    sb.addEventListener('click', function (e) {
      if (window.innerWidth <= 768 && e.target.closest('.sb-item')) closeMobSb();
    });
  })();

  bindIf('pcStudip', 'click', function () {
    options.showStudip();
    options.pushHistory({ view: 'studip' }, '#studip');
  });
  bindIf('pcMail', 'click', function () {
    window.open('https://mail.tu-braunschweig.de', '_blank');
  });
  bindIf('pcConnect', 'click', function () {
    window.open('https://connect.tu-braunschweig.de', '_blank');
  });
  bindIf('pcTT', 'click', function () {
    window.open('https://connect.tu-braunschweig.de', '_blank');
  });
  bindIf('pcCert', 'click', function () {
    window.open('https://connect.tu-braunschweig.de', '_blank');
  });
  bindIf('pcWeb', 'click', function () {
    window.open('https://www.tu-braunschweig.de', '_blank');
  });

  return {
    applyTheme: applyTheme
  };
}
