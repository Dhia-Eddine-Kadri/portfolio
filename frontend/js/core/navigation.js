import { hideFilesView, showFilesView } from './panels.js';

var _activePortalSection = null;

export function setNavActive(id) {
  document.querySelectorAll('.psb').forEach(function (el) {
    el.classList.remove('on');
  });
  var el = document.getElementById(id);
  if (el) el.classList.add('on');
}

export function showPortalSection(sec) {
  var g = document.getElementById('psbGames');
  if (sec === 'games' && g && g.classList.contains('st-locked')) return;
  var _titles = {
    dashboard: 'Dashboard',
    notes: 'Lecture Notes',
    editor: 'Editor',
    profile: 'Profile',
    settings: 'Settings',
    subscription: 'Subscription',
    studip: 'Courses',
    chat: 'Chat',
    notifications: 'Notifications',
    games: 'Games',
    lounge: 'Study Lounge',
    aipage: 'Chatbot',
    german: 'Practice'
  };
  var ms = document.querySelector('#portal .main .main-scroll');
  var target = document.getElementById('psec-' + sec);
  var _fab = document.getElementById('addWidgetFab');
  var tt = document.getElementById('topTitle');

  function _revealTarget() {
    document.querySelectorAll('.portal-section').forEach(function (el) {
      el.style.display = 'none';
      el.classList.remove('psec-entering', 'psec-leaving');
    });
    if (!target) return;
    target.style.display =
      target.classList.contains('editor-portal-section') || sec === 'chat' ? 'flex' : 'block';
    target.classList.remove('psec-entering');
    void target.offsetWidth;
    target.classList.add('psec-entering');
    if (ms) ms.classList.toggle('editor-active', sec === 'editor' || sec === 'chat');
    if (tt) tt.textContent = _titles[sec] || sec;
    if (_fab) _fab.classList.toggle('visible', sec === 'dashboard');
    _activePortalSection = target;

    // The AI panel and the floating AI bubble are for chatting about an open
    // course file — they have no purpose on Settings, Dashboard, Profile,
    // etc. Hide both (and force-close the panel) whenever we navigate to any
    // non-courses section; restore them when returning to Courses.
    var aiPanel  = document.getElementById('aiPanel');
    var aiTab    = document.getElementById('aiTab');
    var aiBubble = document.getElementById('aiBubble');
    if (sec !== 'studip') {
      if (typeof window.forceCloseAI === 'function') window.forceCloseAI();
      else if (aiPanel) aiPanel.classList.remove('visible');
      if (aiTab)    aiTab.style.display = 'none';
      if (aiBubble) aiBubble.style.display = 'none';
      if (typeof window._aiBubbleClose === 'function') window._aiBubbleClose();
    } else {
      if (aiTab)    aiTab.style.display = '';
      if (aiBubble) aiBubble.style.display = '';
    }
  }

  var leaving = _activePortalSection;
  if (leaving && leaving !== target && leaving.style.display !== 'none') {
    leaving.classList.add('psec-leaving');
    setTimeout(_revealTarget, 170);
  } else {
    _revealTarget();
  }
}

export function showPortal() {
  if (typeof window._statsStopFile === 'function') window._statsStopFile();
  var portal = document.getElementById('portal');
  var alreadyVisible =
    portal.classList.contains('show') &&
    portal.style.display !== 'none' &&
    document.getElementById('app') &&
    document.getElementById('app').style.display === 'none';
  var studipVisible =
    document.getElementById('studipDash') &&
    document.getElementById('studipDash').style.display !== 'none';
  if (!alreadyVisible || studipVisible) {
    hideFilesView();
    portal.style.transition = 'none';
    portal.style.opacity = '0';
    portal.style.transform = 'scale(0.97)';
    portal.style.pointerEvents = 'none';
    portal.style.zIndex = '220';
    portal.classList.add('show');
    void portal.offsetWidth;
    portal.style.transition =
      'opacity 380ms cubic-bezier(0.22,1,0.36,1),transform 380ms cubic-bezier(0.22,1,0.36,1)';
    portal.style.opacity = '1';
    portal.style.transform = 'scale(1)';
    portal.style.pointerEvents = 'auto';
    setTimeout(function () {
      portal.style.zIndex = '';
      portal.style.opacity = '';
      portal.style.transition = '';
      portal.style.transform = '';
      portal.style.display = 'block';
    }, 400);
  } else {
    hideFilesView();
    portal.classList.add('show');
    portal.style.display = 'block';
  }
  try {
    var st = JSON.parse(localStorage.getItem('ss_state') || '{}');
    st.inApp = false;
    st.view = '';
    localStorage.setItem('ss_state', JSON.stringify(st));
  } catch (e) {}
}

