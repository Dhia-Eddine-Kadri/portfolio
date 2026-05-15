// Writing Coach — view logic (compiled from writing-coach.ts).
import { analyzeParagraph } from './writing-coach-ai.js';
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const DRAFT_KEY = 'ss_writing_coach_draft';
const LEVEL_KEY = 'ss_writing_coach_level';
const MIN_CHARS = 10;
let _injected = false;
let _activeAbort = null;
export function initWritingCoach() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => _tryInject());
    }
    else {
        _tryInject();
    }
}
function _tryInject(attempt = 0) {
    if (_injected) return;
    const psecGerman = document.getElementById('psec-german');
    const glHome = psecGerman?.querySelector('#glHome');
    if (!psecGerman || !glHome) {
        if (attempt > 40) return;
        window.setTimeout(() => _tryInject(attempt + 1), 250);
        return;
    }
    _injected = true;
    void _inject(psecGerman);
}
async function _inject(psecGerman) {
    try {
        const res = await fetch('views/writing-coach/writing-coach.html');
        if (!res.ok) {
            console.error('[writing-coach] fetch failed:', res.status);
            return;
        }
        const html = await res.text();
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        const card = tmp.querySelector('#wcCard');
        const view = tmp.querySelector('#wcView');
        const glHome = psecGerman.querySelector('#glHome');
        if (card && glHome) glHome.appendChild(card);
        if (view) psecGerman.appendChild(view);
        _wire();
    }
    catch (e) {
        console.error('[writing-coach] inject error:', e);
    }
}
function _wire() {
    const card = document.getElementById('wcCard');
    card?.addEventListener('click', _openView);
    const back = document.getElementById('wcBack');
    back?.addEventListener('click', _closeView);
    const select = document.getElementById('wcLevel');
    if (select) {
        const saved = localStorage.getItem(LEVEL_KEY);
        if (saved && LEVELS.includes(saved)) select.value = saved;
        select.addEventListener('change', () => {
            localStorage.setItem(LEVEL_KEY, select.value);
        });
    }
    const ta = document.getElementById('wcInput');
    if (ta) {
        ta.value = localStorage.getItem(DRAFT_KEY) || '';
        let saveTimer = null;
        ta.addEventListener('input', () => {
            if (saveTimer !== null) window.clearTimeout(saveTimer);
            saveTimer = window.setTimeout(() => {
                localStorage.setItem(DRAFT_KEY, ta.value);
            }, 500);
            _updateAnalyzeEnabled();
        });
    }
    const btn = document.getElementById('wcAnalyze');
    btn?.addEventListener('click', () => {
        void _analyze();
    });
    _updateAnalyzeEnabled();
    if (typeof window._userType === 'string' && window._userType !== 'learner') {
        if (card) card.style.display = 'none';
    }
}
function _openView() {
    const home = document.getElementById('glHome');
    const view = document.getElementById('wcView');
    if (home) home.style.display = 'none';
    if (view) view.style.display = '';
    const ta = document.getElementById('wcInput');
    ta?.focus();
}
function _closeView() {
    if (_activeAbort) {
        _activeAbort.abort();
        _activeAbort = null;
    }
    const home = document.getElementById('glHome');
    const view = document.getElementById('wcView');
    if (view) view.style.display = 'none';
    if (home) home.style.display = '';
}
function _updateAnalyzeEnabled() {
    const ta = document.getElementById('wcInput');
    const btn = document.getElementById('wcAnalyze');
    if (!ta || !btn) return;
    btn.disabled = ta.value.trim().length < MIN_CHARS;
}
async function _analyze() {
    const ta = document.getElementById('wcInput');
    const select = document.getElementById('wcLevel');
    const btn = document.getElementById('wcAnalyze');
    const loading = document.getElementById('wcLoading');
    const results = document.getElementById('wcResults');
    if (!ta || !select || !btn) return;
    const text = ta.value.trim();
    const level = select.value;
    if (text.length < MIN_CHARS) return;
    if (_activeAbort) _activeAbort.abort();
    _activeAbort = new AbortController();
    btn.disabled = true;
    if (loading) loading.style.display = 'flex';
    if (results) {
        results.style.display = 'none';
        results.innerHTML = '';
    }
    try {
        const analysis = await analyzeParagraph({ text, level, signal: _activeAbort.signal });
        _renderResults(analysis);
    }
    catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        console.error('[writing-coach] analyze error:', e);
        if (results) {
            results.style.display = '';
            results.innerHTML = '<div class="wc-error">Analysis failed. Please try again.</div>';
        }
    }
    finally {
        if (loading) loading.style.display = 'none';
        btn.disabled = ta.value.trim().length < MIN_CHARS;
        _activeAbort = null;
    }
}
function _renderResults(a) {
    const root = document.getElementById('wcResults');
    if (!root) return;
    root.style.display = '';
    const issuesHtml = (a.issues || []).map(_issueCard).join('') ||
        '<p class="wc-empty">No grammar issues found.</p>';
    const vocabHtml = (a.vocabularySuggestions || []).map(_issueCard).join('') ||
        '<p class="wc-empty">No vocabulary suggestions.</p>';
    const tipsHtml = (a.practiceTips || []).map((t) => `<li>${_escape(t)}</li>`).join('');
    root.innerHTML = `
    <section class="wc-result-section">
      <h3 class="wc-result-title">Corrected Text</h3>
      <p class="wc-corrected">${_escape(a.correctedText)}</p>
    </section>
    <section class="wc-result-section">
      <h3 class="wc-result-title">Mistakes Explained</h3>
      <div class="wc-issue-grid">${issuesHtml}</div>
    </section>
    <section class="wc-result-section">
      <h3 class="wc-result-title">Vocabulary Improvements</h3>
      <div class="wc-issue-grid">${vocabHtml}</div>
    </section>
    <section class="wc-result-section">
      <h3 class="wc-result-title">Improved Version</h3>
      <p class="wc-improved">${_escape(a.improvedText)}</p>
    </section>
    <section class="wc-result-section wc-level-section">
      <h3 class="wc-result-title">Estimated Level</h3>
      <span class="wc-level-badge">${_escape(a.estimatedLevel)}</span>
    </section>
    <section class="wc-result-section">
      <h3 class="wc-result-title">Practice Recommendations</h3>
      <ul class="wc-tips">${tipsHtml}</ul>
    </section>
    <div class="wc-result-actions">
      <button id="wcAgain" class="wc-btn-secondary" type="button">Write another</button>
    </div>
  `;
    const again = document.getElementById('wcAgain');
    again?.addEventListener('click', _resetForm);
}
function _issueCard(issue) {
    const colorClass = `wc-color-${issue.color}`;
    return `
    <div class="wc-issue ${colorClass}">
      <div class="wc-issue-header">
        <span class="wc-issue-dot"></span>
        <span class="wc-issue-type">${_escape(issue.type)}</span>
      </div>
      <div class="wc-issue-change">
        <span class="wc-issue-original">${_escape(issue.original)}</span>
        <span class="wc-issue-arrow">→</span>
        <span class="wc-issue-correction">${_escape(issue.correction)}</span>
      </div>
      <p class="wc-issue-explanation">${_escape(issue.explanation)}</p>
    </div>
  `;
}
function _resetForm() {
    const ta = document.getElementById('wcInput');
    const results = document.getElementById('wcResults');
    if (ta) {
        ta.value = '';
        ta.focus();
    }
    localStorage.removeItem(DRAFT_KEY);
    if (results) {
        results.style.display = 'none';
        results.innerHTML = '';
    }
    _updateAnalyzeEnabled();
}
function _escape(s) {
    return s.replace(/[&<>"']/g, (c) => {
        if (c === '&') return '&amp;';
        if (c === '<') return '&lt;';
        if (c === '>') return '&gt;';
        if (c === '"') return '&quot;';
        return '&#39;';
    });
}
