export function initCourseSearch(context) {
  var inp = document.getElementById('courseSearchInput');
  var drop = document.getElementById('courseSearchDrop');
  var addBtn = document.getElementById('courseAddBtn');
  if (!inp || !drop || !addBtn) return;

  var _selectedSubject = null;

  function _getDropBg() {
    return document.body.classList.contains('night')
      ? 'rgba(13,20,40,.97)'
      : 'rgba(240,245,255,.98)';
  }

  function _showDrop(items) {
    if (!items.length) {
      drop.style.display = 'none';
      return;
    }
    drop.style.background = _getDropBg();
    drop.innerHTML = '';
    items.forEach(function (s) {
      var opt = document.createElement('div');
      opt.textContent = s.name;
      opt.style.cssText =
        'padding:9px 14px;cursor:pointer;font-size:.88rem;border-bottom:1px solid rgba(37,99,235,.1);color:inherit';
      opt.addEventListener('mouseenter', function () {
        opt.style.background = 'rgba(37,99,235,.12)';
      });
      opt.addEventListener('mouseleave', function () {
        opt.style.background = '';
      });
      opt.addEventListener('mousedown', function (e) {
        e.preventDefault();
        _selectedSubject = s;
        inp.value = s.name;
        drop.style.display = 'none';
      });
      drop.appendChild(opt);
    });
    drop.style.display = 'block';
  }

  inp.addEventListener('input', function () {
    _selectedSubject = null;
    var q = inp.value.trim().toLowerCase();
    if (!q) {
      drop.style.display = 'none';
      return;
    }
    var userMajor = context.getUserMajor();
    var userVertiefung = context.getUserVertiefung();
    var subjectList = context.getSubjectList();
    var isMB = !userMajor || userMajor === 'Maschinenbau';
    var isET = userMajor === 'Elektrotechnik und Informationstechnik';
    var matches;
    if (isMB) {
      matches = subjectList.filter(function (s) {
        var inCat = s.cat === 'grundlagen' || s.cat === userVertiefung;
        return inCat && s.name.toLowerCase().includes(q);
      });
    } else if (isET) {
      matches = subjectList.filter(function (s) {
        var inCat = s.cat === 'et-grundlagen' || s.cat === userVertiefung;
        return inCat && s.name.toLowerCase().includes(q);
      });
    } else {
      var primary = subjectList.filter(function (s) {
        return s.cat === userMajor && s.name.toLowerCase().includes(q);
      });
      var secondary = subjectList.filter(function (s) {
        return s.cat !== userMajor && s.name.toLowerCase().includes(q);
      });
      matches = primary.concat(secondary);
    }
    _showDrop(matches.slice(0, 10));
  });

  inp.addEventListener('blur', function () {
    setTimeout(function () {
      drop.style.display = 'none';
    }, 150);
  });

  function _addCourse() {
    var name = inp.value.trim();
    if (!name) return;
    var subject = _selectedSubject || { name: name, short: name.slice(0, 8) };
    var sems = context.getSems();
    var sem = sems[context.getActiveSemesterId()];
    if (!sem) return;
    if (
      sem.courses.find(function (c) {
        return c.name.toLowerCase() === subject.name.toLowerCase();
      })
    ) {
      inp.value = '';
      _selectedSubject = null;
      drop.style.display = 'none';
      return;
    }
    sem.courses.push({
      id: 'uc_' + Date.now(),
      name: subject.name,
      short: subject.short,
      meta: '',
      files: []
    });
    context.saveUserCourses();
    context.renderCourses();
    inp.value = '';
    _selectedSubject = null;
    drop.style.display = 'none';
  }

  addBtn.addEventListener('click', _addCourse);
  inp.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') _addCourse();
  });
}
