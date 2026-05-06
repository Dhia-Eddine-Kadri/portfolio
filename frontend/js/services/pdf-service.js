export function fetchPdfBytes(path, cb, onError) {
  fetch(path)
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.arrayBuffer();
    })
    .then(function (buf) {
      cb(new Uint8Array(buf));
    })
    .catch(function (e) {
      if (onError) onError(e);
    });
}

export async function downloadFile(fname) {
  var PDF_DATA = window.PDF_DATA || {};
  var pdfPath = PDF_DATA[fname];
  if (!pdfPath) {
    alert(window._t ? window._t('not_in_demo') : 'Not available in demo');
    return;
  }
  var r = await fetch(pdfPath);
  if (!r.ok) {
    alert(window._t ? window._t('download_failed') : 'Download failed');
    return;
  }
  var buf = await r.arrayBuffer();
  var blob = new Blob([buf], { type: 'application/pdf' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  setTimeout(function () {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1000);
}
