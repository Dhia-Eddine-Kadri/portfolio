export function initStatePersistence(options) {
  options = options || {};

  var _stateRestored = false;

  function saveState() {
    try {
      // If user is currently on a portal-only section, clear any stale course
      // state so a refresh on that section does not trigger a course restore.
      var _curTab = null;
      try { _curTab = sessionStorage.getItem('ss_portal_tab'); } catch (e) {}
      if (_curTab && _PORTAL_ONLY_SECTIONS.indexOf(_curTab) !== -1) {
        localStorage.removeItem('ss_state');
        return;
      }
      var appEl = document.getElementById('app');
      var pdfEl = document.getElementById('pdfView');
      var appVisible = appEl && appEl.style.display === 'flex';
      var pdfVisible = pdfEl && (pdfEl.style.display === 'flex' || pdfEl.style.display === 'block');
      if (!appVisible && !pdfVisible) return;
      var st = {
        semId: options.getActiveSemId(),
        courseId: options.getActiveCourseId(),
        fileName: options.getActiveFileName(),
        section: options.getActiveCourseSection(),
        inApp: true
      };
      localStorage.setItem('ss_state', JSON.stringify(st));
    } catch (e) {}
  }

  // Portal sections that own the full page — refreshing on these must NOT
  // trigger a course/file restore even when ss_state still has old course data.
  var _PORTAL_ONLY_SECTIONS = [
    'aipage', 'notes', 'chat', 'games', 'lounge', 'editor',
    'notifications', 'profile', 'settings', 'subscription',
    'german', 'admin', 'dashboard'
  ];

  function restoreState() {
    if (_stateRestored) return;
    _stateRestored = true;
    options.setSsRestoring(true);
    try {
      var raw = localStorage.getItem('ss_state');
      if (!raw) return;
      var st = JSON.parse(raw);
      if (!st.inApp) return;

      // If the user's last known tab was a self-contained portal section,
      // honour that navigation and skip course/file restoration.
      var _lastTab = null;
      try { _lastTab = sessionStorage.getItem('ss_portal_tab') || localStorage.getItem('ss_last_section'); } catch (e) {}
      if (_lastTab && _PORTAL_ONLY_SECTIONS.indexOf(_lastTab) !== -1) return;

      if (st.view === 'studip') {
        options.showStudip();
        return;
      }

      options.setPendingPortalRestore(null);
      options.showFilesView();
      options.setNavActive('pcStudip');

      var sems = options.getSems();
      if (st.semId && sems[st.semId]) {
        options.setActiveSemId(st.semId);
        options.renderCourses();
      }

      if (st.courseId && st.courseId.indexOf('german-') === 0) {
        var skill = st.courseId.replace('german-', '');
        options.showPortal();
        options.setNavActive('psbGerman');
        options.showPortalSection('german');
        if (typeof window._glOpenSkill === 'function') {
          window._glOpenSkill(skill);
          if (st.fileName && window._uid) {
            setTimeout(function () {
              window._glOpenFile(window._uid, st.fileName);
            }, 500);
          }
        }
        return;
      }

      if (st.courseId) {
        var sem = sems[options.getActiveSemId()];
        if (sem) {
          var course = sem.courses.find(function (c) {
            return c.id === st.courseId;
          });
          if (course) {
            options.setActiveCourseId(st.courseId);
            if (!course.files) course.files = [];
            options.panelHide(document.getElementById('welcomeState'));
            options.panelShow(document.getElementById('courseOverview'));
            var crumb = document.getElementById('breadcrumb');
            crumb.textContent = '';
            var crumbB = document.createElement('b');
            crumbB.textContent = course.name;
            crumb.appendChild(crumbB);
            options.renderCourses();
            var restSec = st.section || 'files';
            var restFile = st.fileName;

            try {
              var rstCached = JSON.parse(
                localStorage.getItem('ss_uf_cache_' + course.id) || 'null'
              );
              if (rstCached && Array.isArray(rstCached.files)) {
                var rstUid =
                  (options.getCurrentUser() &&
                    (options.getCurrentUser().id || options.getCurrentUser().sub)) ||
                  localStorage.getItem('ss_last_uid');
                course.files = rstCached.files.map(function (f) {
                  return {
                    name: f.name,
                    _storageName: f.storageName,
                    size: f.size || 0,
                    date: f.date,
                    _uploaded: true,
                    _uid: rstUid,
                    _course: course
                  };
                });
                course.userFolders = (rstCached.folders || []).map(function (fd) {
                  return {
                    name: fd.name,
                    files: (fd.files || []).map(function (f) {
                      return {
                        name: f.name,
                        _storageName: f.storageName,
                        size: f.size || 0,
                        date: f.date,
                        _uploaded: true,
                        _uid: rstUid,
                        _course: course,
                        _folder: fd.name
                      };
                    })
                  };
                });
              }
            } catch (e) {}

            function doRestoreRender() {
              options.showCourseSection(course, restSec);
            }
            doRestoreRender();

            options.setPendingRestoreCourse({
              course: course,
              sec: restSec,
              file: restFile
            });
            return;
          }
        }
      }
    } catch (e) {
      console.warn('State restore failed:', e);
    } finally {
      options.setSsRestoring(false);
    }
  }

  return {
    saveState: saveState,
    restoreState: restoreState
  };
}
