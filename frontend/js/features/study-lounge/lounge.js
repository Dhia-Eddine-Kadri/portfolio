export function initStudyLounge() {
  var STATS_KEY = 'ss_stats';
  var studyTimer = null;

  function loadStats() {
    try {
      return JSON.parse(localStorage.getItem(STATS_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function saveStats(stats) {
    try {
      localStorage.setItem(STATS_KEY, JSON.stringify(stats));
    } catch (e) {}
  }

  function getStats() {
    var defaults = {
      studyMinutes: 0,
      filesOpened: [],
      coursesStudied: [],
      aiMessages: 0,
      gamesPlayed: 0,
      streak: 0,
      lastDate: '',
      recentFiles: []
    };
    var stats = loadStats();
    Object.keys(defaults).forEach(function (key) {
      if (stats[key] === undefined) stats[key] = defaults[key];
    });
    return stats;
  }

  function touchStreak() {
    var stats = getStats();
    var today = new Date().toISOString().slice(0, 10);
    if (stats.lastDate === today) return;
    var yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    stats.streak = stats.lastDate === yesterday ? (stats.streak || 0) + 1 : 1;
    stats.lastDate = today;
    saveStats(stats);
  }

  function timeAgo(ts) {
    if (!ts) return '';
    var diff = Date.now() - ts;
    var minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return minutes + 'm ago';
    var hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + 'h ago';
    var days = Math.floor(hours / 24);
    return days + 'd ago';
  }

  function renderCourseChips(stats) {
    var chips = document.getElementById('loungeCourseChips');
    if (!chips) return;
    chips.replaceChildren();
    if (!stats.coursesStudied || !stats.coursesStudied.length) {
      var empty = document.createElement('div');
      empty.className = 'lounge-empty-msg';
      empty.textContent = 'No courses yet - open a subject to get started';
      chips.appendChild(empty);
      return;
    }
    stats.coursesStudied.forEach(function (courseName) {
      var chip = document.createElement('div');
      chip.className = 'lounge-course-chip';
      chip.textContent = courseName;
      chips.appendChild(chip);
    });
  }

  function renderRecentFiles(stats) {
    var list = document.getElementById('loungeRecentList');
    if (!list) return;
    list.replaceChildren();
    if (!stats.recentFiles || !stats.recentFiles.length) {
      var empty = document.createElement('div');
      empty.className = 'lounge-empty-msg';
      empty.textContent = 'No files opened yet';
      list.appendChild(empty);
      return;
    }
    stats.recentFiles.forEach(function (recent) {
      var item = document.createElement('div');
      item.className = 'lounge-recent-item';

      var icon = document.createElement('div');
      icon.className = 'lounge-recent-item-icon';
      icon.textContent = 'PDF';

      var name = document.createElement('div');
      name.className = 'lounge-recent-item-name';
      name.textContent = recent.name || '';

      var meta = document.createElement('div');
      meta.className = 'lounge-recent-item-course';
      var ago = timeAgo(recent.ts);
      meta.textContent = recent.course ? recent.course + (ago ? ' · ' + ago : '') : ago;

      item.appendChild(icon);
      item.appendChild(name);
      item.appendChild(meta);
      list.appendChild(item);
    });
  }

  function loungeRender() {
    var stats = getStats();
    var hours = Math.floor((stats.studyMinutes || 0) / 60);
    var minutes = (stats.studyMinutes || 0) % 60;
    var hoursStr = hours > 0 ? hours + 'h ' + minutes + 'm' : minutes + 'm';

    var el = document.getElementById('lsHours');
    if (el) el.textContent = hoursStr;
    var el2 = document.getElementById('lsHoursSub');
    if (el2) {
      el2.textContent =
        hours > 0
          ? hours +
            ' hour' +
            (hours !== 1 ? 's' : '') +
            (minutes ? ' ' + minutes + 'm' : '') +
            ' total'
          : minutes + ' min total';
    }

    var filesCount = (stats.filesOpened || []).length;
    var filesEl = document.getElementById('lsFiles');
    if (filesEl) filesEl.textContent = filesCount;
    var filesSub = document.getElementById('lsFilesSub');
    if (filesSub) filesSub.textContent = filesCount + ' unique PDF' + (filesCount !== 1 ? 's' : '');

    var coursesCount = (stats.coursesStudied || []).length;
    var coursesEl = document.getElementById('lsCourses');
    if (coursesEl) coursesEl.textContent = coursesCount;
    var coursesSub = document.getElementById('lsCoursesSub');
    if (coursesSub)
      coursesSub.textContent = coursesCount + ' subject' + (coursesCount !== 1 ? 's' : '');

    var aiEl = document.getElementById('lsAI');
    if (aiEl) aiEl.textContent = stats.aiMessages || 0;

    var noteCards = document.querySelectorAll('#lnContent .ln-card');
    var notesEl = document.getElementById('lsNotes');
    if (notesEl) notesEl.textContent = noteCards.length;

    var gamesEl = document.getElementById('lsGames');
    if (gamesEl) gamesEl.textContent = stats.gamesPlayed || 0;

    var streakEl = document.getElementById('loungeStreakVal');
    if (streakEl) streakEl.textContent = stats.streak || 0;
    var streakMsg = document.getElementById('loungeStreakMsg');
    if (streakMsg) {
      var streak = stats.streak || 0;
      streakMsg.textContent =
        streak === 0
          ? 'Start studying today to begin your streak!'
          : streak === 1
            ? 'Great start - come back tomorrow!'
            : streak < 7
              ? 'Keep it up, ' + streak + ' days strong!'
              : 'Amazing! ' + streak + ' day streak';
    }

    renderCourseChips(stats);
    renderRecentFiles(stats);

    var resetBtn = document.getElementById('loungeResetBtn');
    if (resetBtn && !resetBtn._wired) {
      resetBtn._wired = true;
      resetBtn.addEventListener('click', function () {
        if (confirm('Reset all study stats? This cannot be undone.')) {
          localStorage.removeItem(STATS_KEY);
          loungeRender();
        }
      });
    }
  }

  window._statsTrackFile = function (fileName, courseName) {
    var stats = getStats();
    touchStreak();
    if (fileName && stats.filesOpened.indexOf(fileName) < 0) stats.filesOpened.push(fileName);
    if (courseName && stats.coursesStudied.indexOf(courseName) < 0) {
      stats.coursesStudied.push(courseName);
    }
    stats.recentFiles = stats.recentFiles || [];
    stats.recentFiles = stats.recentFiles.filter(function (recent) {
      return recent.name !== fileName;
    });
    stats.recentFiles.unshift({ name: fileName, course: courseName || '', ts: Date.now() });
    if (stats.recentFiles.length > 10) stats.recentFiles = stats.recentFiles.slice(0, 10);
    saveStats(stats);
    if (studyTimer) clearInterval(studyTimer);
    studyTimer = setInterval(function () {
      var nextStats = getStats();
      nextStats.studyMinutes = (nextStats.studyMinutes || 0) + 1;
      saveStats(nextStats);
    }, 60000);
  };

  window._statsStopFile = function () {
    if (studyTimer) {
      clearInterval(studyTimer);
      studyTimer = null;
    }
  };

  window._statsTrackAI = function () {
    var stats = getStats();
    stats.aiMessages = (stats.aiMessages || 0) + 1;
    saveStats(stats);
    touchStreak();
  };

  window._statsTrackGame = function () {
    var stats = getStats();
    stats.gamesPlayed = (stats.gamesPlayed || 0) + 1;
    saveStats(stats);
  };

  window._loungeRender = loungeRender;
}
