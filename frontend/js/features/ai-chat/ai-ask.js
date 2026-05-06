import {
  sendAiRequest,
  sendRagRequest,
  courseHasRagDocs,
  submitRagFeedback
} from '../../services/ai-service.js';
import { extractPdfText } from '../pdf-viewer/pdf-text-extraction.js';
import { bindMessageActionButtons } from './ai-message-actions.js';

function _getTime() {
  var d = new Date();
  return (
    d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0')
  );
}

export async function pdfToImages(maxPages) {
  var pdfDoc = window.pdfDoc;
  if (!pdfDoc) return [];
  var pages = Math.min(pdfDoc.numPages, maxPages || 6);
  var imgs = [];
  for (var i = 1; i <= pages; i++) {
    try {
      var page = await pdfDoc.getPage(i);
      var vp = page.getViewport({ scale: 1.5 });
      var canvas = document.createElement('canvas');
      canvas.width = vp.width;
      canvas.height = vp.height;
      var ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      var dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      imgs.push(dataUrl.split(',')[1]);
    } catch (e) {
      /* skip failed page */
    }
  }
  return imgs;
}

export function addTyping() {
  var aiMsgs = document.getElementById('aiMsgs') || document.querySelector('.ai-msgs');
  if (!aiMsgs) return null;
  var wrap = document.createElement('div');
  wrap.className = 'ai-msg-wrap typing-wrap';
  wrap.innerHTML =
    '<div class="msg-sender bot-sender"><span class="msg-sender-dot"></span>StudySphere AI</div>' +
    '<div class="typing-bubble"><span></span><span></span><span></span></div>';
  aiMsgs.appendChild(wrap);
  aiMsgs.scrollTop = aiMsgs.scrollHeight;
  return wrap;
}

