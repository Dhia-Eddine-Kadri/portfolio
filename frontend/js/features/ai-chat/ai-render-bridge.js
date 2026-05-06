import { renderMarkdown } from './ai-markdown.js';

export function initAiRenderBridge(options) {
  options = options || {};
  var katexRenderScheduled = false;

  function renderMathIn(el) {
    if (!el || !window.renderMathInElement) return;
    try {
      renderMathInElement(el, {
        delimiters: [
          { left: '\\[', right: '\\]', display: true },
          { left: '\\(', right: '\\)', display: false },
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false }
        ],
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
        throwOnError: false
      });
    } catch (e) {}
  }

  function renderAllMathBubbles() {
    document.querySelectorAll('.ai-bubble.bot, .aip-bubble.bot').forEach(renderMathIn);
  }

  function scheduleKatexRender() {
    if (katexRenderScheduled || (window.katex && window.renderMathInElement)) return;
    katexRenderScheduled = true;
    window
      ._ssEnsureKatex()
      .then(function () {
        katexRenderScheduled = false;
        renderAllMathBubbles();
      })
      .catch(function (err) {
        katexRenderScheduled = false;
        console.warn('KaTeX failed to load:', err);
      });
  }

  function renderMath(el) {
    if (!el) return;
    if (window.renderMathInElement) {
      renderMathIn(el);
      return;
    }
    window
      ._ssEnsureKatex()
      .then(function () {
        renderMathIn(el);
      })
      .catch(function (err) {
        console.warn('KaTeX failed to load:', err);
      });
  }

  window._ssScheduleKatexRender = scheduleKatexRender;
  window.renderMarkdown = renderMarkdown;
  window._renderMath = renderMath;

  if (typeof options.getWelcomeText === 'function') {
    setTimeout(function () {
      if (typeof window.addBotMsg === 'function') {
        window.addBotMsg(options.getWelcomeText());
      }
    }, 0);
  }

  return {
    renderMarkdown: renderMarkdown,
    renderMath: renderMath,
    scheduleKatexRender: scheduleKatexRender
  };
}
