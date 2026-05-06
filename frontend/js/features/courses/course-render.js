import { escapeHtml } from '../../utils/escape-html.js';

export function fileRowHtml(f, inFolder) {
  var icon = f._uploaded
    ? '📎'
    : f.name.includes('Lösung')
      ? '✅'
      : f.name.includes('Aufgabe')
        ? '📋'
        : '📊';
  var eName = escapeHtml(f.name);
  var eSname = f._storageName ? escapeHtml(f._storageName) : '';
  var eFolder = inFolder ? escapeHtml(inFolder) : '';
  var fa = eFolder ? ' data-folder="' + eFolder + '"' : '';
  var sna = eSname ? ' data-sname="' + eSname + '"' : '';
  var delBtn = f._uploaded
    ? '<span class="co-del-btn" data-fname="' +
      eName +
      '"' +
      sna +
      fa +
      ' title="Delete" style="margin-left:6px;font-size:.69rem;font-weight:800;padding:3px 10px;border-radius:20px;background:rgba(239,68,68,.12);color:rgba(239,68,68,.85);border:1px solid rgba(239,68,68,.25);cursor:pointer;flex-shrink:0">🗑</span>'
    : '';
  var eSize = escapeHtml(f.size || '');
  var eDate = escapeHtml(f.date || '');
  var isPdf = f.name.toLowerCase().endsWith('.pdf');
  var ragBtn = isPdf && f._uploaded
    ? '<span class="co-rag-status" data-fname="' + eName + '" title="Preparing for AI…">⏳</span>'
    : '';

  return (
    '<div class="co-file' +
    (f._uploaded ? ' co-file-uploaded' : '') +
    '" data-fname="' +
    eName +
    '"' +
    fa +
    '>' +
    '<div class="co-file-cb" data-fname="' +
    eName +
    '"></div>' +
    '<span class="co-file-icon">' +
    icon +
    '</span>' +
    '<div style="flex:1;min-width:0"><div class="co-file-name">' +
    eName +
    '</div>' +
    '<div class="co-file-meta">' +
    eSize +
    ' · ' +
    eDate +
    '</div></div>' +
    ragBtn +
    '<span class="co-open-btn" style="font-size:.69rem;font-weight:800;padding:3px 10px;border-radius:20px;background:rgba(192,132,252,.18);color:rgba(192,132,252,.9);border:1px solid rgba(192,132,252,.3);cursor:pointer;flex-shrink:0">Open</span>' +
    (f._uploaded
      ? delBtn
      : '<span class="co-dl-btn" data-fname="' +
        eName +
        '" title="Download" style="margin-left:6px;font-size:.69rem;font-weight:800;padding:3px 10px;border-radius:20px;background:rgba(6,214,160,.15);color:rgba(6,214,160,.9);border:1px solid rgba(6,214,160,.3);cursor:pointer;flex-shrink:0">⬇</span>') +
    '</div>'
  );
}

export function buildFilesContent(course) {
  var foldersHtml = (course.userFolders || [])
    .map(function (fd) {
      var eFdName = escapeHtml(fd.name);
      var fileCount = fd.files.length;
      return (
        '<div class="co-folder-section collapsed" data-folder="' +
        eFdName +
        '">' +
        '<div class="co-folder-header">' +
        '<span class="co-folder-toggle-icon">▸</span>' +
        '<span style="font-size:1.1rem;flex-shrink:0">📁</span>' +
        '<span class="co-folder-name-label">' +
        eFdName +
        '</span>' +
        '<span class="co-folder-count-label">' +
        fileCount +
        ' file' +
        (fileCount !== 1 ? 's' : '') +
        '</span>' +
        '<button class="co-folder-select-all-btn" data-folder="' +
        eFdName +
        '" title="Select all files in folder" style="display:none">Select all</button>' +
        '<button class="co-folder-up-btn" data-folder="' +
        eFdName +
        '" title="Upload to folder">⬆ Upload</button>' +
        '<button class="co-folder-del-btn" data-folder="' +
        eFdName +
        '" title="Delete folder">🗑</button>' +
        '</div>' +
        '<div class="co-folder-files">' +
        (fileCount
          ? fd.files
              .slice()
              .sort(function (a, b) {
                return a.name.localeCompare(b.name);
              })
              .map(function (f) {
                return fileRowHtml(f, fd.name);
              })
              .join('')
          : '<div class="co-folder-empty">No files yet — click ⬆ Upload to add some</div>') +
        '</div>' +
        '</div>'
      );
    })
    .join('');

  var filesHtml = course.files.length
    ? course.files
        .slice()
        .sort(function (a, b) { return a.name.localeCompare(b.name); })
        .map(function (f) { return fileRowHtml(f, null); })
        .join('')
    : course._filesLoading
      ? ''
      : '<div class="co-files-loading" style="opacity:.5">No files yet — click Upload files to add some</div>';

  return (
    '<div class="co-files-toolbar">' +
    '<button class="co-select-toggle" id="coSelectToggle">☑ Select multiple</button>' +
    '<button class="co-new-folder-btn" id="coNewFolderBtn">📁 New folder</button>' +
    '<input type="file" id="coUploadInput" accept=".pdf,.txt,.docx,.png,.jpg,.jpeg" multiple style="display:none">' +
    '<input type="file" id="coFolderUploadInput" accept=".pdf,.txt,.docx,.png,.jpg,.jpeg" multiple style="display:none">' +
    '<button class="co-upload-btn" id="coUploadBtn">' +
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>' +
    ' Upload files' +
    '</button>' +
    '</div>' +
    foldersHtml +
    '<div id="coFilesList">' +
    filesHtml +
    '</div>' +
    '<div class="co-multi-bar" id="coMultiBar">' +
    '<span class="co-multi-count"><b id="coSelCount">0</b> files selected</span>' +
    '<span class="co-multi-clear" id="coMultiClear">Clear</span>' +
    '<button class="co-multi-delete" id="coMultiDeleteBtn">🗑 Delete</button>' +
    '<button class="co-multi-move" id="coMultiMoveBtn">📁 Move</button>' +
    '<button class="co-multi-summarise" id="coMultiSumBtn">✨ AI Chat</button>' +
    '</div>'
  );
}
