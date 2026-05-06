export function initPdfControls(options) {
  options = options || {};

  function updateZoomPct() {
    var el = document.getElementById('pdfZoomPct');
    if (el) el.textContent = Math.round(options.getPdfScale() * 100) + '%';
  }

  function pdfVisiblePage() {
    if (!options.getPdfShowAll()) return options.getPdfPage();
    var body = document.getElementById('pdfBody');
    if (!body) return options.getPdfPage();
    var scrollTop = body.scrollTop;
    var wraps = body.querySelectorAll('.pdf-page-wrap');
    var best = options.getPdfPage();
    var bestDist = Infinity;
    wraps.forEach(function (w) {
      var dist = Math.abs(w.offsetTop - scrollTop);
      if (dist < bestDist) {
        bestDist = dist;
        best = parseInt(w.dataset.pageNum) || options.getPdfPage();
      }
    });
    return best;
  }

  function pdfScrollToPage(num) {
    var body = document.getElementById('pdfBody');
    if (!body) return;
    var wrap = body.querySelector('[data-page-num="' + num + '"]');
    if (wrap) body.scrollTop = wrap.offsetTop;
  }

  (document.getElementById('pdfBody') || { addEventListener: function () {} }).addEventListener(
    'mouseup',
    function () {
      setTimeout(function () {
        var sel = window.getSelection();
        if (sel && sel.toString().trim().length > 3) options.showSelectionBanner(sel.toString().trim());
      }, 30);
    }
  );

  var pdfScrollTimer = null;
  (document.getElementById('pdfBody') || document.createElement('div')).addEventListener(
    'scroll',
    function () {
      if (!options.getPdfShowAll()) return;
      clearTimeout(pdfScrollTimer);
      pdfScrollTimer = setTimeout(options.updatePageInfo, 80);
    }
  );

  (document.getElementById('pdfPrev') || { addEventListener: function () {} }).addEventListener(
    'click',
    function () {
      if (options.getPdfPage() > 1) {
        options.setPdfPage(options.getPdfPage() - 1);
        options.setPdfShowAll(false);
        options.updatePageInfo();
        options.renderPages();
      }
    }
  );

  (document.getElementById('pdfNext') || { addEventListener: function () {} }).addEventListener(
    'click',
    function () {
      if (options.getPdfPage() < options.getPdfTotal()) {
        options.setPdfPage(options.getPdfPage() + 1);
        options.setPdfShowAll(false);
        options.updatePageInfo();
        options.renderPages();
      }
    }
  );

  (function () {
    var inp = document.getElementById('pdfPageInput');
    if (!inp) return;
    inp.addEventListener('focus', function () {
      this.select();
    });
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        this.blur();
        return;
      }
      if (e.key === 'Escape') {
        this.value = options.getPdfShowAll() ? pdfVisiblePage() : options.getPdfPage();
        this.blur();
      }
    });
    inp.addEventListener('blur', function () {
      var n = parseInt(this.value, 10);
      if (n >= 1 && n <= options.getPdfTotal() && options.getPdfTotal() > 0) {
        options.setPdfPage(n);
        options.setPdfShowAll(false);
        options.updatePageInfo();
        options.renderPages();
      } else {
        this.value = options.getPdfShowAll() ? pdfVisiblePage() : options.getPdfPage();
      }
    });
  })();

  (document.getElementById('pdfZoomIn') || { addEventListener: function () {} }).addEventListener(
    'click',
    function () {
      var pg = pdfVisiblePage();
      options.setPdfScale(Math.min(Math.round((options.getPdfScale() + 0.1) * 10) / 10, 3));
      updateZoomPct();
      options.renderPages();
      setTimeout(function () {
        pdfScrollToPage(pg);
      }, 120);
    }
  );

  (document.getElementById('pdfZoomOut') || { addEventListener: function () {} }).addEventListener(
    'click',
    function () {
      var pg = pdfVisiblePage();
      options.setPdfScale(Math.max(Math.round((options.getPdfScale() - 0.1) * 10) / 10, 0.2));
      updateZoomPct();
      options.renderPages();
      setTimeout(function () {
        pdfScrollToPage(pg);
      }, 120);
    }
  );

  (document.getElementById('pdfFit') || { addEventListener: function () {} }).addEventListener(
    'click',
    function () {
      var pg = pdfVisiblePage();
      options.setPdfScale(0.9);
      updateZoomPct();
      options.renderPages();
      setTimeout(function () {
        pdfScrollToPage(pg);
      }, 120);
    }
  );

  (document.getElementById('pdfDownload') || { addEventListener: function () {} }).addEventListener(
    'click',
    function () {
      var fileName = options.getActiveFileName();
      if (fileName) options.downloadFile(fileName);
    }
  );

  (document.getElementById('pdfAll') || { addEventListener: function () {} }).addEventListener(
    'click',
    function () {
      options.setPdfShowAll(!options.getPdfShowAll());
      document.getElementById('pdfAll').textContent = options.getPdfShowAll()
        ? 'Single page'
        : 'All pages';
      options.renderPages();
    }
  );

  window.updateZoomPct = updateZoomPct;
  window._pdfVisiblePage = pdfVisiblePage;
  window._pdfScrollToPage = pdfScrollToPage;

  return {
    updateZoomPct: updateZoomPct,
    pdfVisiblePage: pdfVisiblePage,
    pdfScrollToPage: pdfScrollToPage
  };
}
