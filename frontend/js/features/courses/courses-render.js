import { panelShow, panelHide } from '../../core/panels.js';

export function renderCourses(state) {
  var cl = document.getElementById('courseList');
  if (!cl) return;
  cl.innerHTML = '';
  var sem = state.SEMS[state.activeSemId];
  if (!sem) return;
  sem.courses.forEach(function (c, i) {
    var col = state.COLORS[i % state.COLORS.length];
    var wrap = document.createElement('div');
    var row = document.createElement('div');
    row.className = 'course-row' + (state.activeCourseId === c.id ? ' active' : '');

    var bar = document.createElement('div');
    bar.className = 'cr-bar';
    bar.style.background = col;

    var info = document.createElement('div');
    info.className = 'cr-info';

    var name = document.createElement('div');
    name.className = 'cr-name';
    name.textContent = c.name;

    var meta = document.createElement('div');
    meta.className = 'cr-meta';
    meta.textContent = c.meta;

    info.append(name, meta);
    row.append(bar, info);

    row.addEventListener('click', function () {
      if (state.activeCourseId === c.id) {
        state.activeCourseId = null;
        panelHide(document.getElementById('courseOverview'));
        panelShow(document.getElementById('welcomeState'));
        var crumb = document.getElementById('breadcrumb');
        if (crumb) crumb.textContent = 'Courses';
        renderCourses(state);
      } else {
        state._cameFromStudip = false;
        if (typeof window.openCourse === 'function') window.openCourse(c);
      }
    });

    wrap.appendChild(row);
    cl.appendChild(wrap);
  });
}

export function sdRenderCourses(state) {
  var cl = document.getElementById('sdCourseList');
  if (!cl) return;
  cl.innerHTML = '';
  var sem = state.SEMS[state.sdActiveSemId];
  if (!sem) return;
  if (!sem.courses.length) {
    var empty = document.createElement('div');
    empty.style.cssText = 'padding:32px;text-align:center;opacity:.5;font-size:.9rem';
    empty.textContent = 'No subjects added yet. Use the search bar above to add your courses.';
    cl.appendChild(empty);
    return;
  }
  sem.courses.forEach(function (c, i) {
    var col = state.COLORS[i % state.COLORS.length];
    var card = document.createElement('div');
    card.className = 'sd-course-card';
    card.style.position = 'relative';

    var _folderCount = (c.userFolders || []).reduce(function (s, fd) {
      return s + (fd.files ? fd.files.length : 0);
    }, 0);
    var _liveCount = c.files.length + _folderCount;
    var _cachedCount = 0;
    if (!_liveCount) {
      try {
        var _ufc = JSON.parse(localStorage.getItem('ss_uf_cache_' + c.id) || 'null');
        if (_ufc) {
          _cachedCount =
            (_ufc.files || []).length +
            (_ufc.folders || []).reduce(function (s, fd) {
              return s + (fd.files ? fd.files.length : 0);
            }, 0);
        }
      } catch (e) {}
    }
    var count =
      _liveCount || _cachedCount || parseInt(localStorage.getItem('ss_fc_' + c.id) || '0');

    var colorBar = document.createElement('div');
    colorBar.className = 'sd-course-bar';
    colorBar.style.background = col;

    var courseName = document.createElement('div');
    courseName.className = 'sd-course-name';
    courseName.textContent = c.name;

    var courseMeta = document.createElement('div');
    courseMeta.className = 'sd-course-meta';
    courseMeta.textContent = c.meta;

    var badge = document.createElement('div');
    badge.className = 'sd-course-badge';
    badge.textContent = count + ' file' + (count !== 1 ? 's' : '');

    var delBtn = document.createElement('button');
    delBtn.className = 'sd-del-btn';
    delBtn.title = 'Remove';
    delBtn.textContent = '✕';
    delBtn.style.cssText =
      'position:absolute;top:8px;right:8px;background:rgba(255,100,100,.15);border:none;color:rgba(255,120,120,.8);border-radius:6px;padding:2px 7px;cursor:pointer;font-size:.8rem;line-height:1';

    delBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      state.SEMS[state.sdActiveSemId].courses.splice(i, 1);
      if (typeof window._saveUserCourses === 'function') window._saveUserCourses();
      sdRenderCourses(state);
    });

    card.append(colorBar, courseName, courseMeta, badge, delBtn);

    card.addEventListener('click', function () {
      if (typeof window.hideStudip === 'function') window.hideStudip();
      state._cameFromStudip = true;
      state.activeSemId = state.sdActiveSemId;
      renderCourses(state);
      if (typeof window.openCourse === 'function') window.openCourse(c);
    });

    cl.appendChild(card);
  });
}