// ─── Resume-to-file helpers ─────────────────────────────────────────────────
// The user wants the Courses sidebar button to jump straight back to the PDF
// they were viewing before they hopped over to Chat / Settings / Editor etc.
//
// Previous attempt put the restore logic inside showStudip, which broke things
// because showStudip is called from many side-effect paths (URL routing on
// reload, history.back, internal redirects). Those calls would silently eat
// the stash and leave nav / URL / content out of sync.
//
// New design:
//   - stashResumeFile() : explicitly called from navTo when we leave a file
//     view by clicking a sidebar item. Only stashes if not already stashed,
//     so PDF → Editor → Settings still resumes the PDF (not the Editor).
//   - clearResumeFile() : called when the user opens any file directly
//     (window.openFile wrapper in app.js) so a fresh open invalidates the
//     pending resume.
//   - showStudipResume() : called ONLY from the Courses sidebar click. Tries
//     to re-open the stashed file, falls back to showStudip() if anything's
//     missing. Side-effect calls to showStudip do not run the resume.
function _findCourseFile(resume) {
  var sems = (window.SEMS || window._SEMS || {});
  var activeSemId = window.activeSemesterId || window._activeSemesterId;
  var course = null;
  if (activeSemId && sems[activeSemId]) {
    course = (sems[activeSemId].courses || []).find(function (c) {
      return c.id === resume.courseId;
    });
  }
  if (!course) {
    Object.keys(sems).some(function (sid) {
      var c = (sems[sid].courses || []).find(function (cc) { return cc.id === resume.courseId; });
      if (c) { course = c; return true; }
      return false;
    });
  }
  if (!course) return null;

  var files = Array.isArray(course.files) ? course.files : [];
  var file = files.find(function (f) { return f.name === resume.fileName; });
  if (!file) {
    (course.userFolders || []).some(function (fd) {
      var hit = (fd.files || []).find(function (f) { return f.name === resume.fileName; });
      if (hit) { file = hit; return true; }
      return false;
    });
  }
  return file ? { file: file, course: course } : null;
}

export function stashResumeFile() {
  if (!window.activeFileName || !window.activeCourseId) return;
  try {
    if (sessionStorage.getItem('ss_resume_file')) return; // don't overwrite
    sessionStorage.setItem('ss_resume_file', JSON.stringify({
      courseId: window.activeCourseId,
      fileName: window.activeFileName
    }));
  } catch (e) {}
}

export function clearResumeFile() {
  try { sessionStorage.removeItem('ss_resume_file'); } catch (e) {}
}

// Called from the Courses sidebar click handler. Returns true if we resumed
// a file; false if the caller should fall through to the normal Courses view.
export function showStudipResume() {
  var raw = null;
  try { raw = sessionStorage.getItem('ss_resume_file'); } catch (e) {}
  if (!raw) { showStudip(); return false; }

  var resume;
  try { resume = JSON.parse(raw); } catch (e) { resume = null; }
  if (!resume || !resume.courseId || !resume.fileName) {
    clearResumeFile();
    showStudip();
    return false;
  }

  var hit = _findCourseFile(resume);
  if (!hit || typeof window.openFile !== 'function') {
    // Course data might not be loaded yet. Don't consume the stash — fall
    // back to the courses list so the user is never left on a broken page,
    // and they can click in manually.
    showStudip();
    return false;
  }

  clearResumeFile();

  // CRITICAL: the underlying openFile assumes the file view (#app) is
  // already visible — it only toggles #pdfView. We're currently inside a
  // portal section (Editor/Settings/etc.) where #app is hidden, so call
  // showFilesView first or the URL updates but the view stays in the
  // portal section.
  showFilesView(typeof window._stRunning !== 'undefined' ? window._stRunning : false);

  // showPortalSection hides the AI panel/tab/bubble when we navigate to
  // any non-studip section. Bring them back now that we're back on a file.
  var aiTab    = document.getElementById('aiTab');
  var aiBubble = document.getElementById('aiBubble');
  if (aiTab)    aiTab.style.display = '';
  if (aiBubble) aiBubble.style.display = '';

  window.openFile(hit.file, hit.course);
  return true;
}

export function showStudip() {
  hideFilesView();
  var portal = document.getElementById('portal');
  if (portal) {
    portal.classList.add('show');
    portal.style.display = 'block';
  }
  setNavActive('pcStudip');
  if (typeof window.showPortalSection === 'function') window.showPortalSection('studip');
  else showPortalSection('studip');
  if (typeof window.sdRenderCourses === 'function') window.sdRenderCourses();
  try {
    var st = JSON.parse(localStorage.getItem('ss_state') || '{}');
    st.view = 'studip';
    st.inApp = false;
    localStorage.setItem('ss_state', JSON.stringify(st));
  } catch (e) {}
}

export function hideStudip(stRunning) {
  showFilesView(stRunning);
}

export function navTo(navId, section) {
  var appEl = document.getElementById('app');
  var fromFiles = appEl && appEl.style.display !== 'none';
  var studipEl = document.getElementById('studipDash');
  var fromStudip = studipEl && studipEl.style.display !== 'none';

  // Capture the open file the FIRST time we leave the file view by clicking
  // a sidebar item, so a later Courses click can jump back. Subsequent hops
  // (Editor → Settings → Chat) keep pointing at the original PDF.
  if (fromFiles) stashResumeFile();

  if (fromFiles || fromStudip) showPortal();
  setNavActive(navId);
  // Use window.showPortalSection so router wrapper runs (URL update + section save)
  if (typeof window.showPortalSection === 'function') window.showPortalSection(section);
  else showPortalSection(section);
}
