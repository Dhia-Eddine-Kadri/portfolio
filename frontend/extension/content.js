// ── Minallo Lecture Assistant — Content Script ────────────────────────
(function () {
  if (window.__minalloInjected) return;
  window.__minalloInjected = true;

  const BACKEND = 'https://minallo.de';

  // ── State ──────────────────────────────────────────────────────────────
  let transcript = [];
  let isCapturing = false;
  let captureInterval = null;
  let lastCapture = '';
  let videoTitle = '';
  let speechRecognition = null;
  let textTrackRef = null;
  let mediaRecorder = null;
  let audioChunks = [];
  let isRecordingAudio = false;

  const isYouTube = location.hostname.includes('youtube.com');
  const isOpencast = location.hostname.includes('opencast');
  const isZoom = location.hostname.includes('zoom.us');
  const isLecturePage = isYouTube || isOpencast || isZoom;

  // ── Website postMessage bridge (runs on all pages, including Minallo) ─
  const KNOWN_TYPES = ['SS_REQUEST_SUMMARIES', 'SS_DELETE_SUMMARY'];
  window.addEventListener('message', function (e) {
    if (!e.data) return;
    if (e.origin !== location.origin) return;
    if (!KNOWN_TYPES.includes(e.data.type)) return;
    try {
      if (!chrome.runtime?.id) return;
    } catch (_) {
      return;
    }
    if (e.data.type === 'SS_REQUEST_SUMMARIES') {
      chrome.storage.local.get('ss_lecture_summaries', function ({ ss_lecture_summaries }) {
        window.postMessage(
          { type: 'SS_SUMMARIES_DATA', summaries: ss_lecture_summaries || [] },
          location.origin
        );
      });
    }
    if (e.data.type === 'SS_DELETE_SUMMARY') {
      chrome.storage.local.set({ ss_lecture_summaries: e.data.summaries || [] });
    }
  });

  // Also push summaries whenever a new one is saved (for live updates)
  chrome.storage.onChanged.addListener(function (changes) {
    if (changes.ss_lecture_summaries) {
      window.postMessage(
        {
          type: 'SS_SUMMARIES_DATA',
          summaries: changes.ss_lecture_summaries.newValue || []
        },
        location.origin
      );
    }
  });

  // Only show the capture panel on lecture video pages
  if (!isLecturePage) return;

  // ── Panel ──────────────────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.id = 'ss-panel';
  panel.classList.add('ss-minimized');
  panel.innerHTML = `
    <div id="ss-header">
      <button id="ss-back" title="Minimize">‹</button>
      <span id="ss-logo">Study Panel</span>
      <div id="ss-controls">
        <button id="ss-toggle-capture" title="Start capturing">⏺</button>
        <button id="ss-summarize" title="Summarize lecture">✦</button>
        <button id="ss-minimize" title="Expand">+</button>
        <button id="ss-close" title="Close panel">✕</button>
      </div>
    </div>
    <div id="ss-body" style="display:none">
      <div id="ss-mode-bar">
        <span id="ss-mode-label">Mode: Auto-detect</span>
        <span id="ss-mode-indicator"></span>
      </div>
      <div id="ss-status">Press ⏺ to start capturing captions</div>
      <div id="ss-transcript-count"></div>
      <div id="ss-result"></div>
    </div>
    <div id="ss-resize" title="Drag to resize"></div>
  `;
  document.body.appendChild(panel);

  // ── Restore saved size ─────────────────────────────────────────────────
  const savedH = localStorage.getItem('ss_panel_height');
  if (savedH) panel.style.height = savedH + 'px';

  // ── Drag (move) ────────────────────────────────────────────────────────
  let dragging = false,
    dragX = 0,
    dragY = 0;
  panel.querySelector('#ss-header').addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    dragging = true;
    dragX = e.clientX - panel.offsetLeft;
    dragY = e.clientY - panel.offsetTop;
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    panel.style.left = e.clientX - dragX + 'px';
    panel.style.top = e.clientY - dragY + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  });
  document.addEventListener('mouseup', () => (dragging = false));

  // ── Resize (height) ────────────────────────────────────────────────────
  const resizeHandle = panel.querySelector('#ss-resize');
  let resizing = false,
    resizeStartY = 0,
    resizeStartH = 0;

  resizeHandle.addEventListener('mousedown', (e) => {
    resizing = true;
    resizeStartY = e.clientY;
    resizeStartH = panel.offsetHeight;
    document.documentElement.style.cursor = 'ns-resize';
    document.documentElement.style.userSelect = 'none';
    e.preventDefault();
    e.stopPropagation();
  });

  // capture:true bypasses any YouTube stopPropagation on mousemove/mouseup
  window.addEventListener(
    'mousemove',
    (e) => {
      if (!resizing) return;
      const newH = Math.max(
        160,
        Math.min(window.innerHeight - 80, resizeStartH + (e.clientY - resizeStartY))
      );
      panel.style.height = newH + 'px';
    },
    { capture: true, passive: true }
  );

  window.addEventListener(
    'mouseup',
    () => {
      if (!resizing) return;
      resizing = false;
      document.documentElement.style.cursor = '';
      document.documentElement.style.userSelect = '';
      localStorage.setItem('ss_panel_height', panel.offsetHeight);
    },
    { capture: true }
  );

  // ── Back / Minimize ────────────────────────────────────────────────────
  const minimizeBtn = panel.querySelector('#ss-minimize');
  const backBtn = panel.querySelector('#ss-back');
  const body = panel.querySelector('#ss-body');
  function toggleMinimize() {
    const hidden = body.style.display === 'none';
    if (hidden) {
      // Expand — restore saved height
      body.style.display = 'block';
      panel.classList.remove('ss-minimized');
      const h = localStorage.getItem('ss_panel_height') || 460;
      panel.style.height = h + 'px';
      minimizeBtn.textContent = '−';
    } else {
      // Collapse — shrink to header only
      body.style.display = 'none';
      panel.classList.add('ss-minimized');
      panel.style.height = '';
      minimizeBtn.textContent = '+';
    }
  }
  minimizeBtn.addEventListener('click', toggleMinimize);
  backBtn.addEventListener('click', toggleMinimize);

  // Close button — hides panel, click extension icon to reopen
  panel.querySelector('#ss-close').addEventListener('click', () => {
    panel.style.display = 'none';
    chrome.storage.local.set({ panelHidden: true });
  });

  // Restore panel if previously hidden
  chrome.storage.local.get('panelHidden', ({ panelHidden }) => {
    if (panelHidden) panel.style.display = 'none';
  });

  const captureBtn = panel.querySelector('#ss-toggle-capture');
  const statusEl = panel.querySelector('#ss-status');
  const countEl = panel.querySelector('#ss-transcript-count');
  const resultEl = panel.querySelector('#ss-result');
  const modeLabel = panel.querySelector('#ss-mode-label');
  const modeIndicator = panel.querySelector('#ss-mode-indicator');

  captureBtn.addEventListener('click', async () => {
    if (!isCapturing) {
      const result = await startCapture();
      if (result?.needsAudio) {
        setStatus(
          '🎙 Open the extension popup and click "Start Capturing" to record audio',
          'loading'
        );
      }
    } else {
      stopCapture();
    }
  });
  panel.querySelector('#ss-summarize').addEventListener('click', summarize);

  // ── Start capture — picks best available method ─────────────────────────
  async function startCapture() {
    isCapturing = true;
    captureBtn.textContent = '⏹';
    transcript = [];
    audioChunks = [];
    textTrackRef = null;
    videoTitle = getVideoTitle();

    // Priority 1: YouTube hidden transcript (instant, best quality)
    if (isYouTube) {
      setStatus('📡 Fetching YouTube transcript…', 'loading');
      const ytT = await fetchYouTubeTranscript();
      if (ytT && ytT.length > 10) {
        transcript = ytT;
        setMode('📄 YouTube transcript', '#06D6A0');
        setStatus(`✅ Got ${ytT.length} transcript entries. Press ✨ to summarize!`, 'done');
        countEl.textContent = `📝 ${ytT.length} entries`;
        isCapturing = false;
        captureBtn.textContent = '⏺';
        return;
      }
    }

    // Priority 2: Live subtitle capture (if subtitles enabled)
    const hasSubs = hasSubtitles();
    if (hasSubs) {
      setMode('💬 Live subtitles', '#4CC9F0');
      setStatus('🔴 Capturing live subtitles…', 'capturing');
      captureInterval = setInterval(captureSubtitle, 800);
      return { ok: true };
    }

    // Priority 3: Hidden text track capture (works even without visual captions)
    const trackOk = startTextTrackCapture();
    if (trackOk) {
      setMode('🔇 Silent caption track', '#FF6B35');
      setStatus('🔴 Reading captions silently — no subtitles shown on screen', 'capturing');
      return { ok: true };
    }

    // Priority 4: Open recorder window (handles tabCapture + Whisper)
    setMode('🎙 Recorder window', '#FF6B35');
    setStatus('🎙 A recorder window will open — click "Start Recording" there', 'loading');
    isCapturing = false; // recorder window manages its own state
    captureBtn.textContent = '⏺';
    return { needsAudio: true };
  }

  function stopCapture() {
    isCapturing = false;
    captureBtn.textContent = '⏺';
    if (captureInterval) {
      clearInterval(captureInterval);
      captureInterval = null;
    }
    if (textTrackRef) {
      try {
        textTrackRef.mode = 'disabled';
      } catch (_) {}
      textTrackRef = null;
    }
    if (speechRecognition) {
      try {
        speechRecognition.stop();
      } catch (_) {}
      speechRecognition = null;
    }
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    isRecordingAudio = false;
    setStatus(
      `✅ ${audioChunks.length > 0 ? 'Audio recorded' : transcript.length + ' captions'}. Press ✨ to summarize.`,
      'done'
    );
  }

  // ── YouTube hidden transcript ──────────────────────────────────────────
  async function fetchYouTubeTranscript() {
    try {
      const videoId = new URLSearchParams(location.search).get('v');
      if (!videoId) return null;

      // Method 1: timedtext API (German first, then English)
      for (const lang of ['de', 'en', 'en-US', 'de-DE', '']) {
        try {
          const url = lang
            ? `https://www.youtube.com/api/timedtext?lang=${lang}&v=${videoId}&fmt=json3`
            : `https://www.youtube.com/api/timedtext?v=${videoId}&fmt=json3&kind=asr`;
          const res = await fetch(url);
          if (!res.ok) continue;
          const data = await res.json();
          if (data.events && data.events.length > 5) {
            return data.events
              .filter((e) => e.segs)
              .map((e) => ({
                t: msToTime(e.tStartMs),
                text: e.segs
                  .map((s) => s.utf8 || '')
                  .join('')
                  .trim()
              }))
              .filter((e) => e.text.length > 1);
          }
        } catch (e) {
          continue;
        }
      }

      // Method 2: Extract from page source (YouTube embeds transcript data)
      const scripts = document.querySelectorAll('script');
      for (const s of scripts) {
        const txt = s.textContent;
        if (txt.includes('playerCaptionsTracklistRenderer')) {
          const match = txt.match(/"captionTracks":\s*(\[.*?\])/);
          if (match) {
            try {
              const tracks = JSON.parse(match[1]);
              if (tracks.length > 0) {
                const trackUrl = tracks[0].baseUrl + '&fmt=json3';
                const res = await fetch(trackUrl);
                const data = await res.json();
                if (data.events) {
                  return data.events
                    .filter((e) => e.segs)
                    .map((e) => ({
                      t: msToTime(e.tStartMs),
                      text: e.segs
                        .map((s) => s.utf8 || '')
                        .join('')
                        .trim()
                    }))
                    .filter((e) => e.text.length > 1);
                }
              }
            } catch (e) {
              continue;
            }
          }
        }
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  function msToTime(ms) {
    const s = Math.floor((ms || 0) / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  // ── Live subtitle capture ──────────────────────────────────────────────
  function hasSubtitles() {
    if (document.querySelector('.ytp-caption-segment')) return true;
    const videos = document.querySelectorAll('video');
    for (const v of videos) {
      for (let i = 0; i < v.textTracks.length; i++) {
        const t = v.textTracks[i];
        if (t.mode === 'showing' && (t.kind === 'subtitles' || t.kind === 'captions')) return true;
      }
    }
    return false;
  }

  function captureSubtitle() {
    const text = getSubtitleText();
    if (text && text !== lastCapture && text.trim().length > 2) {
      lastCapture = text;
      const ts = getCurrentTime();
      transcript.push({ t: ts, text: text.trim() });
      countEl.textContent = `📝 ${transcript.length} captions`;
    }
  }

  function getSubtitleText() {
    let el = document.querySelector('.ytp-caption-segment');
    if (el) return el.innerText;
    el = document.querySelector('.caption-window span');
    if (el) return el.innerText;
    const videos = document.querySelectorAll('video');
    for (const v of videos) {
      for (let i = 0; i < v.textTracks.length; i++) {
        const track = v.textTracks[i];
        if (track.mode === 'showing' && track.activeCues && track.activeCues.length > 0) {
          return track.activeCues[0].text.replace(/<[^>]+>/g, '');
        }
      }
    }
    el = document.querySelector('.transcript-text, .caption-text, [class*="caption"]');
    if (el) return el.innerText;
    return '';
  }

  // ── Video element audio capture (no permissions needed, works with headphones) ──
  function startVideoCapture() {
    const videos = document.querySelectorAll('video');
    for (const video of videos) {
      try {
        const stream = video.captureStream();
        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length === 0) continue;

        isRecordingAudio = true;
        audioChunks = [];

        const mimeType =
          ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find((m) =>
            MediaRecorder.isTypeSupported(m)
          ) || '';
        mediaRecorder = new MediaRecorder(
          new MediaStream(audioTracks),
          mimeType ? { mimeType } : {}
        );
        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            audioChunks.push(e.data);
            countEl.textContent = `🎙 ${audioChunks.length * 5}s recorded`;
          }
        };
        mediaRecorder.start(5000);
        return true;
      } catch (e) {
        console.warn('captureStream failed:', e.message);
      }
    }
    return false;
  }

  // ── Hidden text track capture (free — works with headphones) ─────────────
  function startTextTrackCapture() {
    const videos = document.querySelectorAll('video');
    for (const video of videos) {
      for (let i = 0; i < video.textTracks.length; i++) {
        const track = video.textTracks[i];
        if (track.kind !== 'subtitles' && track.kind !== 'captions') continue;
        // Only use tracks that actually have cues loaded
        track.mode = 'hidden';
        if (!track.cues || track.cues.length === 0) {
          track.mode = 'disabled';
          continue;
        }
        textTrackRef = track;
        track.addEventListener('cuechange', onCueChange);
        return true;
      }
    }
    return false;
  }

  function onCueChange(e) {
    const track = e.target;
    if (!track.activeCues || track.activeCues.length === 0) return;
    const text = track.activeCues[0].text.replace(/<[^>]+>/g, '').trim();
    if (text && text !== lastCapture && text.length > 2) {
      lastCapture = text;
      transcript.push({ t: getCurrentTime(), text });
      countEl.textContent = `📝 ${transcript.length} captions`;
    }
  }

  // ── Free browser speech recognition (mic fallback) ─────────────────────
  function startSpeechRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setStatus('⚠️ No speech recognition available in this browser.', 'error');
      return;
    }

    isRecordingAudio = true;
    speechRecognition = new SR();
    speechRecognition.continuous = true;
    speechRecognition.interimResults = false;
    speechRecognition.lang = '';

    speechRecognition.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          const text = e.results[i][0].transcript.trim();
          if (text.length > 2) {
            transcript.push({ t: getCurrentTime(), text });
            countEl.textContent = `🎤 ${transcript.length} segments`;
          }
        }
      }
    };

    speechRecognition.onerror = (e) => {
      if (e.error === 'no-speech') return;
      if (e.error === 'not-allowed') {
        setStatus('⚠️ Mic access denied. Allow microphone in browser settings.', 'error');
        isRecordingAudio = false;
      }
    };

    // Chrome stops recognition after ~60s of silence — auto-restart
    speechRecognition.onend = () => {
      if (isCapturing && isRecordingAudio) {
        try {
          speechRecognition.start();
        } catch (_) {}
      }
    };

    try {
      speechRecognition.start();
    } catch (e) {
      setStatus('⚠️ Could not start speech recognition: ' + e.message, 'error');
      isRecordingAudio = false;
    }
  }

  // ── Summarize ──────────────────────────────────────────────────────────
  async function summarize() {
    // Expand panel if minimized so the user can see the summary
    if (body.style.display === 'none') {
      body.style.display = 'block';
      panel.classList.remove('ss-minimized');
      const h = localStorage.getItem('ss_panel_height') || 460;
      panel.style.height = h + 'px';
      minimizeBtn.textContent = '−';
    }
    resultEl.innerHTML = '<div class="ss-loading"><span></span><span></span><span></span></div>';
    setStatus('🤖 Generating summary…', 'loading');

    let transcriptText = '';

    // Stop captureStream recording if active
    if (isRecordingAudio && mediaRecorder && mediaRecorder.state !== 'inactive') {
      await new Promise((resolve) => {
        mediaRecorder.addEventListener('stop', resolve, { once: true });
        mediaRecorder.stop();
      });
      isRecordingAudio = false;
    }

    if (!transcriptText && transcript.length > 0) {
      transcriptText = transcript.map((e) => `[${e.t}] ${e.text}`).join('\n');
    }

    // Last resort: try YouTube transcript now
    if (!transcriptText && isYouTube) {
      setStatus('📡 Fetching YouTube transcript…', 'loading');
      const ytT = await fetchYouTubeTranscript();
      if (ytT && ytT.length > 0) {
        transcriptText = ytT.map((e) => `[${e.t}] ${e.text}`).join('\n');
      }
    }

    if (!transcriptText) {
      setStatus('⚠️ No transcript available. Enable subtitles or use audio capture.', 'error');
      resultEl.innerHTML = '';
      return;
    }

    const title = videoTitle || getVideoTitle();
    const capped = transcriptText.slice(0, 14000);

    try {
      const res = await fetch(`${BACKEND}/api/ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o',
          max_tokens: 2000,
          system:
            'You are Minallo, an AI tutor for TU Braunschweig engineering students. Analyze the lecture transcript and produce a structured study summary. Use the same language as the transcript (German or English).',
          messages: [
            {
              role: 'user',
              content: `Lecture: "${title}"\n\nTranscript:\n${capped}\n\n---\nProvide:\n\n## 📝 Summary\nClear summary (6-10 sentences).\n\n## 🔑 Key Concepts\nBullet list of the most important concepts explained in detail.\n\n## 🔢 Formulas & Definitions\nAll formulas, equations or key definitions mentioned.\n\n## ❓ Quiz Questions\n5 questions with answers to test understanding.`
            }
          ]
        })
      });

      const data = await res.json();
      if (data.error) {
        setStatus('❌ ' + (data.error.message || JSON.stringify(data.error)), 'error');
        resultEl.innerHTML = '';
        return;
      }

      const text = data.content ? data.content.map((b) => b.text || '').join('') : 'No response';
      setStatus(`✅ Summary ready!`, 'done');
      resultEl.innerHTML = renderMarkdown(text);

      // Save to lastSummary (popup uses this)
      chrome.storage.local.set({ lastSummary: { title, text, date: new Date().toISOString() } });

      // ── Save to lecture history (website uses this) ──────────────────────
      chrome.storage.local.get('ss_lecture_summaries', ({ ss_lecture_summaries }) => {
        const summaries = ss_lecture_summaries || [];
        summaries.unshift({ title, text, date: new Date().toISOString(), url: location.href });
        if (summaries.length > 30) summaries.pop();
        chrome.storage.local.set({ ss_lecture_summaries: summaries });
      });
    } catch (e) {
      setStatus('❌ ' + e.message, 'error');
      resultEl.innerHTML = '';
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────
  function getVideoTitle() {
    let el = document.querySelector('h1.ytd-watch-metadata yt-formatted-string');
    if (el) return el.innerText;
    el = document.querySelector('h1');
    if (el) return el.innerText.slice(0, 100);
    return document.title.slice(0, 100);
  }

  function getCurrentTime() {
    const v = document.querySelector('video');
    if (!v) return '0:00';
    const s = Math.floor(v.currentTime);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function setStatus(msg, type) {
    statusEl.textContent = msg;
    statusEl.className = 'ss-status-' + (type || '');
  }

  function setMode(label, color) {
    modeLabel.textContent = 'Mode: ' + label;
    modeIndicator.style.background = color;
  }

  function renderMarkdown(text) {
    text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    text = text.replace(/^## (.+)$/gm, '<h3>$1</h3>');
    text = text.replace(/^### (.+)$/gm, '<h4>$1</h4>');
    text = text.replace(/^[•\-\*] (.+)$/gm, '<li>$1</li>');
    text = text.replace(/\n\n/g, '<br>');
    text = text.replace(/\n/g, '<br>');
    return text;
  }

  // Auto-stop when video ends
  const video = document.querySelector('video');
  if (video) {
    video.addEventListener('ended', () => {
      if (isCapturing) {
        stopCapture();
        setStatus('🎬 Video ended! Press ✨ to summarize.', 'done');
      }
    });
  }

  // ── Message handler ────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (msg.action === 'ping') {
      reply({ ok: true });
      return true;
    }
    if (msg.action === 'showPanel') {
      panel.style.display = 'block';
      chrome.storage.local.set({ panelHidden: false });
      reply({ ok: true });
      return true;
    }
    if (msg.action === 'getStatus') {
      reply({ isCapturing, captureCount: transcript.length, title: videoTitle });
      return true;
    }
    if (msg.action === 'summarize') {
      summarize();
      reply({ ok: true });
      return true;
    }
    if (msg.action === 'startCapture') {
      startCapture().then((r) => reply(r || { ok: true }));
      return true;
    }
    if (msg.action === 'stopCapture') {
      stopCapture();
      reply({ ok: true });
      return true;
    }
    if (msg.action === 'whisperProgress') {
      setStatus(msg.text, 'loading');
      return true;
    }
    if (msg.action === 'audioRecordingStarted') {
      isRecordingAudio = true;
      isCapturing = true;
      captureBtn.textContent = '⏹';
      setMode('🎙 Recorder window', '#FF6B35');
      setStatus('🔴 Recording tab audio in recorder window…', 'capturing');
      countEl.textContent = '🎙 Recording…';
      return true;
    }
    if (msg.action === 'whisperTranscriptReady') {
      // Recorder window finished transcription — run AI summary automatically
      isRecordingAudio = false;
      isCapturing = false;
      captureBtn.textContent = '⏺';
      transcript = [{ t: '0:00', text: msg.text }];
      summarize();
      return true;
    }
  });
})();
