// Extracts plain text from a loaded pdf.js document.
// Returns a Promise<string> with all page text joined.

export async function extractPdfText(pdfDoc, maxPages) {
  if (!pdfDoc) return '';
  var limit = Math.min(pdfDoc.numPages, maxPages || pdfDoc.numPages);
  var pageTexts = [];
  for (var i = 1; i <= limit; i++) {
    try {
      var page = await pdfDoc.getPage(i);
      var tc = await page.getTextContent();
      pageTexts.push(
        tc.items
          .map(function (it) {
            return it.str;
          })
          .join(' ')
      );
    } catch (e) {
      /* skip unreadable page */
    }
  }
  return pageTexts.join('\n');
}

// Extracts text from up to maxPages pages of each named PDF in fnames.
// Returns an array of strings, one per file.
export async function extractMultiplePdfs(fnames, maxPages) {
  maxPages = maxPages || 20;
  var PDF_DATA = window.PDF_DATA || {};

  return Promise.all(
    fnames.map(function (fname) {
      return new Promise(function (resolve) {
        var pdfPath = PDF_DATA[fname];
        if (!pdfPath) {
          resolve('[' + fname + ': not available in demo]');
          return;
        }
        if (!window._fetchPdfBytes) {
          resolve('[' + fname + ': pdf loader unavailable]');
          return;
        }
        window._fetchPdfBytes(
          pdfPath,
          function (bytes) {
            window
              ._ssEnsurePdfJs()
              .then(function () {
                return window.pdfjsLib
                  .getDocument({ data: bytes })
                  .promise.then(function (pdf) {
                    return extractPdfText(pdf, maxPages);
                  })
                  .then(function (text) {
                    resolve('=== ' + fname + ' ===\n' + text);
                  });
              })
              .catch(function () {
                resolve('[' + fname + ': could not load PDF.js]');
              });
          },
          function () {
            resolve('[' + fname + ': error loading]');
          }
        );
      });
    })
  );
}