export function initAskAI(state) {
  // state: { generationStopped, currentGenId, activeTypeTimer, activeThinkTimer, aiPanel, aiMsgs, BACKEND_URL }
  // Returns the askAI function bound to app-level mutable state refs via callbacks

  return function askAI(question, skipUserBubble) {
    if (!question) return;
    state.generationStopped = false;
    state.currentGenId++;
    var myGenId = state.currentGenId;

    if (window.pinAI) window.pinAI();

    var _chatHistory = window.serializeChatDOM ? window.serializeChatDOM() : [];
    if (!skipUserBubble && window.addUserMsg) window.addUserMsg(question);

    var _aiSendBtn = document.getElementById('aiSend');
    var _stopBtn = document.getElementById('stopBtn');
    if (_aiSendBtn) _aiSendBtn.disabled = true;
    if (_stopBtn) _stopBtn.style.display = 'flex';

    var aiMsgs = document.getElementById('aiMsgs');
    var aiPanel = document.getElementById('aiPanel');

    var thinkWrap = document.createElement('div');
    thinkWrap.className = 'ai-msg-wrap';
    thinkWrap.innerHTML =
      '<div class="msg-sender bot-sender"><span class="msg-sender-dot"></span>StudySphere AI</div>' +
      '<div class="think-bubble">' +
      '<span class="think-label">Thinking…</span>' +
      '<span class="think-text" id="thinkText"></span>' +
      '</div>';
    aiMsgs.appendChild(thinkWrap);
    aiMsgs.scrollTop = aiMsgs.scrollHeight;

    var THOUGHTS = [
      'Reading the document context…',
      'Identifying key concepts…',
      'Checking formulas…',
      'Structuring a clear explanation…',
      'Almost ready…'
    ];
    var tIdx = 0;
    function cycleThought() {
      var el = document.getElementById('thinkText');
      if (!el) return;
      el.textContent = '';
      var txt = THOUGHTS[tIdx % THOUGHTS.length];
      tIdx++;
      var ci = 0;
      var ti = setInterval(function () {
        if (!document.getElementById('thinkText')) {
          clearInterval(ti);
          return;
        }
        document.getElementById('thinkText').textContent = txt.slice(0, ci + 1);
        ci++;
        if (ci >= txt.length) clearInterval(ti);
      }, 20);
    }
    cycleThought();
    state.activeThinkTimer = setInterval(cycleThought, 1100);

    var pdfDoc = window.pdfDoc;
    var pdfFullText = window.pdfFullText || '';
    var _lang = window._lang || localStorage.getItem('ss_lang') || 'en';
    var activeFileName = window.activeFileName || '';
    var currentCourseShort = window.currentCourseShort || '';
    var _MATH_PROMPT = window._MATH_PROMPT || '';
    var sysPrompt =
      (window._userType === 'learner'
        ? 'You are StudySphere, a German language tutor helping a student prepare for ' +
          (window._germanTest || 'a German exam') +
          (window._germanLevel ? ' at level ' + window._germanLevel : '') +
          '. Always reply in ' +
          (_lang === 'de' ? 'German' : 'English') +
          '. The student is reading "' +
          activeFileName +
          '". ALWAYS base your answers on the actual document content below. Be thorough but concise.'
        : 'You are StudySphere, a friendly tutor for TU Braunschweig engineering students. Always reply in ' +
          (_lang === 'de' ? 'German' : 'English') +
          '. The student is reading "' +
          activeFileName +
          '" from ' +
          currentCourseShort +
          '. ALWAYS base your answers on the actual document content provided below. Do not use general knowledge when the document covers the topic. Be thorough but concise.') +
      _MATH_PROMPT;

    // If a PDF is open but text extraction hasn't finished yet, do it now so the AI can read the file.
    var _textReady =
      pdfDoc && !pdfFullText.trim()
        ? extractPdfText(pdfDoc, 30).then(function (t) {
            if (t) {
              window.pdfFullText = t;
              pdfFullText = t;
            }
          })
        : Promise.resolve();

    _textReady
      .then(function () {
        var isHandwritten = pdfDoc && pdfFullText.trim().length < 100;
        return isHandwritten ? pdfToImages(6) : [];
      })
      .then(async function (pageImages) {
        var userContent;
        if (pageImages.length) {
          sysPrompt +=
            '\n\nThis document is handwritten or scanned. Pages are provided as images — read all handwritten text, equations, and diagrams carefully.';
          userContent = [{ type: 'text', text: question }].concat(
            pageImages.map(function (b64) {
              return { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + b64 } };
            })
          );
        } else {
          sysPrompt +=
            '\n\nDOCUMENT CONTENT:\n' + (pdfFullText || '(document text not yet extracted)');
          userContent = question;
        }

        // Use RAG if this course has indexed documents
        var _courseId = window.activeCourseId || window.currentCourseId || '';
        var _hasRag = _courseId ? await courseHasRagDocs(_courseId) : false;

        if (_hasRag) {
          return sendRagRequest(_courseId, question, 'strict').then(function (data) {
            var answer = data.answer || 'No answer found.';

            // Confidence badge
            var confEmoji =
              data.confidence === 'high' ? '🟢' : data.confidence === 'medium' ? '🟡' : '🔴';
            var confLabel = confEmoji + ' Confidence: ' + (data.confidence || 'unknown');

            // Only warn when the AI had zero course context and fell back to general knowledge
            if (data.unsupported && (!data.sources || !data.sources.length)) {
              answer =
                '⚠️ *No matching course materials found — answering from general knowledge.*\n\n' +
                answer;
            }

            // Sources block
            if (data.sources && data.sources.length) {
              answer +=
                '\n\n**Sources:**\n' +
                data.sources
                  .map(function (s) {
                    return (
                      '- ' +
                      s.file_name +
                      (s.pages ? ', p.' + s.pages : '') +
                      (s.quote ? ' — *"' + s.quote.slice(0, 80) + '…"*' : '')
                    );
                  })
                  .join('\n');
            }

            answer += '\n\n' + confLabel + (data.cached ? ' · ⚡ cached' : '');

            // Attach feedback metadata to window for the feedback buttons
            window._lastRagMeta = {
              courseId: _courseId,
              question: question,
              answerCacheId: data.id || null
            };

            return { content: [{ text: answer }], _ragData: data };
          });
        }

        var prior = _chatHistory.slice(-20);
        var firstUser = 0;
        while (firstUser < prior.length && prior[firstUser].role !== 'user') firstUser++;
        prior = prior.slice(firstUser);
        var messages = [];
        prior.forEach(function (m) {
          messages.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text || '' });
        });
        messages.push({ role: 'user', content: userContent });

        return sendAiRequest({ max_tokens: 1024, system: sysPrompt, messages: messages });
      })
      .then(function (data) {
        if (myGenId !== state.currentGenId) {
          thinkWrap.remove();
          return;
        }
        clearInterval(state.activeThinkTimer);
        state.activeThinkTimer = null;
        thinkWrap.style.transition = 'opacity .3s';
        thinkWrap.style.opacity = '0';
        setTimeout(function () {
          thinkWrap.remove();
        }, 320);

        var _ragMeta = data._ragData
          ? {
              courseId: window.activeCourseId || '',
              question: question,
              answerCacheId: data._ragData.id || null
            }
          : null;

        var rawText = data.error
          ? '❌ Error: ' + (data.error.message || JSON.stringify(data.error))
          : data.content
            ? data.content
                .map(function (b) {
                  return b.text || '';
                })
                .join('')
            : 'No response';

        var ansWrap = document.createElement('div');
        ansWrap.className = 'ai-msg-wrap';
        var t = _getTime();
        ansWrap.innerHTML =
          '<div class="msg-sender bot-sender"><span class="msg-sender-dot"></span>StudySphere AI</div>' +
          '<div class="msg-body">' +
          '<div class="ai-bubble bot" id="streamBubble" style="min-height:20px"></div>' +
          '<div class="msg-meta" id="streamMeta" style="display:none">' +
          '<span class="msg-time">' +
          t +
          '</span>' +
          '<button class="msg-action-btn" data-action="copy">' +
          (window._t ? window._t('copy_btn') : 'Copy') +
          '</button>' +
          '</div>' +
          '</div>';
        bindMessageActionButtons(ansWrap);
        aiMsgs.appendChild(ansWrap);
        aiMsgs.scrollTop = aiMsgs.scrollHeight;

        setTimeout(function () {
          var bubble = ansWrap.querySelector('.ai-bubble.bot');
          var meta = ansWrap.querySelector('.msg-meta');
          var tokens = rawText.match(/\S+\s*/g) || [];
          var idx = 0;
          var displayed = '';
          var WORDS_PER_FRAME = 3;

          function frame() {
            if (state.generationStopped || myGenId !== state.currentGenId) {
              bubble.innerHTML = window.renderMarkdown
                ? window.renderMarkdown(displayed)
                : displayed;
              meta.style.display = 'flex';
              var eb = ansWrap.querySelector('.ai-action-bar');
              if (!eb && displayed.trim() && window._aiResponseActions)
                ansWrap
                  .querySelector('.msg-body')
                  .appendChild(window._aiResponseActions(displayed, 'panel'));
              return;
            }
            if (idx >= tokens.length) {
              bubble.innerHTML = window.renderMarkdown ? window.renderMarkdown(rawText) : rawText;
              if (window._renderMath) window._renderMath(bubble);
              meta.style.display = 'flex';
              if (!ansWrap.querySelector('.ai-action-bar') && window._aiResponseActions)
                ansWrap
                  .querySelector('.msg-body')
                  .appendChild(window._aiResponseActions(rawText, 'panel'));
              // RAG feedback bar
              if (_ragMeta && !ansWrap.querySelector('.rag-feedback-bar')) {
                ansWrap.querySelector('.msg-body').appendChild(_buildRagFeedbackBar(_ragMeta));
              }
              var _sb1 = document.getElementById('aiSend');
              if (_sb1) _sb1.disabled = false;
              var _st1 = document.getElementById('stopBtn');
              if (_st1) _st1.style.display = 'none';
              if (window.spawnConfetti) window.spawnConfetti();
              state.activeTypeTimer = null;
              return;
            }
            var appEl = document.getElementById('app');
            var panelHidden =
              document.hidden ||
              (appEl && appEl.style.display === 'none') ||
              !aiPanel.classList.contains('visible');
            var batch = panelHidden ? tokens.length : WORDS_PER_FRAME;
            for (var w = 0; w < batch && idx < tokens.length; w++) displayed += tokens[idx++];
            bubble.innerHTML =
              (window.renderMarkdown ? window.renderMarkdown(displayed) : displayed) +
              (idx < tokens.length ? '<span class="stream-cursor">▋</span>' : '');
            if (!panelHidden && aiMsgs.scrollHeight - aiMsgs.scrollTop - aiMsgs.clientHeight < 80)
              aiMsgs.scrollTop = aiMsgs.scrollHeight;
            state.activeTypeTimer = setTimeout(frame, panelHidden ? 0 : 16);
          }

          state.activeTypeTimer = setTimeout(frame, 16);
        }, 60);
      })
      .catch(function (e) {
        clearInterval(state.activeThinkTimer);
        state.activeThinkTimer = null;
        thinkWrap.remove();
        if (window.addBotMsg) window.addBotMsg('❌ Error: ' + e.message);
        var _sb2 = document.getElementById('aiSend');
        if (_sb2) _sb2.disabled = false;
        var _st2 = document.getElementById('stopBtn');
        if (_st2) _st2.style.display = 'none';
      });
  };
}

