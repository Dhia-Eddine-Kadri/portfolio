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

  var _LABEL_WARN = /^(\s*)(Important:|Critical:|Warning:|Trap:)/;
  var _LABEL_NOTE = /^(\s*)(Note:)/;

  // Apply the cheatsheet emphasis markers the generator emits, on the rendered
  // DOM (after KaTeX, so formulas — which can contain == or {{ }} — are already
  // .katex spans and are skipped):
  //   ==fact==     → yellow highlight   {{term}} → blue key term
  //   Note:/Important:/Critical: lines → orange / red
  function _decorate(root) {
    if (!root) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var targets = [];
    var n;
    while ((n = walker.nextNode())) {
      var p = n.parentNode;
      if (!p || p.closest('.katex, code, pre')) continue;
      var t = n.nodeValue || '';
      if (t.indexOf('==') === -1 && t.indexOf('{{') === -1 && !_LABEL_WARN.test(t) && !_LABEL_NOTE.test(t)) continue;
      targets.push(n);
    }
    targets.forEach(function (node) {
      var t = node.nodeValue || '';
      var html = _esc(t)
        .replace(/==([^=]+)==/g, '<mark class="cs-hl">$1</mark>')
        .replace(/\{\{([^}]+)\}\}/g, '<span class="cs-key">$1</span>');
      if (_LABEL_WARN.test(t)) html = '<span class="cs-warn">' + html + '</span>';
      else if (_LABEL_NOTE.test(t)) html = '<span class="cs-note">' + html + '</span>';
      var span = document.createElement('span');
      span.innerHTML = html;
      node.parentNode.replaceChild(span, node);
    });
  }

  // Group each `##` section (h2 + following siblings) into a .cs-block so a
  // section never splits across columns in the multi-column paper.
  function _wrapBlocks(body) {
    if (!body) return;
    var kids = Array.prototype.slice.call(body.childNodes);
    var blocks = [];
    var cur = null;
    kids.forEach(function (node) {
      if (node.nodeType === 1 && node.tagName === 'H2') {
        cur = document.createElement('div');
        cur.className = 'cs-block';
        blocks.push(cur);
      } else if (!cur) {
        cur = document.createElement('div');
        cur.className = 'cs-block';
        blocks.push(cur);
      }
      cur.appendChild(node);
    });
    body.innerHTML = '';
    blocks.forEach(function (b) { body.appendChild(b); });
  }

  function _renderMarkdown(el, md, paper) {
    var doRender = function () {
      el.innerHTML = typeof window.renderMarkdown === 'function' ? window.renderMarkdown(md) : _esc(md);
      if (typeof window._renderMath === 'function') window._renderMath(el);
      if (typeof window._renderCode === 'function') window._renderCode(el);
      _decorate(el);
      if (paper) _wrapBlocks(el);
    };
    _ensureRenderers().then(doRender).catch(doRender);
  }

  // ── white "paper" view (Hyperknow-style) + print/PDF ───────────────────────

  var _csRun = 0;

  function _sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function _startBuildSteps(els, topic) {
    var runId = ++_csRun;
    var steps = [
      'Finding the strongest course evidence',
      'Grouping formulas, definitions, and rules',
      'Drafting exam-ready sections',
      'Checking source coverage',
      'Preparing the cheatsheet view',
    ];
    var idx = 0;
    els.result.innerHTML =
      '<div class="cs-build" data-run="' + runId + '">' +
        '<div class="cs-build-title">Writing ' + _esc(topic || 'the course cheatsheet') + '</div>' +
        '<div class="cs-build-steps">' + steps.map(function (s, i) {
          return '<div class="cs-build-step' + (i === 0 ? ' is-active' : '') + '" data-step="' + i + '">' +
            '<span class="cs-step-dot"></span><span>' + _esc(s) + '</span></div>';
        }).join('') + '</div>' +
      '</div>';
    var timer = setInterval(function () {
      if (runId !== _csRun || !els.result.querySelector('.cs-build')) {
        clearInterval(timer);
        return;
      }
      idx = Math.min(idx + 1, steps.length - 1);
      els.result.querySelectorAll('.cs-build-step').forEach(function (el, i) {
        el.classList.toggle('is-done', i < idx);
        el.classList.toggle('is-active', i === idx);
      });
    }, 1100);
    return {
      id: runId,
      stop: function () { clearInterval(timer); },
    };
  }

  function _splitSections(md) {
    var text = String(md || '').trim();
    if (!text) return [];
    var chunks = text.split(/\n(?=##\s+)/g).filter(function (x) { return x && x.trim(); });
    return chunks.map(function (chunk, i) {
      var m = chunk.match(/^##\s+(.+?)(?:\n|$)/);
      return {
        title: m ? m[1].trim() : (i === 0 ? 'Overview' : 'Section ' + (i + 1)),
        markdown: chunk,
      };
    });
  }

  function _renderResultProgressive(els, res, runId) {
    if (runId !== _csRun) return;
    if (!res || res.error || !res.text || !res.text.trim()) {
      _renderResult(els, res);
      return;
    }
    var topics = (res.topicsCovered || []).filter(Boolean);
    var sources = res.groundedSources || [];
    var nFiles = sources.reduce(function (set, s) { if (s.fileName) set[s.fileName] = 1; return set; }, {});
    var fileCount = Object.keys(nFiles).length;
    var sections = _splitSections(res.text);
    if (!sections.length) sections = [{ title: res.title || 'Cheatsheet', markdown: res.text }];
    els._paper = {
      course: els.courseName || 'Cheatsheet',
      title: res.title || 'Cheatsheet',
      scope: res.title || 'Course cheatsheet',
      meta: (fileCount ? 'Based on ' + fileCount + ' file' + (fileCount === 1 ? '' : 's') + ' · ' : '') + 'generated cheatsheet',
      markdown: res.text,
    };
    els.result.innerHTML =
      '<div class="cs-sheet">' +
        '<div class="cs-sheet-head">' +
          '<h3>' + _esc(res.title || 'Cheatsheet') + '</h3>' +
          (res.noteId ? '<span class="cs-saved">Saved to your notes</span>' : '') +
          '<button type="button" class="cs-btn cs-view-print" data-cs-view disabled>View / Print</button>' +
        '</div>' +
        '<div class="cs-writing-line">Writing section 1 of ' + sections.length + '</div>' +
        '<div class="cs-sheet-body"></div>' +
        '<div class="cs-after" hidden>' +
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
        '</div>' +
      '</div>';
    var body = els.result.querySelector('.cs-sheet-body');
    var line = els.result.querySelector('.cs-writing-line');
    var viewBtn = els.result.querySelector('[data-cs-view]');
    var after = els.result.querySelector('.cs-after');
    if (viewBtn) viewBtn.addEventListener('click', function () { _openPaper(els._paper); });
    (async function () {
      for (var i = 0; i < sections.length; i += 1) {
        if (runId !== _csRun || !body || !body.isConnected) return;
        if (line) line.textContent = 'Writing section ' + (i + 1) + ' of ' + sections.length + ': ' + sections[i].title;
        var block = document.createElement('div');
        block.className = 'cs-progress-section';
        block.innerHTML = '<div class="cs-section-writing">Writing...</div><div class="cs-section-content"></div>';
        body.appendChild(block);
        await _sleep(i === 0 ? 120 : 420);
        if (runId !== _csRun || !block.isConnected) return;
        _renderMarkdown(block.querySelector('.cs-section-content'), sections[i].markdown);
        var writing = block.querySelector('.cs-section-writing');
        if (writing) writing.remove();
        block.classList.add('is-written');
        await _sleep(360);
      }
      if (runId !== _csRun) return;
      if (line) line.textContent = 'Cheatsheet complete';
      if (after) after.removeAttribute('hidden');
      if (viewBtn) viewBtn.disabled = false;
      _bindSourceClicks(els.result);
    })();
  }

  var _paperEl = null;
  var _paperEsc = null;

  function _closePaper() {
    if (_paperEsc) { document.removeEventListener('keydown', _paperEsc); _paperEsc = null; }
    if (_paperEl) { _paperEl.remove(); _paperEl = null; }
  }

  // Lazy-load html2pdf (jsPDF + html2canvas) once, so "Download PDF" produces a
  // file directly — no browser print dialog.
  function _ensureHtml2Pdf() {
    if (window.html2pdf) return Promise.resolve(window.html2pdf);
    if (window._ssHtml2PdfP) return window._ssHtml2PdfP;
    window._ssHtml2PdfP = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.2/dist/html2pdf.bundle.min.js';
      s.onload = function () { resolve(window.html2pdf); };
      s.onerror = function () { reject(new Error('pdf lib failed to load')); };
      document.head.appendChild(s);
    });
    return window._ssHtml2PdfP;
  }

  function _safeName(s) {
    return String(s || 'document').replace(/[^\w.\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 80) || 'document';
  }

  function _downloadPdf(el, filename) {
    return _ensureHtml2Pdf().then(function (h2p) {
      return h2p().set({
        margin: [8, 8, 10, 8],
        filename: filename,
        image: { type: 'jpeg', quality: 0.96 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'], avoid: '.cs-block' },
      }).from(el).save();
    });
  }

  function _wireDownload(btn, getEl, filename) {
    if (!btn) return;
    btn.addEventListener('click', function () {
      var el = getEl();
      if (!el) return;
      var label = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Generating…';
      _downloadPdf(el, filename).then(function () {
        btn.disabled = false;
        btn.textContent = label;
      }).catch(function () {
        btn.disabled = false;
        btn.textContent = label;
        if (window.showToast) window.showToast('Download failed', 'Could not generate the PDF. Please try again.');
      });
    });
  }

  function _openPaper(opts) {
    opts = opts || {};
    _closePaper();
    var ov = document.createElement('div');
    ov.className = 'cs-paper-overlay ss-print-root';
    ov.innerHTML =
      '<div class="cs-paper-bar">' +
        '<span class="cs-paper-bar-title">' + _esc(opts.title || 'Cheatsheet') + '</span>' +
        '<div class="cs-paper-bar-actions">' +
          '<button type="button" class="cs-paper-btn" data-act="download">⤓ Download PDF</button>' +
          '<button type="button" class="cs-paper-btn cs-paper-close" data-act="close">Close</button>' +
        '</div>' +
      '</div>' +
      '<div class="cs-paper-scroll">' +
        '<article class="cs-paper">' +
          '<header class="cs-paper-head">' +
            '<h1>' + _esc(opts.course || 'Cheatsheet') + '</h1>' +
            (opts.scope ? '<div class="cs-paper-scope">' + _esc(opts.scope) + '</div>' : '') +
            (opts.meta ? '<div class="cs-paper-meta">' + _esc(opts.meta) + '</div>' : '') +
          '</header>' +
          '<div class="cs-paper-body"></div>' +
        '</article>' +
      '</div>';
    document.body.appendChild(ov);
    _paperEl = ov;
    var body = ov.querySelector('.cs-paper-body');
    if (body) _renderMarkdown(body, opts.markdown || '', true);
    ov.querySelector('[data-act="close"]').addEventListener('click', _closePaper);
    _wireDownload(
      ov.querySelector('[data-act="download"]'),
      function () { return ov.querySelector('.cs-paper'); },
      _safeName((opts.course || 'cheatsheet') + ' cheatsheet') + '.pdf'
    );
    _paperEsc = function (e) { if (e.key === 'Escape') _closePaper(); };
    document.addEventListener('keydown', _paperEsc);
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
    var nFiles = sources.reduce(function (set, s) { if (s.fileName) set[s.fileName] = 1; return set; }, {});
    var fileCount = Object.keys(nFiles).length;
    els._paper = {
      course: els.courseName || 'Cheatsheet',
      title: res.title || 'Cheatsheet',
      scope: res.title || 'Course cheatsheet',
      meta: (fileCount ? 'Based on ' + fileCount + ' file' + (fileCount === 1 ? '' : 's') + ' · ' : '') + 'generated cheatsheet',
      markdown: res.text,
    };
    els.result.innerHTML =
      '<div class="cs-sheet">' +
        '<div class="cs-sheet-head">' +
          '<h3>' + _esc(res.title || 'Cheatsheet') + '</h3>' +
          (res.noteId ? '<span class="cs-saved">Saved to your notes</span>' : '') +
          '<button type="button" class="cs-btn cs-view-print" data-cs-view>View / Print</button>' +
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
    var viewBtn = els.result.querySelector('[data-cs-view]');
    if (viewBtn) viewBtn.addEventListener('click', function () { _openPaper(els._paper); });
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
      els._paper = {
        course: els.courseName || 'Cheatsheet',
        title: note.title || 'Cheatsheet',
        scope: note.title || 'Saved cheatsheet',
        meta: 'Saved cheatsheet',
        markdown: note.content_markdown || '',
      };
      els.result.innerHTML =
        '<div class="cs-sheet"><div class="cs-sheet-head"><h3>' + _esc(note.title || 'Cheatsheet') + '</h3>' +
        '<button type="button" class="cs-btn cs-view-print" data-cs-view>View / Print</button></div>' +
        '<div class="cs-sheet-body"></div></div>';
      var body = els.result.querySelector('.cs-sheet-body');
      if (body) _renderMarkdown(body, note.content_markdown || '');
      var viewBtn = els.result.querySelector('[data-cs-view]');
      if (viewBtn) viewBtn.addEventListener('click', function () { _openPaper(els._paper); });
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
      courseName: (course && (course.name || course.title)) || 'Cheatsheet',
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
      var progress;
      els.result.innerHTML = '<div class="cs-msg cs-loading">Generating cheatsheet… this can take a moment.</div>';
      progress = _startBuildSteps(els, topic);
      _aiService()
        .then(function (svc) {
          return svc.generateCheatsheet(courseId, topic ? { topic: topic } : {}).then(function (res) {
            els.gen.disabled = false;
            progress.stop();
            _renderResultProgressive(els, res, progress.id);
            // A new cheatsheet was just saved — refresh the saved list.
            if (res && res.noteId) _loadSaved(svc, els, courseId);
            return res;
          });
        })
        .catch(function (err) {
          els.gen.disabled = false;
          progress.stop();
          els.result.innerHTML =
            '<div class="cs-msg cs-error">' + _esc(err && err.message ? err.message : 'Cheatsheet failed. Please try again.') + '</div>';
        });
    });
  };
})();
