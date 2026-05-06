// RAG document upload panel
// Injects an "AI Knowledge Base" section into the course view, letting students
// upload PDFs that get indexed for RAG-powered answers.

import { uploadCourseDocument, listCourseDocuments, deleteRagDocument } from '../../services/ai-service.js';

var STATUS_LABELS = {
  uploaded: 'Uploaded',
  extracting_text: 'Extracting text…',
  chunking: 'Chunking…',
  embedding: 'Indexing…',
  ready: 'Ready',
  failed: 'Failed'
};

var SOURCE_OPTIONS = [
  { value: 'lecture', label: 'Lecture' },
  { value: 'exercise', label: 'Exercise' },
  { value: 'solution', label: 'Solution' },
  { value: 'notes', label: 'Notes' },
  { value: 'exam', label: 'Exam' }
];

export function initRagUploadPanel() {
  // Expose so app.js can call it when opening a course
  window._ragRefreshPanel = refreshPanel;
  window._ragInitPanel = injectPanel;
}

function injectPanel(courseId) {
  if (!courseId) return;
  var container = document.getElementById('ragUploadPanel');
  if (!container) return;
  container.dataset.courseId = courseId;
  refreshPanel(courseId);
}

async function refreshPanel(courseId) {
  var container = document.getElementById('ragUploadPanel');
  if (!container) return;
  if (!courseId) courseId = container.dataset.courseId;
  if (!courseId) return;

  var docs = [];
  try { docs = await listCourseDocuments(courseId); } catch (e) {}

  container.innerHTML = _renderPanel(courseId, docs);
  _bindPanel(container, courseId);

  // Poll for in-progress docs every 4s
  var pending = docs.filter(function (d) {
    return d.processing_status !== 'ready' && d.processing_status !== 'failed';
  });
  if (pending.length) {
    setTimeout(function () { refreshPanel(courseId); }, 4000);
  }
}

function _renderPanel(courseId, docs) {
  var sourceOpts = SOURCE_OPTIONS.map(function (o) {
    return '<option value="' + o.value + '">' + o.label + '</option>';
  }).join('');

  var docRows = docs.length
    ? docs.map(function (d) {
        var status = STATUS_LABELS[d.processing_status] || d.processing_status;
        var isReady = d.processing_status === 'ready';
        var isFailed = d.processing_status === 'failed';
        var dot = isReady ? 'rag-dot-ready' : isFailed ? 'rag-dot-failed' : 'rag-dot-pending';
        return (
          '<div class="rag-doc-row" data-doc-id="' + _esc(d.id) + '">' +
          '<span class="rag-dot ' + dot + '"></span>' +
          '<span class="rag-doc-name">' + _esc(d.file_name) + '</span>' +
          '<span class="rag-doc-type">' + _esc(d.source_type) + '</span>' +
          '<span class="rag-doc-status">' + status + '</span>' +
          '<button class="rag-doc-delete" title="Delete document" data-doc-id="' + _esc(d.id) + '">✕</button>' +
          '</div>'
        );
      }).join('')
    : '<div class="rag-empty">No documents indexed yet. Upload a PDF to get started.</div>';

  return (
    '<div class="rag-panel-inner">' +
    '<div class="rag-header">' +
    '<span class="rag-icon">🧠</span>' +
    '<span class="rag-title">AI Knowledge Base</span>' +
    '<span class="rag-subtitle">Upload lecture files so the AI can answer from your course material</span>' +
    '</div>' +
    '<div class="rag-upload-row">' +
    '<select class="rag-source-select" id="ragSourceType">' + sourceOpts + '</select>' +
    '<label class="rag-upload-btn" for="ragFileInput">+ Add PDF</label>' +
    '<input type="file" id="ragFileInput" accept=".pdf,application/pdf" style="display:none" multiple>' +
    '</div>' +
    '<div id="ragUploadProgress" style="display:none" class="rag-progress">' +
    '<span id="ragProgressText">Uploading…</span>' +
    '</div>' +
    '<div class="rag-doc-list">' + docRows + '</div>' +
    '</div>'
  );
}

function _bindPanel(container, courseId) {
  var fileInput = container.querySelector('#ragFileInput');
  var progressEl = container.querySelector('#ragUploadProgress');
  var progressText = container.querySelector('#ragProgressText');

  if (!fileInput) return;

  // Delete buttons
  container.querySelectorAll('.rag-doc-delete').forEach(function (btn) {
    btn.addEventListener('click', async function (e) {
      e.stopPropagation();
      var docId = btn.dataset.docId;
      if (!docId) return;
      btn.disabled = true;
      btn.textContent = '…';
      try {
        await deleteRagDocument(docId);
        refreshPanel(courseId);
      } catch (err) {
        btn.disabled = false;
        btn.textContent = '✕';
      }
    });
  });

  fileInput.addEventListener('change', async function () {
    var files = Array.from(fileInput.files || []);
    if (!files.length) return;
    var sourceType = (container.querySelector('#ragSourceType') || {}).value || 'lecture';

    progressEl.style.display = 'block';
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      progressText.textContent = 'Uploading ' + file.name + '… (' + (i + 1) + '/' + files.length + ')';
      try {
        await uploadCourseDocument(file, courseId, sourceType);
      } catch (e) {
        progressText.textContent = '❌ Failed: ' + e.message;
        await _wait(2000);
      }
    }
    progressEl.style.display = 'none';
    fileInput.value = '';
    refreshPanel(courseId);
  });
}

function _wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function _esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
