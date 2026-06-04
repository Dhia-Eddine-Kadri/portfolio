// Cheatsheet course tool (Learning Agent Phase 4).
//
// A dense, exam-ready summary of the course — key formulas, definitions and
// rules, ranked by the course Topic Map's importance and grounded in the
// user's own files. Course-wide by default; an optional topic focuses it.
// Generation + grounding happen server-side (generateCheatsheet); the result
// is markdown saved as a note (type 'cheatsheet') and rendered here with
// clickable sources.

(function () {
  'use strict';

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function _aiService() {
    return import('/js/services/ai-service.js');
  }

  var _HTML =
    '<div class="cs-root" data-cheatsheet-root>' +
      '<div class="cs-head">' +
        '<h2>Cheatsheet</h2>' +
        '<p>A dense, exam-ready summary of this course — the key formulas, definitions and rules, ranked by importance and grounded in your uploaded files.</p>' +
      '</div>' +
      '<div class="cs-controls">' +
        '<input type="text" id="csTopic" class="cs-topic" placeholder="Focus on one topic (optional) — leave blank for the whole course">' +
        '<button class="cs-btn cs-btn-primary" id="csGenerate" type="button">Generate cheatsheet</button>' +
      '</div>' +
      '<div class="cs-saved-wrap" id="csSaved" hidden>' +
        '<div class="cs-saved-head">Saved cheatsheets</div>' +
        '<div class="cs-saved-list" id="csSavedList"></div>' +
      '</div>' +
      '<div class="cs-result" id="csResult"></div>' +
    '</div>';

  // The real markdown+KaTeX renderer lives in the AI render bridge, which the
  // app loads lazily (only when the chatbot opens). Until then window.renderMarkdown
  // is a plain escapeHtml stub — so without this the cheatsheet shows raw "##" and
  // "$$". Ensure the bridge AND KaTeX before rendering.
  function _ensureRenderers() {
    var ps = [];
    if (typeof window._ensureAiRenderBridge === 'function') ps.push(window._ensureAiRenderBridge());
    if (typeof window._ssEnsureKatex === 'function') ps.push(window._ssEnsureKatex());
    return Promise.all(ps);
  }

  function _renderMarkdown(el, md) {
    var doRender = function () {
      el.innerHTML = typeof window.renderMarkdown === 'function' ? window.renderMarkdown(md) : _esc(md);
      if (typeof window._renderMath === 'function') window._renderMath(el);
      if (typeof window._renderCode === 'function') window._renderCode(el);
    };
    _ensureRenderers().then(doRender).catch(doRender);
  }

  function _bindSourceClicks(scope) {
    scope.querySelectorAll('.cs-sources .src-cite').forEach(function (el) {
      el.addEventListener('click', function () {
        var fn = el.getAttribute('data-src-file');
        if (!fn || typeof window.openCitedSource !== 'function') return;
        window.openCitedSource({ fileName: fn, page: el.getAttribute('data-src-page') }, 'popup');
      });
    });
  }

  function _renderResult(els, res) {
    if (!res || res.error) {
      els.result.innerHTML =
        '<div class="cs-msg cs-error">' + _esc((res && res.error) || 'Cheatsheet failed. Please try again.') + '</div>';
      return;
    }
    if (!res.text || !res.text.trim()) {
      els.result.innerHTML =
        '<div class="cs-msg">' + _esc(res.warning || 'No cheatsheet could be generated from your course materials yet.') + '</div>';
      return;
    }
    var topics = (res.topicsCovered || []).filter(Boolean);
    var sources = res.groundedSources || [];
    els.result.innerHTML =
      '<div class="cs-sheet">' +
        '<div class="cs-sheet-head">' +
          '<h3>' + _esc(res.title || 'Cheatsheet') + '</h3>' +
          (res.noteId ? '<span class="cs-saved">Saved to your notes</span>' : '') +
        '</div>' +
        '<div class="cs-sheet-body"></div>' +
        (topics.length ? '<div class="cs-topics">Topics: ' + topics.map(_esc).join(' · ') + '</div>' : '') +
        (sources.length
          ? '<div class="cs-sources">Sources: ' +
              sources.map(function (s) {
                var pg = s.pageStart == null ? '' : s.pageStart;
                return '<span class="src-cite" title="Open this source" data-src-file="' + _esc(s.fileName || '') +
                  '" data-src-page="' + _esc(pg) + '">' + _esc(s.fileName || 'Source') +
                  (pg ? ', p.' + _esc(pg) : '') + '</span>';
              }).join(' · ') +
            '</div>'
          : '') +
      '</div>';
    var body = els.result.querySelector('.cs-sheet-body');
    if (body) _renderMarkdown(body, res.text);
    _bindSourceClicks(els.result);
  }

  // ── saved cheatsheets (persisted as notes of type 'cheatsheet') ────────────

  function _fmtDate(s) {
    if (!s) return '';
    try {
      return new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch (e) { return ''; }
  }

  function _viewSaved(svc, els, id) {
    if (!id || !svc.getNoteById) return;
    els.result.innerHTML = '<div class="cs-msg cs-loading">Loading cheatsheet…</div>';
    svc.getNoteById(id).then(function (note) {
      if (!note) { els.result.innerHTML = '<div class="cs-msg cs-error">Could not load this cheatsheet.</div>'; return; }
      els.result.innerHTML =
        '<div class="cs-sheet"><div class="cs-sheet-head"><h3>' + _esc(note.title || 'Cheatsheet') + '</h3></div>' +
        '<div class="cs-sheet-body"></div></div>';
      var body = els.result.querySelector('.cs-sheet-body');
      if (body) _renderMarkdown(body, note.content_markdown || '');
    }).catch(function () {
      els.result.innerHTML = '<div class="cs-msg cs-error">Could not load this cheatsheet.</div>';
    });
  }

  function _renderSavedList(svc, els, courseId, sheets) {
    if (!els.saved || !els.savedList) return;
    if (!sheets || !sheets.length) {
      els.saved.setAttribute('hidden', '');
      els.savedList.innerHTML = '';
      return;
    }
    els.saved.removeAttribute('hidden');
    els.savedList.innerHTML = sheets.map(function (n) {
      return '<div class="cs-saved-item">' +
        '<button type="button" class="cs-saved-open" data-id="' + _esc(n.id) + '">' +
          '<span class="cs-saved-title">' + _esc(n.title || 'Cheatsheet') + '</span>' +
          '<span class="cs-saved-date">' + _esc(_fmtDate(n.created_at || n.updated_at)) + '</span>' +
        '</button>' +
        '<button type="button" class="cs-saved-del" data-id="' + _esc(n.id) + '" title="Delete cheatsheet" aria-label="Delete cheatsheet">×</button>' +
      '</div>';
    }).join('');
    els.savedList.querySelectorAll('.cs-saved-open').forEach(function (b) {
      b.addEventListener('click', function () { _viewSaved(svc, els, b.getAttribute('data-id')); });
    });
    els.savedList.querySelectorAll('.cs-saved-del').forEach(function (b) {
      b.addEventListener('click', function () {
        b.disabled = true;
        svc.deleteNote(b.getAttribute('data-id')).then(function () { _loadSaved(svc, els, courseId); });
      });
    });
  }

  function _loadSaved(svc, els, courseId) {
    if (!svc.listCourseNotes || !courseId) return;
    svc.listCourseNotes(courseId).then(function (notes) {
      var sheets = (notes || []).filter(function (n) { return n.type === 'cheatsheet'; });
      _renderSavedList(svc, els, courseId, sheets);
    }).catch(function () { /* non-fatal: saved list is additive */ });
  }

  window.mountCheatsheet = function (target, course) {
    if (!target) return;
    target.innerHTML = _HTML;
    var root = target.querySelector('[data-cheatsheet-root]');
    if (!root) return;
    var courseId = (course && course.id) || window.activeCourseId || '';
    var els = {
      topic: root.querySelector('#csTopic'),
      gen: root.querySelector('#csGenerate'),
      result: root.querySelector('#csResult'),
      saved: root.querySelector('#csSaved'),
      savedList: root.querySelector('#csSavedList'),
    };
    if (!els.gen) return;

    _aiService().then(function (svc) { _loadSaved(svc, els, courseId); });

    els.gen.addEventListener('click', function () {
      if (!courseId) return;
      var topic = ((els.topic && els.topic.value) || '').trim();
      els.gen.disabled = true;
      els.result.innerHTML = '<div class="cs-msg cs-loading">Generating cheatsheet… this can take a moment.</div>';
      _aiService()
        .then(function (svc) {
          return svc.generateCheatsheet(courseId, topic ? { topic: topic } : {}).then(function (res) {
            els.gen.disabled = false;
            _renderResult(els, res);
            // A new cheatsheet was just saved — refresh the saved list.
            if (res && res.noteId) _loadSaved(svc, els, courseId);
            return res;
          });
        })
        .catch(function (err) {
          els.gen.disabled = false;
          els.result.innerHTML =
            '<div class="cs-msg cs-error">' + _esc(err && err.message ? err.message : 'Cheatsheet failed. Please try again.') + '</div>';
        });
    });
  };
})();