function _buildRagFeedbackBar(meta) {
  var bar = document.createElement('div');
  bar.className = 'rag-feedback-bar';
  bar.innerHTML =
    '<span class="rag-fb-label">Was this helpful?</span>' +
    '<button class="rag-fb-btn rag-fb-yes" title="Helpful">👍</button>' +
    '<button class="rag-fb-btn rag-fb-no" title="Not helpful">👎</button>' +
    '<button class="rag-fb-btn rag-fb-wrong" title="Wrong answer">⚠️</button>' +
    '<button class="rag-fb-btn rag-fb-cite" title="Missing citation">📄</button>';

  function _send(rating) {
    bar.querySelectorAll('.rag-fb-btn').forEach(function (b) {
      b.disabled = true;
    });
    bar.querySelector('.rag-fb-label').textContent = 'Thanks for your feedback!';
    submitRagFeedback(meta.courseId, meta.question, rating, meta.answerCacheId).catch(
      function () {}
    );
  }

  bar.querySelector('.rag-fb-yes').addEventListener('click', function () {
    _send('helpful');
  });
  bar.querySelector('.rag-fb-no').addEventListener('click', function () {
    _send('not_helpful');
  });
  bar.querySelector('.rag-fb-wrong').addEventListener('click', function () {
    _send('wrong_answer');
  });
  bar.querySelector('.rag-fb-cite').addEventListener('click', function () {
    _send('missing_citation');
  });

  return bar;
}
