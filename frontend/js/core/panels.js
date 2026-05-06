export function panelShow(el, isFlexEl) {
  if (!el) return;
  el.style.display = isFlexEl ? 'flex' : 'block';
}

export function panelHide(el) {
  if (!el) return;
  el.style.display = 'none';
}

export function showFilesView(stRunning) {
  var portal = document.getElementById('portal');
  if (portal) {
    portal.classList.add('show');
    portal.style.display = 'block';
    portal.style.opacity = '1';
    portal.style.pointerEvents = 'auto';
  }
  var ms = document.querySelector('#portal .main-scroll');
  if (ms) ms.style.display = 'none';
  var app = document.getElementById('app');
  if (app) app.style.display = 'flex';
  var fab = document.getElementById('addWidgetFab');
  if (fab) fab.classList.remove('visible');
  var back = document.getElementById('goPortal');
  if (back) back.style.display = '';
  var title = document.getElementById('topTitle');
  if (title) title.style.display = 'none';
  var crumb = document.getElementById('breadcrumb');
  if (crumb) crumb.style.display = '';
  var stBtn = document.getElementById('studyTechBtn');
  if (stBtn) stBtn.style.display = 'flex';
  var stMini = document.getElementById('stMiniTimer');
  if (stMini) stMini.style.display = stRunning ? 'flex' : 'none';
}

export function hideFilesView() {
  var ms = document.querySelector('#portal .main-scroll');
  if (ms) ms.style.display = '';
  var app = document.getElementById('app');
  if (app) app.style.display = 'none';
  var back = document.getElementById('goPortal');
  if (back) back.style.display = 'none';
  var title = document.getElementById('topTitle');
  if (title) title.style.display = '';
  var crumb = document.getElementById('breadcrumb');
  if (crumb) crumb.style.display = 'none';
  var stBtn = document.getElementById('studyTechBtn');
  if (stBtn) stBtn.style.display = 'none';
  var stMini = document.getElementById('stMiniTimer');
  if (stMini) stMini.style.display = 'none';
}
