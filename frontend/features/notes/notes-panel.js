// AI Notes Panel — splits the PDF viewer into a two-column workspace.
(function () {
  'use strict';

  // ── State ─────────────────────────────────────────────────────────────────
  var _panelOpen   = false;
  var _activeTab   = 'notes';
  var _dirty       = false;
  var _currentNote = null;
  var _notesByType = { notes: null, summary: null };
  var _generating  = false;
  var _saveTimer   = null;
  var _scope       = 'section';          // page | section | range | document
  var _language    = 'same_as_source';   // same_as_source | en | de | bilingual

  // Context set when openFile fires
  var _ctx = { courseId: null, documentId: null, fileName: null };

  // ── DOM helpers ───────────────────────────────────────────────────────────
  function $id(id) { return document.getElementById(id); }

  function _apiHeaders() {
    return {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + (window._sbToken || '')
    };
  }

  // ── Markdown + KaTeX renderer ─────────────────────────────────────────────
  function _renderMath(text) {
    if (!text || !window.katex) return text;
    text = text.replace(/\$\$([^$]+?)\$\$/g, function (_, m) {
      try { return window.katex.renderToString(m, { displayMode: true,  throwOnError: false }); }
      catch (e) { return '$$' + m + '$$'; }
    });
    text = text.replace(/\$([^$\n]+?)\$/g, function (_, m) {
      try { return window.katex.renderToString(m, { displayMode: false, throwOnError: false }); }
      catch (e) { return '$' + m + '$'; }
    });
    return text;
  }

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function _inlineMd(s) {
    var r = _renderMath(s);
    return r
      .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__(.+?)__/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/_(.+?)_/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }

  function _md2html(md) {
    if (!md) return '';
    var lines = md.split('\n');
    var out = [];
    var i = 0;
    var inCode = false;

    while (i < lines.length) {
      var line = lines[i];

      if (line.startsWith('```')) {
        if (!inCode) { inCode = true; out.push('<pre><code>'); }
        else          { inCode = false; out.push('</code></pre>'); }
        i++; continue;
      }
      if (inCode) { out.push(_esc(line) + '\n'); i++; continue; }

      var hm = line.match(/^(#{1,4})\s+(.*)/);
      if (hm) { out.push('<h' + hm[1].length + '>' + _inlineMd(hm[2]) + '</h' + hm[1].length + '>'); i++; continue; }

      if (/^---+$/.test(line.trim())) { out.push('<hr>'); i++; continue; }
      if (!line.trim()) { out.push('<br>'); i++; continue; }

      if (/^[-*]\s/.test(line)) {
        out.push('<ul>');
        while (i < lines.length && /^[-*]\s/.test(lines[i])) {
          out.push('<li>' + _inlineMd(lines[i].replace(/^[-*]\s+/, '')) + '</li>');
          i++;
        }
        out.push('</ul>'); continue;
      }

      if (/^\d+\.\s/.test(line)) {
        out.push('<ol>');
        while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
          out.push('<li>' + _inlineMd(lines[i].replace(/^\d+\.\s+/, '')) + '</li>');
          i++;
        }
        out.push('</ol>'); continue;
      }

      if (line.includes('|') && lines[i + 1] && /^\|?[-: |]+\|?$/.test(lines[i + 1])) {
        out.push('<table><thead><tr>');
        line.split('|').filter(function (c) { return c.trim(); }).forEach(function (c) {
          out.push('<th>' + _inlineMd(c.trim()) + '</th>');
        });
        out.push('</tr></thead><tbody>');
        i += 2;
        while (i < lines.length && lines[i].includes('|')) {
          out.push('<tr>');
          lines[i].split('|').filter(function (c) { return c.trim(); }).forEach(function (c) {
            out.push('<td>' + _inlineMd(c.trim()) + '</td>');
          });
          out.push('</tr>');
          i++;
        }
        out.push('</tbody></table>'); continue;
      }

      out.push('<p>' + _inlineMd(line) + '</p>');
      i++;
    }
    return out.join('\n');
  }

  // ── Panel HTML ────────────────────────────────────────────────────────────
  function _panelHTML() {
    return [
      '<div class="np-header">',
        '<div class="np-tabs">',
          '<button class="np-tab active" data-tab="notes">Notes</button>',
          '<button class="np-tab" data-tab="summary">Summary</button>',
        '</div>',
        '<div class="np-header-actions">',
          '<button class="np-icon-btn" id="npExport" title="Export as PDF">&#x1F4E4;</button>',
          '<button class="np-icon-btn" id="npClose" title="Close">&#x2715;</button>',
        '</div>',
      '</div>',

      // Scope + language row
      '<div class="np-options-row" id="npOptionsRow">',
        '<div class="np-option-group">',
          '<span class="np-option-label">Scope:</span>',
          '<button class="np-opt" data-scope="page">Page</button>',
          '<button class="np-opt active" data-scope="section">±1 page</button>',
          '<button class="np-opt" data-scope="document">Whole PDF</button>',
        '</div>',
        '<div class="np-option-group">',
          '<span class="np-option-label">Lang:</span>',
          '<button class="np-opt active" data-lang="same_as_source">Auto</button>',
          '<button class="np-opt" data-lang="en">EN</button>',
          '<button class="np-opt" data-lang="de">DE</button>',
        '</div>',
      '</div>',

      // Action bar
      '<div class="np-action-bar">',
        '<button class="np-btn-generate" id="npGenerate">&#x2728; Generate</button>',
        '<button class="np-btn-regen" id="npRegen" title="Regenerate" style="display:none">&#x21BB; Regenerate</button>',
        '<div class="np-spacer"></div>',
        '<button class="np-btn-save" id="npSave" style="display:none">&#x1F4BE; Save</button>',
        '<span class="np-status" id="npStatus"></span>',
      '</div>',

      // Content area
      '<div class="np-body" id="npBody">',
        '<div class="np-empty" id="npEmpty">',
          '<div class="np-empty-icon">&#x1F4DD;</div>',
          '<div class="np-empty-title">No notes yet</div>',
          '<div class="np-empty-sub">Click <strong>Generate</strong> to create AI notes from this PDF.</div>',
        '</div>',

        '<div class="np-editor-wrap" id="npEditorWrap" style="display:none">',
          // Title as a proper editable heading
          '<div class="np-title-row">',
            '<input class="np-title-input" id="npTitle" type="text" placeholder="Note title">',
          '</div>',
          // Preview / Edit tabs
          '<div class="np-view-tabs">',
            '<button class="np-view-tab active" data-view="preview">Preview</button>',
            '<button class="np-view-tab" data-view="edit">Edit</button>',
          '</div>',
          '<div class="np-preview" id="npPreview"></div>',
          '<textarea class="np-editor-ta" id="npEditor" style="display:none" spellcheck="false" placeholder="Markdown…"></textarea>',
        '</div>',
      '</div>',

      // Loading overlay
      '<div class="np-gen-overlay" id="npGenOverlay" style="display:none">',
        '<div class="np-gen-box">',
          '<div class="np-gen-spinner"></div>',
          '<div class="np-gen-msg" id="npGenMsg">Generating notes…</div>',
        '</div>',
      '</div>'
    ].join('');
  }

  // ── Create DOM ────────────────────────────────────────────────────────────
  function _createPanel() {
    if ($id('pdfNotesPanel')) return;
    var panel = document.createElement('div');
    panel.id = 'pdfNotesPanel';
    panel.className = 'pdf-notes-panel';
    panel.style.display = 'none';
    panel.innerHTML = _panelHTML();
    var wrap = $id('pdfViewerWrap');
    if (wrap) wrap.appendChild(panel);
    _bindEvents(panel);
  }

  // ── Open / Close ──────────────────────────────────────────────────────────
  function _openPanel() {
    var panel = $id('pdfNotesPanel');
    var pdfView = $id('pdfView');
    if (!panel || !pdfView) return;
    _panelOpen = true;
    panel.style.display = 'flex';
    pdfView.classList.add('pdf-split');
    _renderCurrentTab();
  }

  function _closePanel() {
    var panel = $id('pdfNotesPanel');
    var pdfView = $id('pdfView');
    if (!panel || !pdfView) return;
    _panelOpen = false;
    panel.style.display = 'none';
    pdfView.classList.remove('pdf-split');
    var toggleBtn = $id('pdfNotesToggle');
    if (toggleBtn) toggleBtn.classList.remove('active');
  }

  // ── Tab switching ─────────────────────────────────────────────────────────
  function _switchTab(tab) {
    _activeTab = tab;
    var panel = $id('pdfNotesPanel');
    if (!panel) return;
    panel.querySelectorAll('.np-tab').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    _currentNote = _notesByType[tab];
    _renderCurrentTab();
  }

  // ── Render state into panel ───────────────────────────────────────────────
  function _renderCurrentTab() {
    var empty   = $id('npEmpty');
    var wrap    = $id('npEditorWrap');
    var regen   = $id('npRegen');
    var save    = $id('npSave');
    var preview = $id('npPreview');
    var editor  = $id('npEditor');
    var title   = $id('npTitle');
    if (!empty) return;

    if (!_currentNote) {
      empty.style.display = 'flex';
      if (wrap)  wrap.style.display = 'none';
      if (regen) regen.style.display = 'none';
      if (save)  save.style.display = 'none';
      return;
    }

    empty.style.display = 'none';
    if (wrap)  wrap.style.display = 'flex';
    if (regen) regen.style.display = '';
    if (save)  save.style.display = '';
    if (title)   title.value = _currentNote.title || '';
    if (editor)  editor.value = _currentNote.content_markdown || '';
    if (preview) preview.innerHTML = _md2html(_currentNote.content_markdown || '');
    _setStatus('');
  }

  function _setStatus(msg, cls) {
    var el = $id('npStatus');
    if (!el) return;
    el.textContent = msg;
    el.className = 'np-status' + (cls ? ' ' + cls : '');
  }

  // ── Load existing notes ───────────────────────────────────────────────────
  async function _loadNotes() {
    if (!_ctx.documentId || !_ctx.courseId) return;
    try {
      var r = await fetch(
        (window.BACKEND_URL || '') + '/api/notes?courseId=' + encodeURIComponent(_ctx.courseId) +
        '&documentId=' + encodeURIComponent(_ctx.documentId),
        { headers: _apiHeaders() }
      );
      var data = r.ok ? await r.json() : {};
      (data.notes || []).forEach(function (n) {
        if ((n.type === 'notes' || n.type === 'summary') && !_notesByType[n.type]) {
          _notesByType[n.type] = { id: n.id, title: n.title, type: n.type, content_markdown: '' };
        }
      });
      for (var t of ['notes', 'summary']) {
        if (_notesByType[t] && _notesByType[t].id && !_notesByType[t].content_markdown) {
          await _loadNoteContent(_notesByType[t]);
        }
      }
    } catch (e) { console.warn('[notes-panel] load error:', e); }
    _currentNote = _notesByType[_activeTab];
    if (_panelOpen) _renderCurrentTab();
  }

  async function _loadNoteContent(note) {
    try {
      var r = await fetch(
        (window.BACKEND_URL || '') + '/api/notes?id=' + encodeURIComponent(note.id),
        { headers: _apiHeaders() }
      );
      var data = r.ok ? await r.json() : {};
      if (data.note) {
        note.title = data.note.title;
        note.content_markdown = data.note.content_markdown || '';
      }
    } catch (e) {}
  }

  // ── Page-range text helper ────────────────────────────────────────────────
  function _getPdfTextForRange(start, end) {
    var texts = window.pdfPageTexts;
    if (texts && start != null) {
      var parts = [];
      for (var p = start; p <= (end || start); p++) {
        if (texts[p]) parts.push('[S. ' + p + ']\n' + texts[p]);
      }
      if (parts.length) return parts.join('\n\n');
    }
    // No page-specific text available — return empty so backend uses indexed chunks only
    return '';
  }

  // ── Generate ──────────────────────────────────────────────────────────────
  async function _generate() {
    if (_generating) return;
    if (!_ctx.courseId) {
      if (typeof showToast === 'function') showToast('No course', 'Open a course PDF first.');
      return;
    }

    _generating = true;
    var overlay = $id('npGenOverlay');
    var genMsg  = $id('npGenMsg');
    if (overlay) overlay.style.display = 'flex';
    if (genMsg)  genMsg.textContent = 'Generating ' + (_activeTab === 'summary' ? 'summary' : 'detailed notes') + '…';

    try {
      // Use visible page helper — works in scroll/all-pages mode
      var visiblePage = typeof window._pdfVisiblePage === 'function'
        ? window._pdfVisiblePage()
        : null;
      var currentPage = visiblePage || window.pdfPage || null;

      // Determine page range for this scope
      var rangeStart = null;
      var rangeEnd   = null;
      if (_scope === 'page' && currentPage) {
        rangeStart = currentPage;
        rangeEnd   = currentPage;
      } else if (_scope === 'section' && currentPage) {
        rangeStart = Math.max(1, currentPage - 1);
        rangeEnd   = currentPage + 1;
      }
      // _scope === 'document': rangeStart/End stay null

      // Send page-range text as fallback (empty string if not available —
      // tells backend to use indexed chunks only, not whole pdfFullText)
      var pdfText = _getPdfTextForRange(rangeStart, rangeEnd);

      var payload = {
        courseId:    _ctx.courseId,
        documentId:  _ctx.documentId || null,
        tool:        _activeTab,
        fileName:    _ctx.fileName || null,
        pdfText:     pdfText,
        scope:       _scope,
        language:    _language,
        currentPage: currentPage
      };

      if (rangeStart != null) {
        payload.pageRange = { start: rangeStart, end: rangeEnd };
      }

      // ── Debug log ─────────────────────────────────────────────────────────
      console.log('[notes generate payload]', {
        currentPage: currentPage,
        visiblePage: visiblePage,
        pdfPage: window.pdfPage,
        scope: _scope,
        rangeStart: rangeStart,
        rangeEnd: rangeEnd,
        documentId: _ctx.documentId,
        courseId: _ctx.courseId,
        hasPdfPageTexts: !!window.pdfPageTexts,
        pdfPageTextKeys: window.pdfPageTexts ? Object.keys(window.pdfPageTexts).slice(0, 10) : null,
        fallbackPdfTextPreview: pdfText ? pdfText.slice(0, 300) : null
      });

      var resp = await fetch((window.BACKEND_URL || '') + '/api/notes/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (window._sbToken || '') },
        body: JSON.stringify(payload)
      });
      var data = await resp.json();

      if (data.error) {
        if (typeof showToast === 'function') showToast('Generation failed', data.error);
        _setStatus(data.error, 'err');
      } else if (data.note) {
        _notesByType[_activeTab] = data.note;
        _currentNote = data.note;
        _renderCurrentTab();
        _setStatus('Generated ✓', 'ok');
        if (typeof showToast === 'function') showToast('Notes ready', 'AI notes saved to your account.');
      }
    } catch (e) {
      if (typeof showToast === 'function') showToast('Generation failed', e.message || 'Network error');
      _setStatus('Failed', 'err');
    } finally {
      _generating = false;
      if (overlay) overlay.style.display = 'none';
    }
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  async function _save(quiet) {
    if (!_currentNote || !_currentNote.id) return;
    var editor  = $id('npEditor');
    var titleEl = $id('npTitle');
    var md    = editor  ? editor.value  : _currentNote.content_markdown;
    var title = titleEl ? titleEl.value : _currentNote.title;

    if (md === _currentNote.content_markdown && title === _currentNote.title) {
      if (!quiet) _setStatus('No changes', '');
      return;
    }
    _setStatus('Saving…', '');
    try {
      var resp = await fetch(
        (window.BACKEND_URL || '') + '/api/notes?id=' + encodeURIComponent(_currentNote.id),
        { method: 'PATCH', headers: _apiHeaders(), body: JSON.stringify({ title: title, content_markdown: md }) }
      );
      if (resp.ok) {
        _currentNote.content_markdown = md;
        _currentNote.title = title;
        _notesByType[_activeTab] = _currentNote;
        _dirty = false;
        _setStatus('Saved ✓', 'ok');
        var preview = $id('npPreview');
        if (preview) preview.innerHTML = _md2html(md);
      } else {
        _setStatus('Save failed', 'err');
      }
    } catch (e) { _setStatus('Save failed', 'err'); }
  }

  // ── Export as PDF ─────────────────────────────────────────────────────────
  function _exportPdf() {
    if (!_currentNote || !_currentNote.content_markdown) {
      if (typeof showToast === 'function') showToast('Nothing to export', 'Generate notes first.');
      return;
    }
    var preview = $id('npPreview');
    var html  = preview ? preview.innerHTML : _md2html(_currentNote.content_markdown);
    var title = _currentNote.title || 'Notes';
    var win = window.open('', '_blank', 'width=900,height=700');
    if (!win) return;
    win.document.write('<!DOCTYPE html><html><head>' +
      '<meta charset="utf-8"><title>' + _esc(title) + '</title>' +
      '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.10/dist/katex.min.css">' +
      '<style>body{font-family:Georgia,serif;max-width:800px;margin:40px auto;color:#111;line-height:1.7;padding:0 20px}' +
      'h1{font-size:1.8rem;border-bottom:2px solid #333;padding-bottom:8px}' +
      'h2{font-size:1.3rem;margin-top:1.6em}h3{font-size:1.1rem}' +
      'pre{background:#f4f4f4;padding:12px;border-radius:6px;overflow-x:auto}' +
      'code{background:#f0f0f0;padding:1px 4px;border-radius:3px}' +
      'table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:6px 10px}' +
      '@media print{body{margin:20px}}</style>' +
      '</head><body><h1>' + _esc(title) + '</h1>' + html + '</body></html>');
    win.document.close();
    win.focus();
    setTimeout(function () { win.print(); }, 600);
  }

  // ── Auto-save ─────────────────────────────────────────────────────────────
  function _scheduleSave() {
    _dirty = true;
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(function () { _save(true); }, 3000);
    _setStatus('Unsaved', '');
  }

  // ── Event binding ─────────────────────────────────────────────────────────
  function _bindEvents(panel) {
    // Close
    panel.addEventListener('click', function (e) {
      if (e.target.id === 'npClose') _closePanel();
    });

    // Tabs
    panel.querySelectorAll('.np-tab').forEach(function (btn) {
      btn.addEventListener('click', function () { _switchTab(btn.dataset.tab); });
    });

    // Scope options
    panel.querySelectorAll('[data-scope]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        _scope = btn.dataset.scope;
        panel.querySelectorAll('[data-scope]').forEach(function (b) {
          b.classList.toggle('active', b.dataset.scope === _scope);
        });
      });
    });

    // Language options
    panel.querySelectorAll('[data-lang]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        _language = btn.dataset.lang;
        panel.querySelectorAll('[data-lang]').forEach(function (b) {
          b.classList.toggle('active', b.dataset.lang === _language);
        });
      });
    });

    // View tabs (Preview / Edit)
    panel.addEventListener('click', function (e) {
      var btn = e.target.closest('.np-view-tab');
      if (!btn) return;
      var view = btn.dataset.view;
      panel.querySelectorAll('.np-view-tab').forEach(function (b) {
        b.classList.toggle('active', b.dataset.view === view);
      });
      var preview = $id('npPreview');
      var editor  = $id('npEditor');
      if (view === 'edit') {
        if (preview) preview.style.display = 'none';
        if (editor)  editor.style.display = '';
      } else {
        if (editor && _currentNote) {
          _currentNote.content_markdown = editor.value;
          var titleEl = $id('npTitle');
          if (titleEl) _currentNote.title = titleEl.value;
        }
        if (preview) {
          preview.innerHTML = _md2html(_currentNote ? _currentNote.content_markdown : '');
          preview.style.display = '';
        }
        if (editor) editor.style.display = 'none';
      }
    });

    // Generate / Regen / Save / Export
    var genBtn    = $id('npGenerate');
    var regenBtn  = $id('npRegen');
    var saveBtn   = $id('npSave');
    var exportBtn = $id('npExport');
    if (genBtn)    genBtn.addEventListener('click', _generate);
    if (regenBtn)  regenBtn.addEventListener('click', _generate);
    if (saveBtn)   saveBtn.addEventListener('click', function () { _save(false); });
    if (exportBtn) exportBtn.addEventListener('click', _exportPdf);

    // Editor auto-save
    var editor     = $id('npEditor');
    var titleInput = $id('npTitle');
    if (editor)     editor.addEventListener('input', _scheduleSave);
    if (titleInput) titleInput.addEventListener('input', _scheduleSave);

    // Ctrl+S
    document.addEventListener('keydown', function (e) {
      if (_panelOpen && (e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        _save(false);
      }
    });
  }

  // ── Toolbar button ────────────────────────────────────────────────────────
  function _injectToolbarButton() {
    if ($id('pdfNotesToggle')) return;
    var toolbar = $id('pdfToolbar');
    if (!toolbar) return;
    var spacer = toolbar.querySelector('span[style*="flex: 1"], span[style*="flex:1"]');
    var btn = document.createElement('button');
    btn.id = 'pdfNotesToggle';
    btn.className = 'pdf-tb-btn pdf-notes-toggle-btn';
    btn.title = 'Toggle AI Notes panel';
    btn.innerHTML = '&#x1F4DD; Notes';
    btn.addEventListener('click', function () {
      if (_panelOpen) { _closePanel(); btn.classList.remove('active'); }
      else            { _openPanel();  btn.classList.add('active'); }
    });
    if (spacer) toolbar.insertBefore(btn, spacer);
    else        toolbar.appendChild(btn);
  }

  // ── File open hook ────────────────────────────────────────────────────────
  function _onFileOpen(fileName, course) {
    _notesByType = { notes: null, summary: null };
    _currentNote = null;
    _dirty = false;
    _generating = false;

    _ctx.courseId   = (course && course.id) || window.activeCourseId || null;
    _ctx.fileName   = fileName || null;
    _ctx.documentId = null;

    _resolveDocumentId(fileName, _ctx.courseId);
    _createPanel();
    _injectToolbarButton();

    if (_panelOpen) {
      _renderCurrentTab();
      _loadNotes();
    }
  }

  async function _resolveDocumentId(fileName, courseId) {
    if (!fileName || !courseId) return;
    try {
      var r = await fetch(
        (window.BACKEND_URL || '') + '/api/documents/list?courseId=' + encodeURIComponent(courseId),
        { headers: { Authorization: 'Bearer ' + (window._sbToken || '') } }
      );
      var data = r.ok ? await r.json() : {};
      var docs = data.documents || [];
      var match = docs.find(function (d) {
        return (d.file_name || d.fileName || '').toLowerCase() === fileName.toLowerCase();
      });
      if (match) {
        _ctx.documentId = match.id;
        if (_panelOpen) _loadNotes();
      }
    } catch (e) {}
  }

  function _wrapOpenFile() {
    var orig = window.openFile;
    window.openFile = function (f, course) {
      if (typeof orig === 'function') orig(f, course);
      setTimeout(function () { _onFileOpen(f && f.name, course); }, 50);
    };

    // If router already opened a file before we loaded, pick up the active context now
    setTimeout(function () {
      var toolbar = document.getElementById('pdfToolbar');
      var hasFile = window.activeFileName || window.pdfDoc;
      if (toolbar && hasFile && !document.getElementById('pdfNotesToggle')) {
        _ctx.courseId   = window.activeCourseId || (window.activeCourseRef && window.activeCourseRef.id) || null;
        _ctx.fileName   = window.activeFileName || null;
        _createPanel();
        _injectToolbarButton();
        if (_ctx.courseId && _ctx.fileName) {
          _resolveDocumentId(_ctx.fileName, _ctx.courseId);
        }
      }
    }, 500);
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _wrapOpenFile);
  } else {
    setTimeout(_wrapOpenFile, 0);
  }

  window._notesPanel = {
    open:  _openPanel,
    close: _closePanel,
    ctx:   function () { return _ctx; }
  };
})();
