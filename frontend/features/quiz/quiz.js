// Quiz feature — mirrors flashcards UI with AI generation.

(function () {
  var TEMPLATE_URL = 'features/quiz/quiz.html';
  var _templatePromise = null;

  // courseId -> { quizzes: [{id,name,items,answers,submitted,createdAt,lastTaken,progress,bestScore}], activeId }
  var _state = {};

  function _loadTemplate() {
    if (_templatePromise) return _templatePromise;
    _templatePromise = fetch(TEMPLATE_URL)
      .then(function (r) { return r.text(); })
      .then(function (html) {
        var tmp = document.createElement('div');
        tmp.innerHTML = html;
        var root = tmp.querySelector('[data-quiz-root]');
        return root ? root.outerHTML : html;
      })
      .catch(function () { return '<div class="qz-empty">Failed to load quiz UI.</div>'; });
    return _templatePromise;
  }

  window.mountQuiz = function (target, course, options) {
    if (!target) return Promise.resolve();
    options = options || {};
    return _loadTemplate().then(function (html) {
      target.innerHTML = html;
      var root = target.querySelector('[data-quiz-root]');
      if (!root) return;
      _initShell(root, course, options);
    });
  };

  function _getStateFor(courseId) {
    if (!_state[courseId]) _state[courseId] = { quizzes: [], activeId: null };
    return _state[courseId];
  }

  function _toast(title, body) {
    if (typeof window.showToast === 'function') window.showToast(title, body);
  }

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function _statusLabel(quiz) {
    if (!quiz.lastTaken) return { cls: 'never', text: 'Not started' };
    var diff = Date.now() - new Date(quiz.lastTaken).getTime();
    if (diff < 86400000) return { cls: 'recent', text: 'Last taken today' };
    if (diff < 172800000) return { cls: 'stale', text: 'Last taken yesterday' };
    var days = Math.floor(diff / 86400000);
    return { cls: 'stale', text: 'Last taken ' + days + ' days ago' };
  }

  function _initShell(root, course, options) {
    var courseId = (course && course.id) || 'unknown';
    if (course && course.id) root.dataset.courseId = course.id;
    var state = _getStateFor(courseId);
    var _viewMode = 'grid'; // 'grid' | 'list'

    var els = {
      grid:         root.querySelector('#qzDeckGrid'),
      viewAll:      root.querySelector('#qzViewAllRow'),
      generate:     root.querySelector('#qzGenerateBtn'),
      newQuiz:      root.querySelector('#qzNewQuizBtn'),
      search:       root.querySelector('#qzSearchInput'),
      sort:         root.querySelector('#qzSortSelect'),
      studyName:    root.querySelector('#qzStudyName'),
      studyCount:   root.querySelector('#qzStudyCount'),
      settingsBtn:  root.querySelector('#qzStudySettingsBtn'),
      cardStage:    root.querySelector('#qzCardStage'),
      options:      root.querySelector('#qzOptions'),
      progressBar:  root.querySelector('#qzProgressBar'),
      progressLabel:root.querySelector('#qzProgressLabel'),
      prev:         root.querySelector('#qzPrevBtn'),
      submit:       root.querySelector('#qzSubmitBtn'),
      next:         root.querySelector('#qzNextBtn')
    };

    // ── View toggle ──
    root.querySelectorAll('.qz-view-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        _viewMode = btn.getAttribute('data-view');
        root.querySelectorAll('.qz-view-btn').forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-view') === _viewMode);
        });
        if (els.grid) els.grid.classList.toggle('list-view', _viewMode === 'list');
        renderGrid();
      });
    });

    // ── Grid pane ──
    function renderGrid() {
      if (!els.grid) return;
      var query = (els.search && els.search.value || '').trim().toLowerCase();
      var sortBy = (els.sort && els.sort.value) || 'recent';
      var quizzes = state.quizzes.slice();

      if (query) quizzes = quizzes.filter(function (q) {
        return (q.name || '').toLowerCase().indexOf(query) !== -1;
      });

      quizzes.sort(function (a, b) {
        if (sortBy === 'name') return (a.name || '').localeCompare(b.name || '');
        if (sortBy === 'score') {
          var aS = a.bestScore != null ? a.bestScore / (a.items.length || 1) : -1;
          var bS = b.bestScore != null ? b.bestScore / (b.items.length || 1) : -1;
          return bS - aS;
        }
        if (sortBy === 'created') return (b.createdAt || 0) - (a.createdAt || 0);
        var aT = a.lastTaken ? new Date(a.lastTaken).getTime() : 0;
        var bT = b.lastTaken ? new Date(b.lastTaken).getTime() : 0;
        return bT - aT;
      });

      if (!quizzes.length) {
        els.grid.innerHTML =
          '<div class="qz-empty">' +
          (state.quizzes.length
            ? 'No quizzes match your search.'
            : 'No quizzes yet. Click <strong>Generate quiz</strong> to make one from this course\'s material.') +
          '</div>';
        return;
      }

      els.grid.innerHTML = quizzes.map(function (q) {
        var isActive = q.id === state.activeId;
        var st = _statusLabel(q);
        var scoreHtml = q.bestScore != null
          ? '<div class="qz-deck-score' + ((q.bestScore / (q.items.length || 1)) < 0.5 ? ' low' : '') + '">' +
              'Best: ' + q.bestScore + ' / ' + q.items.length +
            '</div>'
          : '';
        return (
          '<div class="qz-deck-card' + (isActive ? ' active' : '') + '" data-quiz-id="' + _esc(q.id) + '">' +
            '<button class="qz-deck-menu-btn" data-quiz-delete="' + _esc(q.id) + '" title="Delete quiz">&#x22EE;</button>' +
            '<span class="qz-deck-icon">&#x1F4CB;</span>' +
            '<div class="qz-deck-name">' + _esc(q.name) + '</div>' +
            '<div class="qz-deck-count">' + q.items.length + ' questions</div>' +
            '<div class="qz-deck-status">' +
              '<span class="qz-deck-status-dot ' + st.cls + '"></span>' + _esc(st.text) +
            '</div>' +
            scoreHtml +
            '<div class="qz-deck-actions">' +
              '<button class="qz-deck-btn primary" data-quiz-open="' + _esc(q.id) + '">&#x1F4D6; Open</button>' +
              '<button class="qz-deck-btn" data-quiz-rename="' + _esc(q.id) + '">&#x270F; Edit</button>' +
            '</div>' +
          '</div>'
        );
      }).join('');

      els.grid.querySelectorAll('[data-quiz-id]').forEach(function (card) {
        card.addEventListener('click', function (e) {
          if (e.target.closest('button')) return;
          selectQuiz(card.getAttribute('data-quiz-id'));
        });
      });
      els.grid.querySelectorAll('[data-quiz-open]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          selectQuiz(btn.getAttribute('data-quiz-open'));
        });
      });
      els.grid.querySelectorAll('[data-quiz-rename]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var id = btn.getAttribute('data-quiz-rename');
          var q = state.quizzes.find(function (x) { return x.id === id; });
          if (!q) return;
          var name = window.prompt('Rename quiz', q.name);
          if (name && name.trim()) { q.name = name.trim(); renderAll(); }
        });
      });
      els.grid.querySelectorAll('[data-quiz-delete]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var id = btn.getAttribute('data-quiz-delete');
          var q = state.quizzes.find(function (x) { return x.id === id; });
          if (!q || !window.confirm('Delete quiz "' + q.name + '"?')) return;
          state.quizzes = state.quizzes.filter(function (x) { return x.id !== id; });
          if (state.activeId === id) state.activeId = state.quizzes.length ? state.quizzes[0].id : null;
          renderAll();
        });
      });
    }

    function selectQuiz(id) {
      state.activeId = id;
      var q = state.quizzes.find(function (x) { return x.id === id; });
      if (q) { q.progress = 0; q.answers = {}; q.submitted = {}; }
      renderAll();
    }

    // ── Study pane ──
    function renderStudy() {
      var q = state.quizzes.find(function (x) { return x.id === state.activeId; });

      if (!q || !q.items.length) {
        if (els.studyName) els.studyName.textContent = q ? q.name : 'Select a quiz';
        if (els.studyCount) els.studyCount.textContent = '';
        if (els.cardStage) {
          els.cardStage.className = 'qz-card-stage empty';
          els.cardStage.innerHTML = '<div class="qz-card-empty">' + (q ? 'This quiz has no questions.' : 'Pick a quiz to start.') + '</div>';
        }
        if (els.options) els.options.innerHTML = '';
        if (els.progressBar) els.progressBar.style.width = '0%';
        if (els.progressLabel) els.progressLabel.textContent = '0 / 0';
        [els.prev, els.submit, els.next].forEach(function (b) { if (b) b.disabled = true; });
        return;
      }

      if (els.studyName) els.studyName.textContent = q.name;
      if (els.studyCount) els.studyCount.textContent = q.items.length + ' questions';

      var idx = Math.max(0, Math.min(q.progress || 0, q.items.length - 1));
      var item = q.items[idx];
      var answered = q.answers[idx];
      var isSubmitted = !!q.submitted[idx];

      // Question card
      if (els.cardStage) {
        els.cardStage.className = 'qz-card-stage';
        var courseLabel = (course && course.name) ? course.name.toUpperCase() : 'COURSE';
        els.cardStage.innerHTML =
          '<div class="qz-card-pill">Question ' + (idx + 1) + ' / ' + q.items.length + '</div>' +
          '<div class="qz-card-source">' + _esc(courseLabel) + '</div>' +
          '<div class="qz-card-question">' + _esc(item.question) + '</div>';
      }

      // Options
      if (els.options) {
        var letters = ['A', 'B', 'C', 'D'];
        els.options.innerHTML = (item.options || []).map(function (opt, i) {
          var cls = 'qz-option';
          if (isSubmitted) {
            if (i === item.answer) cls += ' correct';
            else if (i === answered) cls += ' incorrect';
          } else if (i === answered) {
            cls += ' selected';
          }
          return (
            '<button class="' + cls + '" data-opt-idx="' + i + '"' + (isSubmitted ? ' disabled' : '') + '>' +
              '<span class="qz-option-letter">' + _esc(letters[i] || String(i + 1)) + '</span>' +
              '<span>' + _esc(opt) + '</span>' +
            '</button>'
          );
        }).join('');

        // Explanation after submit
        if (isSubmitted && item.explanation) {
          els.options.innerHTML +=
            '<div class="qz-explanation">&#x1F4A1; ' + _esc(item.explanation) + '</div>';
        }

        if (!isSubmitted) {
          els.options.querySelectorAll('[data-opt-idx]').forEach(function (btn) {
            btn.addEventListener('click', function () {
              q.answers[idx] = parseInt(btn.getAttribute('data-opt-idx'), 10);
              renderStudy();
            });
          });
        }
      }

      // Progress
      var pct = ((idx + 1) / q.items.length) * 100;
      if (els.progressBar) els.progressBar.style.width = pct + '%';
      if (els.progressLabel) els.progressLabel.textContent = (idx + 1) + ' / ' + q.items.length;
      if (els.prev) els.prev.disabled = idx === 0;
      if (els.next) els.next.disabled = idx >= q.items.length - 1;
      if (els.submit) {
        els.submit.disabled = answered == null;
        if (isSubmitted) {
          els.submit.textContent = '✓ Submitted';
          els.submit.className = 'qz-btn qz-btn-submit submitted';
          els.submit.disabled = true;
        } else {
          els.submit.textContent = 'Submit';
          els.submit.className = 'qz-btn qz-btn-submit';
          els.submit.disabled = answered == null;
        }
      }
    }

    function renderAll() { renderGrid(); renderStudy(); }

    // ── Controls ──
    if (els.prev) els.prev.addEventListener('click', function () {
      var q = state.quizzes.find(function (x) { return x.id === state.activeId; });
      if (!q) return;
      q.progress = Math.max(0, (q.progress || 0) - 1);
      renderAll();
    });
    if (els.next) els.next.addEventListener('click', function () {
      var q = state.quizzes.find(function (x) { return x.id === state.activeId; });
      if (!q) return;
      q.progress = Math.min(q.items.length - 1, (q.progress || 0) + 1);
      renderAll();
    });
    if (els.submit) els.submit.addEventListener('click', function () {
      var q = state.quizzes.find(function (x) { return x.id === state.activeId; });
      if (!q) return;
      var idx = q.progress || 0;
      if (q.answers[idx] == null || q.submitted[idx]) return;
      q.submitted[idx] = true;
      q.lastTaken = new Date().toISOString();
      var correct = 0;
      q.items.forEach(function (_, k) {
        if (q.submitted[k] && q.answers[k] === q.items[k].answer) correct++;
      });
      if (q.bestScore == null || correct > q.bestScore) q.bestScore = correct;
      renderAll();
    });

    if (els.settingsBtn) els.settingsBtn.addEventListener('click', function () {
      var q = state.quizzes.find(function (x) { return x.id === state.activeId; });
      if (!q) return;
      var name = window.prompt('Rename quiz', q.name);
      if (name && name.trim()) { q.name = name.trim(); renderAll(); }
    });

    if (els.viewAll) els.viewAll.addEventListener('click', function () {
      // No-op — all quizzes already shown; could expand in future
    });

    // ── Generate ──
    function defaultName() {
      return (course && course.name ? course.name : 'Quiz') + ' — Set ' + (state.quizzes.length + 1);
    }

    function doGenerate() {
      if (!options.generate) {
        _toast('Generation unavailable', 'Generator function not injected.');
        return;
      }
      if (els.generate) {
        els.generate.disabled = true;
        els.generate._origLabel = els.generate.innerHTML;
        els.generate.innerHTML = '<span class="qz-btn-icon">&#x23F3;</span> Generating…';
      }
      options.generate(courseId, 'quiz', { count: 10, difficulty: 'medium', topic: (course && course.name) || null })
        .then(function (result) {
          if (!result || !result.items || !result.items.length) {
            _toast('Nothing generated', (result && result.error) || 'No indexed content yet — upload and index a PDF first.');
            return;
          }
          var letters = ['A', 'B', 'C', 'D'];
          var quiz = {
            id: 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            name: defaultName(),
            items: result.items.map(function (item) {
              // Normalize options: backend returns {A,B,C,D} object; convert to array
              var opts;
              if (Array.isArray(item.options)) {
                opts = item.options;
              } else {
                opts = letters.map(function (l) { return (item.options && item.options[l]) || ''; });
              }
              // Normalize answer: backend returns letter string "A"-"D"; convert to index
              var ansIdx = 0;
              if (typeof item.answer === 'number') {
                ansIdx = item.answer;
              } else if (typeof item.answer === 'string') {
                var li = letters.indexOf(item.answer.toUpperCase());
                ansIdx = li >= 0 ? li : 0;
              }
              return {
                question: item.question || '',
                options: opts,
                answer: ansIdx,
                explanation: item.explanation || '',
                source: item.source || ''
              };
            }),
            createdAt: Date.now(),
            lastTaken: null,
            progress: 0,
            answers: {},
            submitted: {},
            bestScore: null
          };
          state.quizzes.unshift(quiz);
          state.activeId = quiz.id;
          _toast('Quiz generated ✨', quiz.items.length + ' questions ready.');
          renderAll();
        })
        .catch(function (err) {
          console.error('quiz generate error:', err);
          _toast('Generation failed', 'Try again, or reindex your PDFs first.');
        })
        .finally(function () {
          if (els.generate) {
            els.generate.disabled = false;
            els.generate.innerHTML = els.generate._origLabel ||
              '<span class="qz-btn-icon">&#x2728;</span> Generate quiz';
          }
        });
    }

    if (els.generate) els.generate.addEventListener('click', doGenerate);

    if (els.newQuiz) els.newQuiz.addEventListener('click', function () {
      var name = window.prompt('Name for new quiz', defaultName());
      if (!name) return;
      var quiz = {
        id: 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        name: name.trim(),
        items: [],
        createdAt: Date.now(),
        lastTaken: null,
        progress: 0,
        answers: {},
        submitted: {},
        bestScore: null
      };
      state.quizzes.unshift(quiz);
      state.activeId = quiz.id;
      renderAll();
    });

    if (els.search) els.search.addEventListener('input', renderGrid);
    if (els.sort)   els.sort.addEventListener('change', renderGrid);

    renderAll();
  }
})();
