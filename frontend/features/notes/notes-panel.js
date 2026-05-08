// AI Notes Panel — splits the PDF viewer into a two-column workspace.
// Loaded after app.js; wires itself into openFile() via a wrapper.
(function () {
  'use strict';

  // ── State ─────────────────────────────────────────────────────────────────
  var _panelOpen    = false;
  var _activeTab    = 'notes';   // 'notes' | 'summary'
  var _dirty        = false;
  var _currentNote  = null;      // { id, title, type, content_markdown }
  var _notesByType  = { notes: null, summary: null };
  var _generating   = false;
  var _saveTimer    = null;

  // Context set when openFile fires
  var _ctx = { courseId: null, documentId: null, fileName: null, courseRef: null };

  // ── DOM helpers ───────────────────────────────────────────────────────────
  function $id(id) { return document.getElementById(id); }

  function _supaHeaders() {
    return {
      'Content-Type': 'application/json',
      'apikey': window._SAKEY || '',
      'Authorization': 'Bearer ' + (window._sbToken || '')
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

  // Converts Markdown to HTML with KaTeX math rendering.
  function _md2html(md) {
    if (!md) return '';
    // Math first (before any escaping touches $ signs)
    var lines = md.split('\n');
    var out = [];
    var i = 0;
    var inCode = false;

    while (i < lines.length) {
      var line = lines[i];

      // Fenced code blocks
      if (line.startsWith('```')) {
        if (!inCode) {
          inCode = true;
          out.push('<pre><code>');
        } else {
          inCode = false;
          out.push('</code></pre>');
        }
        i++;
        continue;
      }
      if (inCode) { out.push(_esc(line) + '\n'); i++; continue; }

      // Headings
      var hm = line.match(/^(#{1,4})\s+(.*)/);
      if (hm) {
        var level = hm[1].length;
        out.push('<h' + level + '>' + _inlineMd(hm[2]) + '</h' + level + '>');
        i++; continue;
      }

      // Horizontal rule
      if (/^---+$/.test(line.trim())) { out.push('<hr>'); i++; continue; }

      // Blank line
      if (!line.trim()) { out.push('<br>'); i++; continue; }

      // Unordered list items
      if (/^[-*]\s/.test(line)) {
        out.push('<ul>');
        while (i < lines.length && /^[-*]\s/.test(lines[i])) {
          out.push('<li>' + _inlineMd(lines[i].replace(/^[-*]\s+/, '')) + '</li>');
          i++;
        }
        out.push('</ul>');
        continue;
      }

      // Numbered list items
      if (/^\d+\.\s/.test(line)) {
        out.push('<ol>');
        while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
          out.push('<li>' + _inlineMd(lines[i].replace(/^\d+\.\s+/, '')) + '</li>');
          i++;
        }
        out.push('</ol>');
        continue;
      }

      // Table (simple)
      if (line.includes('|') && lines[i + 1] && /^\|?[-: |]+\|?$/.test(lines[i + 1])) {
        out.push('<table><thead><tr>');
        line.split('|').filter(function (c) { return c.trim(); }).forEach(function (c) {
          out.push('<th>' + _inlineMd(c.trim()) + '</th>');
        });
        out.push('</tr></thead><tbody>');
        i += 2; // skip separator row
        while (i < lines.length && lines[i].includes('|')) {
          out.push('<tr>');
          lines[i].split('|').filter(function (c) { return c.trim(); }).forEach(function (c) {
            out.push('<td>' + _inlineMd(c.trim()) + '</td>');
          });
          out.push('</tr>');
          i++;
        }
        out.push('</tbody></table>');
        continue;
      }

      // Paragraph
      out.push('<p>' + _inlineMd(line) + '</p>');
      i++;
    }
    return out.join('\n');
  }

  function _inlineMd(s) {
    // Apply KaTeX before HTML escaping to preserve $ signs
    var result = _renderMath(s);
    // Bold/italic/code/links applied to non-math parts — do a naive pass
    result = result
      .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__(.+?)__/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/_(.+?)_/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
    return result;
  }

  // ── Panel HTML ────────────────────────────────────────────────────────────
  function _panelHTML() {
    return [
      '<div class="np-header">',
        '<div class="np-tabs">',
          '<button class="np-tab active" data-tab="notes">Notes</button>',
          '<button class="np-tab" data-tab="summary">Summary</button>',
        '</div>',
        '<button class="np-close" id="npClose" title="Close notes panel">&#x2715;</button>',
      '</div>',

      '<div class="np-toolbar" id="npToolbar">',
        '<button class="np-btn np-btn-primary" id="npGenerate">&#x2728; Generate</button>',
        '<button class="np-btn" id="npRegen" title="Regenerate" style="display:none">&#x21BB;</button>',
        '<div class="np-sep"></div>',
        '<button class="np-btn" id="npSave" title="Save">&#x1F4BE; Save</button>',
        '<div class="np-sep"></div>',
        '<button class="np-btn" id="npExport" title="Export as PDF">&#x1F4E4; Export</button>',
        '<div class="np-sep np-spacer"></div>',
        '<span class="np-status" id="npStatus"></span>',
      '</div>',

      '<div class="np-body" id="npBody">',
        '<div class="np-empty" id="npEmpty">',
          '<div class="np-empty-icon">&#x1F4DD;</div>',
          '<div class="np-empty-title">No notes yet</div>',
          '<div class="np-empty-sub">Click <strong>Generate</strong> to create AI notes from this PDF.</div>',
        '</div>',

        '<div class="np-editor-wrap" id="npEditorWrap" style="display:none">',
          '<div class="np-title-row">',
            '<input class="np-title-input" id="npTitle" type="text" placeholder="Note title…">',
          '</div>',
          // Two views: rendered (read mode) and raw textarea (edit mode)
          '<div class="np-view-toggle">',
            '<button class="np-vt active" data-view="preview">Preview</button>',
            '<button class="np-vt" data-view="edit">Edit Markdown</button>',
          '</div>',
          '<div class="np-preview" id="npPreview"></div>',
          '<textarea class="np-editor" id="npEditor" style="display:none" spellcheck="false" placeholder="Write Markdown here…"></textarea>',
        '</div>',
      '</div>',

      '<div class="np-generating-overlay" id="npGenOverlay" style="display:none">',
        '<div class="np-gen-inner">',
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

  // ── Toggle panel open/close ───────────────────────────────────────────────
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
    var preview = $id('npPreview');
    var editor  = $id('npEditor');
    var title   = $id('npTitle');

    if (!empty) return;

    if (!_currentNote) {
      empty.style.display = 'flex';
      if (wrap) wrap.style.display = 'none';
      if (regen) regen.style.display = 'none';
      return;
    }

    empty.style.display = 'none';
    if (wrap) wrap.style.display = 'flex';
    if (regen) regen.style.display = '';

    if (title) title.value = _currentNote.title || '';
    if (editor) editor.value = _currentNote.content_markdown || '';
    if (preview) preview.innerHTML = _md2html(_currentNote.content_markdown || '');
    _setStatus('');
  }

  // ── Status line ───────────────────────────────────────────────────────────
  function _setStatus(msg, cls) {
    var el = $id('npStatus');
    if (!el) return;
    el.textContent = msg;
    el.className = 'np-status' + (cls ? ' ' + cls : '');
  }

  // ── Load existing notes for current document ──────────────────────────────
  async function _loadNotes() {
    if (!_ctx.documentId || !_ctx.courseId) return;
    var token = window._sbToken || '';
    try {
      var r = await fetch(
        (window.BACKEND_URL || '') + '/api/notes?courseId=' + encodeURIComponent(_ctx.courseId) +
        '&documentId=' + encodeURIComponent(_ctx.documentId),
        { headers: _supaHeaders() }
      );
      var data = r.ok ? await r.json() : {};
      (data.notes || []).forEach(function (n) {
        if (n.type === 'notes' || n.type === 'summary') {
          if (!_notesByType[n.type]) {
            // Store minimal header — full content loaded on demand
            _notesByType[n.type] = { id: n.id, title: n.title, type: n.type, content_markdown: '' };
          }
        }
      });
      // If we have a notes entry, load the full content
      for (var type of ['notes', 'summary']) {
        if (_notesByType[type] && _notesByType[type].id && !_notesByType[type].content_markdown) {
          await _loadNoteContent(_notesByType[type]);
        }
      }
    } catch (e) {
      console.warn('[notes-panel] load error:', e);
    }
    _currentNote = _notesByType[_activeTab];
    if (_panelOpen) _renderCurrentTab();
  }

  async function _loadNoteContent(note) {
    try {
      var r = await fetch(
        (window.BACKEND_URL || '') + '/api/notes?id=' + encodeURIComponent(note.id),
        { headers: _supaHeaders() }
      );
      var data = r.ok ? await r.json() : {};
      if (data.note) {
        note.title = data.note.title;
        note.content_markdown = data.note.content_markdown || '';
      }
    } catch (e) {}
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
    if (genMsg)  genMsg.textContent = 'Generating ' + (_activeTab === 'summary' ? 'summary' : 'notes') + '…';

    try {
      var payload = {
        courseId:    _ctx.courseId,
        documentId:  _ctx.documentId || null,
        tool:        _activeTab,
        fileName:    _ctx.fileName || null,
        pdfText:     window.pdfFullText || ''
      };

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
    var editor = $id('npEditor');
    var titleEl = $id('npTitle');
    var md = editor ? editor.value : _currentNote.content_markdown;
    var title = titleEl ? titleEl.value : _currentNote.title;

    if (md === _currentNote.content_markdown && title === _currentNote.title) {
      if (!quiet) _setStatus('No changes', '');
      return;
    }

    _setStatus('Saving…', '');
    try {
      var resp = await fetch(
        (window.BACKEND_URL || '') + '/api/notes?id=' + encodeURIComponent(_currentNote.id),
        {
          method: 'PATCH',
          headers: _supaHeaders(),
          body: JSON.stringify({ title: title, content_markdown: md })
        }
      );
      if (resp.ok) {
        _currentNote.content_markdown = md;
        _currentNote.title = title;
        _notesByType[_activeTab] = _currentNote;
        _dirty = false;
        _setStatus('Saved ✓', 'ok');
        // Refresh preview
        var preview = $id('npPreview');
        if (preview) preview.innerHTML = _md2html(md);
      } else {
        _setStatus('Save failed', 'err');
      }
    } catch (e) {
      _setStatus('Save failed', 'err');
    }
  }

  // ── Export as PDF ─────────────────────────────────────────────────────────
  function _exportPdf() {
    if (!_currentNote || !_currentNote.content_markdown) {
      if (typeof showToast === 'function') showToast('Nothing to export', 'Generate notes first.');
      return;
    }
    var preview = $id('npPreview');
    var html = preview ? preview.innerHTML : _md2html(_currentNote.content_markdown);
    var title = _currentNote.title || 'Notes';

    var win = window.open('', '_blank', 'width=900,height=700');
    if (!win) return;

    win.document.write('<!DOCTYPE html><html><head>' +
      '<meta charset="utf-8"><title>' + _esc(title) + '</title>' +
      '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.10/dist/katex.min.css">' +
      '<style>body{font-family:Georgia,serif;max-width:800px;margin:40px auto;color:#111;line-height:1.7;padding:0 20px}' +
      'h1{font-size:1.8rem;border-bottom:2px solid #333;padding-bottom:8px}' +
      'h2{font-size:1.3rem;margin-top:1.6em;color:#222}' +
      'h3{font-size:1.1rem;color:#333}' +
      'pre{background:#f4f4f4;padding:12px;border-radius:6px;overflow-x:auto}' +
      'code{background:#f0f0f0;padding:1px 4px;border-radius:3px}' +
      'table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:6px 10px}' +
      '@media print{body{margin:20px}}</style>' +
      '</head><body><h1>' + _esc(title) + '</h1>' + html + '</body></html>');
    win.document.close();
    win.focus();
    setTimeout(function () { win.print(); }, 600);
  }

  // ── Auto-save on edit ─────────────────────────────────────────────────────
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

    // View toggle (preview / edit markdown)
    panel.addEventListener('click', function (e) {
      var btn = e.target.closest('.np-vt');
      if (!btn) return;
      var view = btn.dataset.view;
      panel.querySelectorAll('.np-vt').forEach(function (b) { b.classList.toggle('active', b.dataset.view === view); });
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

    // Generate
    var genBtn = $id('npGenerate');
    if (genBtn) genBtn.addEventListener('click', _generate);
    var regenBtn = $id('npRegen');
    if (regenBtn) regenBtn.addEventListener('click', _generate);

    // Save
    var saveBtn = $id('npSave');
    if (saveBtn) saveBtn.addEventListener('click', function () { _save(false); });

    // Export
    var exportBtn = $id('npExport');
    if (exportBtn) exportBtn.addEventListener('click', _exportPdf);

    // Editor changes → auto-save
    var editor = $id('npEditor');
    if (editor) editor.addEventListener('input', _scheduleSave);
    var titleInput = $id('npTitle');
    if (titleInput) titleInput.addEventListener('input', _scheduleSave);

    // Keyboard shortcut: Ctrl+S to save
    document.addEventListener('keydown', function (e) {
      if (_panelOpen && (e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        _save(false);
      }
    });
  }

  // ── Notes toggle button in PDF toolbar ───────────────────────────────────
  function _injectToolbarButton() {
    if ($id('pdfNotesToggle')) return;
    var toolbar = $id('pdfToolbar');
    if (!toolbar) return;

    // Insert before the spacer (flex:1 span)
    var spacer = toolbar.querySelector('span[style*="flex: 1"], span[style*="flex:1"]');
    var btn = document.createElement('button');
    btn.id = 'pdfNotesToggle';
    btn.className = 'pdf-tb-btn pdf-notes-toggle-btn';
    btn.title = 'Toggle AI Notes panel';
    btn.innerHTML = '&#x1F4DD; Notes';
    btn.addEventListener('click', function () {
      if (_panelOpen) {
        _closePanel();
        btn.classList.remove('active');
      } else {
        _openPanel();
        btn.classList.add('active');
      }
    });
    if (spacer) {
      toolbar.insertBefore(btn, spacer);
    } else {
      toolbar.appendChild(btn);
    }
  }

  // ── Hook into openFile ────────────────────────────────────────────────────
  function _onFileOpen(fileName, course) {
    // Reset state for new file
    _notesByType = { notes: null, summary: null };
    _currentNote = null;
    _dirty = false;
    _generating = false;

    // Resolve documentId from the active course's document list
    _ctx.courseId   = (course && course.id) || window.activeCourseId || null;
    _ctx.fileName   = fileName || null;
    _ctx.courseRef  = course || window.activeCourseRef || null;
    _ctx.documentId = null;

    // Try to find the documentId from indexed docs
    _resolveDocumentId(fileName, _ctx.courseId);

    // Create panel if not yet done
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

  // ── Wrap openFile ─────────────────────────────────────────────────────────
  function _wrapOpenFile() {
    var origOpenFile = window.openFile;
    window.openFile = function (f, course) {
      if (typeof origOpenFile === 'function') origOpenFile(f, course);
      // Delay slightly so pdf-viewer.js sets activeFileName first
      setTimeout(function () {
        _onFileOpen(f && f.name, course);
      }, 50);
    };
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  // Wait for app.js to finish wiring openFile before wrapping it
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _wrapOpenFile);
  } else {
    // app.js may still be initialising; defer by a tick
    setTimeout(_wrapOpenFile, 0);
  }

  // Expose for debugging
  window._notesPanel = {
    open:  _openPanel,
    close: _closePanel,
    ctx:   function () { return _ctx; }
  };
})();
