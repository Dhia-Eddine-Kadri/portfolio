export function panelShow(el, isFlexEl) {
    if (!el)
        return;
    el.style.display = isFlexEl ? 'flex' : 'block';
}
export function panelHide(el) {
    if (!el)
        return;
    el.style.display = 'none';
}
export function showFilesView(stRunning) {
    const portal = document.getElementById('portal');
    if (portal) {
        portal.classList.add('show');
        portal.style.display = 'block';
        portal.style.opacity = '1';
        portal.style.pointerEvents = 'auto';
    }
    const ms = document.querySelector('#portal .main-scroll');
    if (ms)
        ms.style.display = 'none';
    const app = document.getElementById('app');
    if (app)
        app.style.display = 'flex';
    const fab = document.getElementById('addWidgetFab');
    if (fab)
        fab.classList.remove('visible');
    const back = document.getElementById('goPortal');
    if (back)
        back.style.display = '';
    const title = document.getElementById('topTitle');
    if (title)
        title.style.display = 'none';
    const crumb = document.getElementById('breadcrumb');
    if (crumb)
        crumb.style.display = '';
    const stBtn = document.getElementById('studyTechBtn');
    if (stBtn)
        stBtn.style.display = 'flex';
    const stMini = document.getElementById('stMiniTimer');
    if (stMini)
        stMini.style.display = stRunning ? 'flex' : 'none';
}
// Single source of truth for which of the two top-level containers is shown.
// See panels.ts for the contract.
export function selectTopLevelView(which, opts) {
    const portal = document.getElementById('portal');
    const app = document.getElementById('app');
    const mainScroll = document.querySelector('#portal .main-scroll');
    if (portal) {
        portal.classList.add('show');
        portal.style.display = 'block';
        portal.dataset.activeView = which;
    }
    if (which === 'file') {
        if (mainScroll) mainScroll.style.display = 'none';
        if (app) app.style.display = 'flex';
        _applyFileChrome((opts && opts.stRunning) || false);
    }
    else {
        if (mainScroll) mainScroll.style.display = '';
        if (app) app.style.display = 'none';
        _applyPortalChrome();
    }
}
function _applyFileChrome(stRunning) {
    const fab = document.getElementById('addWidgetFab');
    if (fab) fab.classList.remove('visible');
    const back = document.getElementById('goPortal');
    if (back) back.style.display = '';
    const title = document.getElementById('topTitle');
    if (title) title.style.display = 'none';
    const crumb = document.getElementById('breadcrumb');
    if (crumb) crumb.style.display = '';
    const stBtn = document.getElementById('studyTechBtn');
    if (stBtn) stBtn.style.display = 'flex';
    const stMini = document.getElementById('stMiniTimer');
    if (stMini) stMini.style.display = stRunning ? 'flex' : 'none';
}
function _applyPortalChrome() {
    const back = document.getElementById('goPortal');
    if (back) back.style.display = 'none';
    const title = document.getElementById('topTitle');
    if (title) title.style.display = '';
    const crumb = document.getElementById('breadcrumb');
    if (crumb) crumb.style.display = 'none';
    const stBtn = document.getElementById('studyTechBtn');
    if (stBtn) stBtn.style.display = 'none';
    const stMini = document.getElementById('stMiniTimer');
    if (stMini) stMini.style.display = 'none';
}
export function hideFilesView() {
    const ms = document.querySelector('#portal .main-scroll');
    if (ms)
        ms.style.display = '';
    const app = document.getElementById('app');
    if (app)
        app.style.display = 'none';
    const back = document.getElementById('goPortal');
    if (back)
        back.style.display = 'none';
    const title = document.getElementById('topTitle');
    if (title)
        title.style.display = '';
    const crumb = document.getElementById('breadcrumb');
    if (crumb)
        crumb.style.display = 'none';
    const stBtn = document.getElementById('studyTechBtn');
    if (stBtn)
        stBtn.style.display = 'none';
    const stMini = document.getElementById('stMiniTimer');
    if (stMini)
        stMini.style.display = 'none';
}
//# sourceMappingURL=panels.js.map