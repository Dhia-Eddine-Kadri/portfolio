// ── GERMAN LEARNER PRACTICE ──────────────────────────────────────────────────
(function () {
  var container = document.getElementById('psec-german');
  if (!container) return;

  fetch('features/practice/practice.html')
    .then(function (r) {
      return r.text();
    })
    .then(function (html) {
      var tmp = document.createElement('div');
      tmp.innerHTML = html;
      var sec = tmp.querySelector('#psec-german');
      if (sec) {
        container.style.cssText = sec.getAttribute('style') || '';
        while (sec.firstChild) container.appendChild(sec.firstChild);
      }
      _init();
    })
    .catch(function (err) {
      console.error('practice.html load error:', err);
    });

  function _init() {
    var _glSkillNames = {
      reading: 'Leseverstehen',
      listening: 'Hörverstehen',
      writing: 'Schreiben',
      speaking: 'Sprechen',
      vocab: 'Wortschatz',
      grammar: 'Grammatik'
    };
    var _glSkillSubs = {
      reading: 'Reading comprehension',
      listening: 'Listening comprehension',
      writing: 'Writing tasks',
      speaking: 'Speaking exercises',
      vocab: 'Vocabulary builder',
      grammar: 'Grammar practice'
    };
    var _glSkillChips = {
      reading: [
        'Practice text + questions',
        'Summarise a text for me',
        'Explain reading strategies'
      ],
      listening: [
        'Give me a listening transcript + questions',
        'Explain listening strategies',
        'Common listening pitfalls'
      ],
      writing: ['Give me a writing prompt', 'Evaluate my writing', 'Explain writing structure'],
      speaking: [
        'Give me speaking prompts',
        'How to structure my answer',
        'Common speaking mistakes'
      ],
      vocab: ['Quiz me on 15 words', 'Words for my exam level', 'Explain these German words'],
      grammar: [
        'Top grammar topics for my exam',
        'Give me grammar exercises',
        'Explain Konjunktiv II'
      ]
    };
    var _glActiveSkill = '';

    // Refresh hero badge/chip from globals set by app.js profile load
    function _glRefreshHero() {
      var glSub = document.getElementById('glTestBadge');
      var glChip = document.getElementById('glLevelChip');
      if (glSub && window._germanTest) glSub.textContent = window._germanTest + ' preparation';
      if (glChip && window._germanLevel) glChip.textContent = window._germanLevel || '–';
    }
    _glRefreshHero();

    // Wire skill cards via event delegation
    document.getElementById('glHome').addEventListener('click', function (e) {
      var card = e.target.closest('.gl-skill-card');
      if (card) window._glOpenSkill(card.getAttribute('data-skill'));
    });

    // Back button
    var glBackBtn = document.getElementById('glBackBtn');
    if (glBackBtn)
      glBackBtn.addEventListener(
        'click',
        (window._glBackToHome = function () {
          _glActiveSkill = '';
          var home = document.getElementById('glHome');
          var detail = document.getElementById('glSkillView');
          if (home) home.style.display = '';
          if (detail) detail.style.display = 'none';
          var aiChipsEl = document.querySelector('.ai-chips');
          if (aiChipsEl && aiChipsEl._originalHTML) {
            aiChipsEl.innerHTML = aiChipsEl._originalHTML;
            aiChipsEl._originalHTML = null;
          }
        })
      );

    // Upload button
    var glUploadLabel = document.getElementById('glUploadLabel');
    if (glUploadLabel)
      glUploadLabel.addEventListener('click', function () {
        window._glUploadClick();
      });

    // File input change
    var glFileInput = document.getElementById('glFileInput');
    if (glFileInput)
      glFileInput.addEventListener('change', function () {
        window._glUploadFromInput(this);
      });

    // AI panel close
    var glAIPanelClose = document.getElementById('glAIPanelClose');
    if (glAIPanelClose)
      glAIPanelClose.addEventListener('click', function () {
        var panel = document.getElementById('glAIPanel');
        if (panel) panel.style.display = 'none';
      });

    window._glOpenSkill = function (skill) {
      _glActiveSkill = skill;

      // Show skill detail, hide home
      var home = document.getElementById('glHome');
      var detail = document.getElementById('glSkillView');
      if (home) home.style.display = 'none';
      if (detail) detail.style.display = '';

      // Update title and subtitle
      var titleEl = document.getElementById('glSkillTitle');
      var subEl = document.getElementById('glSkillSub');
      if (titleEl) titleEl.textContent = _glSkillNames[skill] || skill;
      if (subEl) subEl.textContent = _glSkillSubs[skill] || '';

      // Swap AI chips
      var aiChipsEl = document.querySelector('.ai-chips');
      if (aiChipsEl) {
        if (!aiChipsEl._originalHTML) aiChipsEl._originalHTML = aiChipsEl.innerHTML;
        aiChipsEl.innerHTML = '';
        (_glSkillChips[skill] || []).forEach(function (label) {
          var btn = document.createElement('span');
          btn.className = 'ai-tip';
          btn.textContent = label;
          btn.addEventListener('click', function () {
            window._glAsk(label, _glSkillNames[skill]);
          });
          aiChipsEl.appendChild(btn);
        });
      }

      _glLoadFiles();
    };

    window._glBackToHome = function () {
      _glActiveSkill = '';
      var home = document.getElementById('glHome');
      var detail = document.getElementById('glSkillView');
      if (home) home.style.display = '';
      if (detail) detail.style.display = 'none';
      var aiChipsEl = document.querySelector('.ai-chips');
      if (aiChipsEl && aiChipsEl._originalHTML) {
        aiChipsEl.innerHTML = aiChipsEl._originalHTML;
        aiChipsEl._originalHTML = null;
      }
    };

    window._glAsk = function (prompt, title) {
      var test = window._germanTest || 'German test';
      var level = window._germanLevel || 'my level';
      var skill = _glSkillNames[_glActiveSkill] || _glActiveSkill || '';
      var pv = document.getElementById('pdfView');
      var pdfAlreadyOpen = pv && pv.style.display !== 'none' && pdfDoc;
      if (!pdfAlreadyOpen) {
        _showFilesView();
        var ws = document.getElementById('welcomeState');
        var co = document.getElementById('courseOverview');
        if (ws) {
          ws.style.display = 'flex';
          ws.innerHTML =
            '<div style="text-align:center;padding:40px 20px"><div style="font-size:3rem">🇩🇪</div><div style="font-family:\'Fredoka One\',cursive;font-size:1.3rem;color:#e2d9f3;margin-top:12px">' +
            (title || 'German Practice') +
            '</div><div style="font-size:.82rem;color:rgba(255,255,255,.4);margin-top:6px">' +
            test +
            (level ? ' \xB7 ' + level : '') +
            '</div></div>';
        }
        if (co) co.style.display = 'none';
        if (pv) pv.style.display = 'none';
      }
      openAI();
      pinAI();
      function _sendWhenReady(attempts) {
        if (pdfDoc && !pdfFullText && attempts > 0) {
          setTimeout(function () {
            _sendWhenReady(attempts - 1);
          }, 300);
          return;
        }
        var fullPrompt =
          prompt +
          ' (Context: ' +
          test +
          (level ? ', level ' + level : '') +
          (skill ? ', skill: ' + skill : '') +
          ')';
        askAI(fullPrompt, false);
      }
      setTimeout(function () {
        _sendWhenReady(10);
      }, 100);
    };

    function _glAppendMsg(text, role) {
      var msgs = document.getElementById('glAIMessages');
      if (!msgs) return;
      var d = document.createElement('div');
      d.className = 'gl-ai-msg ' + role;
      d.textContent = text;
      msgs.appendChild(d);
      msgs.scrollTop = msgs.scrollHeight;
      return d;
    }

    function _glCourse() {
      var sk = _glActiveSkill || 'general';
      return {
        id: 'german-' + sk,
        short: 'german-' + sk,
        name: 'German ' + (_glSkillNames[sk] || sk)
      };
    }

    function _glFmtSize(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function _glFileIcon(name) {
      var ext = (name.split('.').pop() || '').toLowerCase();
      if (ext === 'pdf') return '📄';
      if (['doc', 'docx'].includes(ext)) return '📝';
      if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return '🖼️';
      return '📎';
    }

    async function _glLoadFiles() {
      var uid = _currentUser && (_currentUser.id || _currentUser.sub);
      if (!uid) return;
      var course = _glCourse();
      if (!course.files) course.files = [];
      try {
        await _ufMerge(course);
      } catch (e) {
        console.warn('glLoadFiles merge error:', e);
      }
      activeCourseId = course.id;
      activeCourseRef = course;
      _showFilesView();
      var crumb = document.getElementById('breadcrumb');
      if (crumb) crumb.innerHTML = '<b>' + (course.name || course.id) + '</b>';
      showCourseSection(course, 'files');
    }

    function _glOpenFile(uid, fname) {
      var ext = (fname.split('.').pop() || '').toLowerCase();
      if (ext === 'pdf') {
        var course = _glCourse();
        activeCourseId = course.id;
        var fakeFile = { name: fname, _uploaded: true, _course: course };
        _showFilesView();
        openFile(fakeFile, course);
      } else {
        _ufFetchBytes(uid, _glCourse(), fname)
          .then(function (bytes) {
            var blob = new Blob([bytes], { type: 'application/octet-stream' });
            window.open(URL.createObjectURL(blob), '_blank');
          })
          .catch(function (e) {
            showToast('Could not open file', e.message || String(e));
          });
      }
    }
    window._glOpenFile = _glOpenFile;

    async function _glDeleteFile(uid, fname, rowEl) {
      if (!confirm('Delete "' + fname + '"?')) return;
      try {
        await _ufDeleteRemote(uid, _glCourse(), fname);
        rowEl.remove();
        var list = document.getElementById('glFileList');
        if (list && !list.querySelector('.gl-file-row')) {
          var empty = document.getElementById('glFileEmpty');
          if (empty) empty.style.display = '';
        }
        showToast('File deleted', fname);
      } catch (e) {
        showToast('Delete failed', e.message || String(e));
      }
    }
    window._glDeleteFile = _glDeleteFile;

    async function _glAskAboutFile(uid, fname, mode) {
      var panel = document.getElementById('glAIPanel');
      var msgs = document.getElementById('glAIMessages');
      var ptitle = document.getElementById('glAIPanelTitle');
      if (!panel || !msgs) return;
      panel.style.display = '';
      if (ptitle) ptitle.textContent = (mode === 'quiz' ? '🧠 Quiz — ' : '💡 Explain — ') + fname;
      msgs.innerHTML = '';
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      var loadMsg = _glAppendMsg('Loading file…', 'bot');
      var bytes;
      try {
        bytes = await _ufFetchBytes(uid, _glCourse(), fname);
      } catch (e) {
        loadMsg.textContent = '⚠️ Could not load file: ' + (e.message || String(e));
        return;
      }

      var ext = (fname.split('.').pop() || '').toLowerCase();
      var test = window._germanTest || 'German exam';
      var level = window._germanLevel || 'my level';
      var systemCtx =
        'You are a German language tutor helping a student prepare for ' +
        test +
        (level ? ' at level ' + level : '') +
        '. The student has uploaded a study document. Base ALL your responses strictly on its content.';

      var userPrompt =
        mode === 'quiz'
          ? 'Based on this document, create a quiz with 5 questions (multiple choice or short answer) that test understanding of the key content. After each question, provide the correct answer and a brief explanation.'
          : 'Explain the key concepts in this document clearly and concisely. Highlight the most important points a student should understand and remember for their exam.';

      loadMsg.textContent = '⏳ Reading file…';

      var messageContent;
      if (ext === 'pdf') {
        var b64 = '';
        var chunkSize = 8192;
        for (var i = 0; i < bytes.length; i += chunkSize) {
          var chunk = bytes.subarray(i, i + chunkSize);
          b64 += String.fromCharCode.apply(null, chunk);
        }
        b64 = btoa(b64);
        messageContent = [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: b64 }
          },
          { type: 'text', text: userPrompt }
        ];
      } else if (['txt', 'md'].includes(ext)) {
        var textContent = new TextDecoder().decode(bytes);
        messageContent = [
          { type: 'text', text: 'DOCUMENT CONTENT:\n' + textContent + '\n\n' + userPrompt }
        ];
      } else {
        loadMsg.textContent =
          '⚠️ Only PDF and text files can be analysed by the AI. Open the file to view it.';
        return;
      }

      loadMsg.textContent = '⏳ Asking AI…';

      try {
        var resp = await fetch(BACKEND_URL + '/api/ai', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + (window._sbToken || '')
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 1500,
            system: systemCtx,
            messages: [{ role: 'user', content: messageContent }]
          })
        });
        var data = await resp.json();
        var text = data.error
          ? '❌ ' + (data.error.message || JSON.stringify(data.error))
          : data.content
            ? data.content
                .map(function (b) {
                  return b.text || '';
                })
                .join('')
            : '⚠️ No response';
        loadMsg.textContent = text;
      } catch (e) {
        loadMsg.textContent = '⚠️ Could not reach AI. Check your connection.';
      }
    }
    window._glAskAboutFile = _glAskAboutFile;

    window._glUploadFiles = async function (files, folder) {
      if (!files || !files.length) return;
      var uid = _currentUser && (_currentUser.id || _currentUser.sub);
      if (!uid) {
        showToast('Not logged in', 'Please sign in first');
        return;
      }
      var prog = document.getElementById('glUploadProgress');
      var bar = document.getElementById('glUploadBar');
      var status = document.getElementById('glUploadStatus');
      var label = document.getElementById('glUploadLabel');
      if (prog) prog.style.display = '';
      if (label) label.style.pointerEvents = 'none';

      var arr = Array.from(files);
      for (var i = 0; i < arr.length; i++) {
        var f = arr[i];
        if (status)
          status.textContent = 'Uploading ' + f.name + ' (' + (i + 1) + '/' + arr.length + ')…';
        try {
          await _ufUpload(
            uid,
            _glCourse(),
            f,
            function (pct) {
              if (bar) bar.style.width = pct + '%';
            },
            folder || null
          );
        } catch (e) {
          showToast('Upload failed', f.name + ': ' + (e.message || String(e)));
        }
      }

      if (prog) prog.style.display = 'none';
      if (bar) bar.style.width = '0%';
      if (label) label.style.pointerEvents = '';
      var inp = document.getElementById('glFileInput');
      if (inp) inp.value = '';
      showToast('Upload complete', arr.length + ' file' + (arr.length > 1 ? 's' : '') + ' saved');
      await _glLoadFiles();
    };

    window._glUploadClick = function () {
      var inp = document.getElementById('glFileInput');
      if (!inp) return;
      var course = _glCourse();
      var ref = activeCourseRef && activeCourseRef.id === course.id ? activeCourseRef : course;
      var folders = (ref.userFolders || []).map(function (fd) {
        return fd.name;
      });
      var btn = document.getElementById('glUploadLabel');
      if (folders.length === 0) {
        inp._glFolder = null;
        inp.click();
      } else {
        _showFolderPickerPopup(btn || document.body, folders, function (chosen) {
          inp._glFolder = chosen;
          inp.click();
        });
      }
    };

    window._glUploadFromInput = function (inputEl) {
      window._glUploadFiles(inputEl.files, inputEl._glFolder || null);
    };

    // Re-apply hero badge after profile loads (app.js fires this when profile is ready)
    window.addEventListener('ss-profile-updated', _glRefreshHero);
  } // end _init
})();
