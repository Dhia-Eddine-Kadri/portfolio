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

// Try to re-open the file the user was viewing when they navigated to a
// portal section. Looks up the file in the user's course list by name and
// invokes window.openFile(file, course). Returns true if a restore was
// attempted, false otherwise.
function _tryResumeOpenFile() {
  try {
    var raw = sessionStorage.getItem('ss_resume_file');
    if (!raw) return false;
    var resume = JSON.parse(raw);
    sessionStorage.removeItem('ss_resume_file');
    if (!resume || !resume.courseId || !resume.fileName) return false;

    var sems = (window.SEMS || window._SEMS || {});
    var activeSemId = window.activeSemesterId || window._activeSemesterId;
    var course = null;
    if (activeSemId && sems[activeSemId]) {
      course = (sems[activeSemId].courses || []).find(function (c) {
        return c.id === resume.courseId;
      });
    }
    // Fall back to scanning every semester
    if (!course) {
      Object.keys(sems).some(function (sid) {
        var c = (sems[sid].courses || []).find(function (cc) { return cc.id === resume.courseId; });
        if (c) { course = c; return true; }
        return false;
      });
    }
    if (!course || !Array.isArray(course.files)) return false;

    var file = course.files.find(function (f) { return f.name === resume.fileName; });
    if (!file) {
      // Maybe nested in a user folder
      (course.userFolders || []).some(function (fd) {
        var hit = (fd.files || []).find(function (f) { return f.name === resume.fileName; });
        if (hit) { file = hit; return true; }
        return false;
      });
    }
    if (!file || typeof window.openFile !== 'function') return false;

    window.openFile(file, course);
    return true;
  } catch (e) {
    return false;
  }
}

export function showStudip() {
  // If the user navigated away from an open file and is now coming back via
  // the Courses nav button, jump straight back to that file instead of the
  // course list.
  if (_tryResumeOpenFile()) return;

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

  // Remember the open file so a later click on Courses (showStudip) can jump
  // straight back to it. Cleared after a successful restore, or naturally on
  // tab close. sessionStorage so it doesn't outlive the browser session.
  if (fromFiles && window.activeFileName && window.activeCourseId) {
    try {
      sessionStorage.setItem('ss_resume_file', JSON.stringify({
        courseId: window.activeCourseId,
        fileName: window.activeFileName
      }));
    } catch (e) {}
  }

  if (fromFiles || fromStudip) showPortal();
  setNavActive(navId);
  // Use window.showPortalSection so router wrapper runs (URL update + section save)
  if (typeof window.showPortalSection === 'function') window.showPortalSection(section);
  else showPortalSection(section);
}
