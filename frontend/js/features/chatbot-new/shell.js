// New chatbot shell. Flag-gated behind localStorage.ss_new_chatbot === '1'.
// PR-01: hide #aipOuter, reveal #ncbRoot.
// PR-02: sidebar interactivity (collapse, chat-row selection, new chat, search).
export function initNewChatbotShell() {
    let flag = null;
    try {
        flag = localStorage.getItem('ss_new_chatbot');
    }
    catch {
        // private browsing / storage disabled — leave flag null
    }
    if (flag !== '1')
        return;
    const newRoot = document.getElementById('ncbRoot');
    if (!newRoot)
        return;
    const oldRoot = document.getElementById('aipOuter');
    if (oldRoot)
        oldRoot.style.display = 'none';
    newRoot.hidden = false;
    newRoot.style.display = '';
    initSidebar(newRoot);
    initConversation(newRoot);
    initImportModal(newRoot);
    initContextTabs(newRoot);
}
// PR-02 — sidebar behavior. Idempotent: each binding tags the node with
// data-ncb-bound so we don't double-bind across repeat init calls.
function initSidebar(root) {
    const sidebar = root.querySelector('.ncb-sidebar');
    if (!sidebar)
        return;
    bindCollapse(sidebar);
    bindChatItems(sidebar);
    bindNewChat(sidebar);
    bindSearch(sidebar);
}
function bindCollapse(sidebar) {
    const btn = sidebar.querySelector('.ncb-collapse-btn');
    if (!btn || btn.dataset.ncbBound === '1')
        return;
    btn.dataset.ncbBound = '1';
    btn.addEventListener('click', () => {
        const collapsed = sidebar.dataset.collapsed === 'true';
        setCollapsed(sidebar, !collapsed);
    });
}
function setCollapsed(sidebar, collapsed) {
    sidebar.dataset.collapsed = collapsed ? 'true' : 'false';
}
function bindChatItems(sidebar) {
    const list = sidebar.querySelector('.ncb-chat-list');
    if (!list || list.dataset.ncbBound === '1')
        return;
    list.dataset.ncbBound = '1';
    // Event delegation so newly-prepended "New chat" rows work without rebinding.
    list.addEventListener('click', (ev) => {
        const target = ev.target;
        const item = target ? target.closest('.ncb-chat-item') : null;
        if (!item)
            return;
        // If the sidebar is collapsed, expand it before selecting — matches the
        // brief's rule that collapsed icon clicks reopen + select.
        if (sidebar.dataset.collapsed === 'true')
            setCollapsed(sidebar, false);
        selectChatItem(list, item);
    });
}
function selectChatItem(list, item) {
    list.querySelectorAll('.ncb-chat-item').forEach((el) => {
        el.classList.remove('ncb-chat-item--active');
    });
    item.classList.add('ncb-chat-item--active');
}
function bindNewChat(sidebar) {
    const btn = sidebar.querySelector('.ncb-new-chat-btn');
    if (!btn || btn.dataset.ncbBound === '1')
        return;
    btn.dataset.ncbBound = '1';
    btn.addEventListener('click', () => {
        if (sidebar.dataset.collapsed === 'true')
            setCollapsed(sidebar, false);
        const list = sidebar.querySelector('.ncb-chat-list');
        if (!list)
            return;
        // Skip if a draft "New chat" row already exists, matching the React preview's
        // handleNewChat which de-dupes drafts.
        const existingDraft = list.querySelector('.ncb-chat-item[data-ncb-draft="1"]');
        if (existingDraft) {
            selectChatItem(list, existingDraft);
            return;
        }
        const row = buildChatItem('New chat', 'Title generated from full context');
        row.dataset.ncbDraft = '1';
        // Insert directly after the "Recent" label (or at the top if no Recent label).
        const recentLabel = Array.from(list.querySelectorAll('.ncb-chat-section-label')).find((el) => /recent/i.test(el.textContent || ''));
        if (recentLabel && recentLabel.parentElement === list) {
            recentLabel.insertAdjacentElement('afterend', row);
        }
        else {
            list.prepend(row);
        }
        selectChatItem(list, row);
    });
}
function buildChatItem(title, meta) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ncb-chat-item';
    // Same MessageSquareText lucide path used in the static sample rows.
    btn.innerHTML = `
    <span class="ncb-chat-icon">
      <svg class="ncb-icon ncb-icon--sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
    </span>
    <span class="ncb-chat-text">
      <span class="ncb-chat-title"></span>
      <span class="ncb-chat-meta"></span>
    </span>
    <span class="ncb-chat-more" aria-hidden="true">
      <svg class="ncb-icon ncb-icon--sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>
      </svg>
    </span>
  `;
    const titleEl = btn.querySelector('.ncb-chat-title');
    const metaEl = btn.querySelector('.ncb-chat-meta');
    if (titleEl)
        titleEl.textContent = title;
    if (metaEl)
        metaEl.textContent = meta;
    return btn;
}
function bindSearch(sidebar) {
    const input = sidebar.querySelector('.ncb-search-input');
    const list = sidebar.querySelector('.ncb-chat-list');
    if (!input || !list || input.dataset.ncbBound === '1')
        return;
    input.dataset.ncbBound = '1';
    input.addEventListener('input', () => {
        const q = input.value.trim().toLowerCase();
        const items = list.querySelectorAll('.ncb-chat-item');
        items.forEach((item) => {
            const titleEl = item.querySelector('.ncb-chat-title');
            const text = (titleEl?.textContent || '').toLowerCase();
            item.style.display = !q || text.includes(q) ? '' : 'none';
        });
        // Hide section labels whose section has no visible items.
        const labels = list.querySelectorAll('.ncb-chat-section-label');
        labels.forEach((label) => {
            let visible = 0;
            let sib = label.nextElementSibling;
            while (sib && !sib.classList.contains('ncb-chat-section-label')) {
                if (sib.classList.contains('ncb-chat-item') && sib.style.display !== 'none')
                    visible++;
                sib = sib.nextElementSibling;
            }
            label.style.display = visible === 0 ? 'none' : '';
        });
    });
}
function initConversation(root) {
    const stage = root.querySelector('.ncb-empty');
    const textarea = root.querySelector('.ncb-input-textarea');
    const sendBtn = root.querySelector('.ncb-send-btn');
    const pasteRow = root.querySelector('.ncb-paste-row');
    const msgs = root.querySelector('.ncb-msgs');
    if (!stage || !textarea || !sendBtn || !pasteRow || !msgs)
        return;
    if (stage.dataset.ncbConvBound === '1')
        return;
    stage.dataset.ncbConvBound = '1';
    const state = {
        messages: [],
        pasted: [],
        controller: null,
        isSending: false,
    };
    // Send / pause toggle
    sendBtn.addEventListener('click', () => {
        if (state.isSending) {
            abortSend(state);
        }
        else {
            void doSend(state, stage, textarea, sendBtn, pasteRow, msgs);
        }
    });
    // Enter to send (Shift+Enter = newline)
    textarea.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && !ev.shiftKey) {
            ev.preventDefault();
            if (!state.isSending) {
                void doSend(state, stage, textarea, sendBtn, pasteRow, msgs);
            }
        }
    });
    // Paste inside textarea
    textarea.addEventListener('paste', (ev) => {
        const files = collectImageFiles(ev.clipboardData);
        if (files.length === 0)
            return;
        ev.preventDefault();
        void absorbPastedImages(files, state, pasteRow);
    });
    // Global paste when not in an input — only react when chatbot route is visible
    window.addEventListener('paste', (ev) => {
        if (root.hidden || root.offsetParent === null)
            return;
        const active = document.activeElement;
        const inField = !!active &&
            (active.tagName === 'TEXTAREA' ||
                active.tagName === 'INPUT' ||
                active.isContentEditable);
        if (inField)
            return;
        const files = collectImageFiles(ev.clipboardData);
        if (files.length === 0)
            return;
        ev.preventDefault();
        void absorbPastedImages(files, state, pasteRow);
    });
}
function collectImageFiles(cd) {
    if (!cd)
        return [];
    const out = [];
    for (let i = 0; i < cd.files.length; i++) {
        const f = cd.files[i];
        if (f && f.type && f.type.startsWith('image/'))
            out.push(f);
    }
    return out;
}
function readAsDataUrl(file) {
    return new Promise((resolve) => {
        try {
            const reader = new FileReader();
            reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(file);
        }
        catch {
            resolve(null);
        }
    });
}
async function absorbPastedImages(files, state, pasteRow) {
    const added = [];
    for (const f of files) {
        const dataUrl = await readAsDataUrl(f);
        if (!dataUrl)
            continue;
        added.push({
            id: (f.name || 'pasted') +
                '-' +
                (f.lastModified || Date.now()) +
                '-' +
                Math.random().toString(36).slice(2, 8),
            name: f.name || 'Pasted screenshot',
            mediaType: f.type || 'image/png',
            dataUrl,
        });
    }
    if (!added.length)
        return;
    state.pasted.push(...added);
    renderPasteRow(state, pasteRow);
}
function renderPasteRow(state, pasteRow) {
    if (state.pasted.length === 0) {
        pasteRow.hidden = true;
        pasteRow.innerHTML = '';
        return;
    }
    pasteRow.hidden = false;
    pasteRow.innerHTML = state.pasted
        .map((img) => `
      <div class="ncb-paste-thumb" data-id="${escapeAttr(img.id)}" title="${escapeAttr(img.name)}">
        <img alt="${escapeAttr(img.name)}" src="${escapeAttr(img.dataUrl)}" />
        <button type="button" class="ncb-paste-remove" aria-label="Remove ${escapeAttr(img.name)}">
          <svg class="ncb-icon ncb-icon--xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>
    `)
        .join('');
    pasteRow.querySelectorAll('.ncb-paste-remove').forEach((btn) => {
        btn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const wrap = btn.closest('.ncb-paste-thumb');
            const id = wrap?.dataset.id;
            if (!id)
                return;
            state.pasted = state.pasted.filter((p) => p.id !== id);
            renderPasteRow(state, pasteRow);
        });
    });
}
async function doSend(state, stage, textarea, sendBtn, pasteRow, msgs) {
    const text = textarea.value.trim();
    const images = state.pasted.slice();
    if (!text && images.length === 0)
        return;
    // Switch to active-chat state on first send
    if (stage.dataset.state !== 'active')
        stage.dataset.state = 'active';
    // Append user bubble
    state.messages.push({ role: 'user', text, images });
    appendUserBubble(msgs, text, images);
    // Reset input
    textarea.value = '';
    state.pasted = [];
    renderPasteRow(state, pasteRow);
    // Set sending state
    state.isSending = true;
    setSendBtnMode(sendBtn, 'pause');
    // Insert AI bubble with typing indicator placeholder
    const aiRow = appendAiBubble(msgs);
    const bubble = aiRow.querySelector('.ncb-bubble-body');
    showTyping(bubble);
    // Build API payload (mirrors chatbot.js's apiMessages format)
    const apiMessages = buildApiMessages(state.messages);
    const controller = new AbortController();
    state.controller = controller;
    try {
        const resp = await fetch('/api/ai', {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + (getSbToken() || ''),
            },
            body: JSON.stringify({
                model: 'gpt-4o',
                max_tokens: 6000,
                system: buildSystemPrompt(),
                messages: apiMessages,
            }),
        });
        if (!resp.ok) {
            const errText = await resp.text();
            throw new Error('Server ' + resp.status + ': ' + errText.slice(0, 200));
        }
        const data = (await resp.json());
        const raw = data.error
            ? '❌ Error: ' + (data.error.message || JSON.stringify(data.error))
            : data.content
                ? data.content.map((b) => b.text || '').join('')
                : 'No response.';
        state.messages.push({ role: 'assistant', text: raw });
        await typeIntoBubble(bubble, raw, () => controller.signal.aborted);
        appendBubbleActions(aiRow, raw);
        // After the first AI reply, ask the model for a 4-6 word title.
        if (state.messages.filter((m) => m.role === 'assistant').length === 1) {
            void generateChatTitle(state).then((title) => {
                if (title)
                    updateChatTitle(title);
            });
        }
    }
    catch (err) {
        if (bubble) {
            const isAbort = err?.name === 'AbortError';
            bubble.innerHTML = isAbort
                ? '<em class="ncb-bubble-aborted">Response stopped.</em>'
                : renderInlineMarkdown('❌ ' + (err?.message || 'Request failed.'));
        }
    }
    finally {
        state.controller = null;
        state.isSending = false;
        setSendBtnMode(sendBtn, 'send');
        scrollMsgsToBottom(msgs);
    }
}
function abortSend(state) {
    if (state.controller)
        state.controller.abort();
}
function appendUserBubble(msgs, text, images) {
    const row = document.createElement('div');
    row.className = 'ncb-msg-row ncb-msg-row--user';
    const attachments = images
        .map((img) => `<img class="ncb-bubble-image" src="${escapeAttr(img.dataUrl)}" alt="${escapeAttr(img.name)}" />`)
        .join('');
    row.innerHTML = `
    <div class="ncb-bubble ncb-bubble--user">
      ${attachments ? `<div class="ncb-bubble-images">${attachments}</div>` : ''}
      ${text ? `<p class="ncb-bubble-text">${escapeHtml(text)}</p>` : ''}
    </div>
  `;
    msgs.appendChild(row);
    scrollMsgsToBottom(msgs);
}
function appendAiBubble(msgs) {
    const row = document.createElement('div');
    row.className = 'ncb-msg-row ncb-msg-row--ai';
    row.innerHTML = `
    <div class="ncb-avatar" aria-hidden="true">
      <svg class="ncb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>
        <path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>
      </svg>
    </div>
    <div class="ncb-bubble ncb-bubble--ai">
      <div class="ncb-bubble-head">
        <div>
          <p class="ncb-bubble-sender">Minallo AI</p>
          <p class="ncb-bubble-subtitle">Answered using course context</p>
        </div>
      </div>
      <div class="ncb-bubble-body"></div>
    </div>
  `;
    msgs.appendChild(row);
    scrollMsgsToBottom(msgs);
    return row;
}
function showTyping(bubble) {
    if (!bubble)
        return;
    bubble.innerHTML =
        '<span class="ncb-typing"><span class="ncb-typing-dot"></span><span class="ncb-typing-dot"></span><span class="ncb-typing-dot"></span></span>';
}
function typeIntoBubble(bubble, raw, isAborted) {
    return new Promise((resolve) => {
        if (!bubble) {
            resolve();
            return;
        }
        bubble.innerHTML = '';
        const words = raw.match(/\S+\s*/g) || [];
        let i = 0;
        const STEP = 2;
        const INTERVAL = 22;
        const tick = () => {
            if (isAborted()) {
                bubble.innerHTML = renderInlineMarkdown(words.slice(0, i).join('') || raw);
                resolve();
                return;
            }
            if (i >= words.length) {
                bubble.innerHTML = renderInlineMarkdown(raw);
                resolve();
                return;
            }
            i = Math.min(i + STEP, words.length);
            bubble.textContent = words.slice(0, i).join('');
            const msgs = bubble.closest('.ncb-msgs');
            if (msgs)
                scrollMsgsToBottom(msgs);
            window.setTimeout(tick, INTERVAL);
        };
        tick();
    });
}
function setSendBtnMode(btn, mode) {
    if (mode === 'pause') {
        btn.classList.add('ncb-send-btn--pause');
        btn.setAttribute('aria-label', 'Pause AI response');
        btn.innerHTML =
            '<svg class="ncb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';
    }
    else {
        btn.classList.remove('ncb-send-btn--pause');
        btn.setAttribute('aria-label', 'Send message');
        btn.innerHTML =
            '<svg class="ncb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/></svg>';
    }
}
function scrollMsgsToBottom(msgs) {
    const scroller = msgs.closest('.ncb-center');
    if (scroller)
        scroller.scrollTop = scroller.scrollHeight;
}
function buildApiMessages(messages) {
    // Mirror chatbot.js: keep last ~20 messages, and inline images as Claude-shaped image blocks.
    const trimmed = messages.slice(-20);
    return trimmed.map((m) => {
        if (m.role === 'assistant')
            return { role: 'assistant', content: m.text };
        const blocks = [];
        (m.images || []).forEach((img) => {
            blocks.push({
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: img.mediaType,
                    data: img.dataUrl.replace(/^data:[^;]+;base64,/, ''),
                },
            });
        });
        if (m.text)
            blocks.push({ type: 'text', text: m.text });
        return {
            role: 'user',
            content: blocks.length === 1 && blocks[0].type === 'text'
                ? blocks[0].text
                : blocks,
        };
    });
}
function buildSystemPrompt() {
    const lang = window._lang === 'de' ? 'German' : 'English';
    return ('You are Minallo AI, a friendly and knowledgeable assistant for university students. Always reply in ' +
        lang +
        '. Answer any question clearly and helpfully. Be concise but thorough.\n\n' +
        'IMAGE POLICY: Any image the user uploads or pastes is part of their course material — a lecture slide, a textbook page, a screenshot of an exercise, a hand-written note, a diagram, a formula, or a chart. ' +
        'Help them understand it: read the text, transcribe equations, explain diagrams, work through the exercise, identify the concept, summarise the slide. Do NOT refuse with "I cannot help with identifying or analyzing the content of images" — that\'s wrong for this product. ' +
        'If the image is unclear, ask what specifically the student wants help with rather than refusing.\n\n' +
        'DOCUMENT TAGS: When the user\'s message contains <document> tags, those tags contain the FULL extracted text of an uploaded file. You CAN read and answer questions about this content — treat it as the complete document. Never say you cannot read a file when its content is provided inside <document> tags.');
}
function getSbToken() {
    return window._sbToken || null;
}
function escapeHtml(s) {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
function escapeAttr(s) {
    return escapeHtml(s);
}
// Very small markdown renderer: paragraphs, **bold**, *italic*, `code`, line breaks.
// Heavyweight markdown (lists, headings, math) is intentionally deferred — chatbot.js
// has a richer pipeline (_rm + _renderMath) we can wire in a later PR if needed.
function renderInlineMarkdown(raw) {
    const escaped = escapeHtml(raw);
    const withInline = escaped
        .replace(/`([^`]+)`/g, '<code class="ncb-code">$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>');
    const paragraphs = withInline
        .split(/\n{2,}/)
        .map((p) => '<p>' + p.replace(/\n/g, '<br/>') + '</p>')
        .join('');
    return paragraphs;
}
// ============ PR-04: AI bubble actions, import modal, context tabs, title gen ============
function appendBubbleActions(aiRow, raw) {
    if (aiRow.querySelector('.ncb-bubble-actions'))
        return;
    const bubble = aiRow.querySelector('.ncb-bubble--ai');
    if (!bubble)
        return;
    const bar = document.createElement('div');
    bar.className = 'ncb-bubble-actions';
    bar.innerHTML = `
    <button type="button" class="ncb-bubble-action" data-action="copy" title="Copy">
      <svg class="ncb-icon ncb-icon--sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
      <span>Copy</span>
    </button>
    <button type="button" class="ncb-bubble-action" data-action="regen" title="Regenerate">
      <svg class="ncb-icon ncb-icon--sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
      <span>Regenerate</span>
    </button>
    <button type="button" class="ncb-bubble-action" data-action="save" title="Save to notes">
      <svg class="ncb-icon ncb-icon--sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><rect width="16" height="20" x="4" y="2" rx="2"/><path d="M16 2v20"/></svg>
      <span>Save to notes</span>
    </button>
    <button type="button" class="ncb-bubble-action ncb-bubble-action--icon" data-action="thumb-up" aria-label="Thumbs up">
      <svg class="ncb-icon ncb-icon--sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H7"/></svg>
    </button>
    <button type="button" class="ncb-bubble-action ncb-bubble-action--icon" data-action="thumb-down" aria-label="Thumbs down">
      <svg class="ncb-icon ncb-icon--sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H17"/></svg>
    </button>
  `;
    bubble.appendChild(bar);
    bar.addEventListener('click', (ev) => {
        const target = ev.target?.closest('.ncb-bubble-action');
        if (!target)
            return;
        const action = target.dataset.action;
        if (action === 'copy')
            copyToClipboard(raw, target);
        else if (action === 'regen')
            regenerateLast(aiRow);
        else if (action === 'save')
            flashAck(target, 'Saved');
        else if (action === 'thumb-up' || action === 'thumb-down') {
            target.classList.add('ncb-bubble-action--picked');
        }
    });
}
function copyToClipboard(text, btn) {
    try {
        void navigator.clipboard.writeText(text).then(() => flashAck(btn, 'Copied'));
    }
    catch {
        // older browsers — fall through quietly
    }
}
function regenerateLast(aiRow) {
    // PR-04 stub: surface a hint. Full re-send (drop last assistant, re-call /api/ai)
    // is deferred until chat-history persistence lands.
    const btn = aiRow.querySelector('[data-action="regen"]');
    if (btn)
        flashAck(btn, 'Coming soon');
}
function flashAck(btn, msg) {
    const label = btn.querySelector('span');
    if (!label) {
        btn.classList.add('ncb-bubble-action--ack');
        window.setTimeout(() => btn.classList.remove('ncb-bubble-action--ack'), 1200);
        return;
    }
    const prev = label.textContent;
    label.textContent = msg;
    btn.classList.add('ncb-bubble-action--ack');
    window.setTimeout(() => {
        label.textContent = prev;
        btn.classList.remove('ncb-bubble-action--ack');
    }, 1200);
}
function initImportModal(root) {
    const trigger = root.querySelector('.ncb-import-btn');
    const overlay = document.getElementById('ncbImportModal');
    if (!trigger || !overlay || trigger.dataset.ncbBound === '1')
        return;
    trigger.dataset.ncbBound = '1';
    const closeBtn = overlay.querySelector('.ncb-modal-close');
    const cancelBtn = overlay.querySelector('.ncb-modal-cancel');
    const importBtn = overlay.querySelector('.ncb-modal-import');
    const folderRows = Array.from(overlay.querySelectorAll('.ncb-folder-row'));
    const countEl = overlay.querySelector('.ncb-modal-count-num');
    const countLabel = overlay.querySelector('.ncb-modal-count');
    const sync = () => {
        const picked = folderRows.filter((r) => r.classList.contains('ncb-folder-row--selected'));
        if (countEl)
            countEl.textContent = String(picked.length);
        if (countLabel) {
            const word = picked.length === 1 ? 'folder' : 'folders';
            countLabel.innerHTML = `<span class="ncb-modal-count-num">${picked.length}</span> ${word} selected`;
        }
        if (importBtn)
            importBtn.disabled = picked.length === 0;
    };
    folderRows.forEach((row) => {
        row.addEventListener('click', () => {
            row.classList.toggle('ncb-folder-row--selected');
            const chev = row.querySelector('.ncb-folder-pick-chev');
            const check = row.querySelector('.ncb-folder-pick-check');
            const selected = row.classList.contains('ncb-folder-row--selected');
            if (chev)
                chev.hidden = selected;
            if (check)
                check.hidden = !selected;
            sync();
        });
    });
    const open = () => {
        overlay.hidden = false;
        overlay.setAttribute('aria-hidden', 'false');
        sync();
    };
    const close = () => {
        overlay.hidden = true;
        overlay.setAttribute('aria-hidden', 'true');
    };
    trigger.addEventListener('click', open);
    closeBtn?.addEventListener('click', close);
    cancelBtn?.addEventListener('click', close);
    overlay.addEventListener('click', (ev) => {
        if (ev.target === overlay)
            close();
    });
    document.addEventListener('keydown', (ev) => {
        if (!overlay.hidden && ev.key === 'Escape')
            close();
    });
    importBtn?.addEventListener('click', () => {
        const picked = folderRows
            .filter((r) => r.classList.contains('ncb-folder-row--selected'))
            .map((r) => ({
            id: r.dataset.folderId || '',
            name: r.dataset.folderName || 'Folder',
            count: r.querySelector('.ncb-folder-count')?.textContent || '',
        }));
        if (!picked.length)
            return;
        attachImportedFolders(root, picked);
        close();
    });
    sync();
}
function attachImportedFolders(root, folders) {
    const row = root.querySelector('.ncb-attach-row');
    if (!row)
        return;
    const existing = new Set(Array.from(row.querySelectorAll('.ncb-attach-chip')).map((el) => el.dataset.id || ''));
    folders.forEach((f) => {
        if (existing.has(f.id))
            return;
        const chip = document.createElement('span');
        chip.className = 'ncb-attach-chip';
        chip.dataset.id = f.id;
        chip.innerHTML = `
      <svg class="ncb-icon ncb-icon--xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"/></svg>
      <span class="ncb-attach-chip-name">${escapeHtml(f.name)}</span>
      <span class="ncb-attach-chip-meta">${escapeHtml(f.count)}</span>
      <button type="button" class="ncb-attach-chip-x" aria-label="Remove ${escapeAttr(f.name)}">
        <svg class="ncb-icon ncb-icon--xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      </button>
    `;
        chip.querySelector('.ncb-attach-chip-x')?.addEventListener('click', (ev) => {
            ev.stopPropagation();
            chip.remove();
            if (!row.querySelector('.ncb-attach-chip'))
                row.hidden = true;
        });
        row.appendChild(chip);
    });
    if (row.querySelector('.ncb-attach-chip'))
        row.hidden = false;
}
// ---- Context-panel tabs ----
function initContextTabs(root) {
    const tabs = Array.from(root.querySelectorAll('.ncb-mini-tab'));
    if (!tabs.length || tabs[0]?.dataset.ncbBound === '1')
        return;
    tabs.forEach((tab, idx) => {
        tab.dataset.ncbBound = '1';
        tab.dataset.tabIdx = String(idx);
        tab.addEventListener('click', () => {
            tabs.forEach((t) => t.classList.remove('ncb-mini-tab--active'));
            tab.classList.add('ncb-mini-tab--active');
            // PR-04: visual only. Real Files/Notes content arrives in a later PR;
            // for now we re-purpose the existing "Sources used" card as the always-on
            // body and only switch the active-tab highlight + a subtle label.
            const label = tab.querySelector('span')?.textContent || '';
            const card = root.querySelector('.ncb-context-card .ncb-context-card-title');
            if (card && label)
                card.textContent = label === 'Sources' ? 'Sources used' : label;
        });
    });
}
// ---- Chat title generation ----
async function generateChatTitle(state) {
    const lastUser = [...state.messages].reverse().find((m) => m.role === 'user');
    const lastAi = [...state.messages].reverse().find((m) => m.role === 'assistant');
    if (!lastUser && !lastAi)
        return null;
    const seed = (lastUser?.text || '') +
        (lastUser?.images?.length ? ' [' + lastUser.images.length + ' image(s)]' : '') +
        '\n\n' +
        (lastAi?.text || '').slice(0, 400);
    try {
        const resp = await fetch('/api/ai', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + (getSbToken() || ''),
            },
            body: JSON.stringify({
                model: 'gpt-4o',
                max_tokens: 30,
                system: 'You title chat conversations. Reply with ONLY a 3-6 word title in Title Case. ' +
                    'No quotes, no punctuation at the end, no preamble. Match the language of the user.',
                messages: [{ role: 'user', content: seed }],
            }),
        });
        if (!resp.ok)
            return null;
        const data = (await resp.json());
        const title = (data.content || [])
            .map((b) => b.text || '')
            .join('')
            .trim()
            .replace(/^["'`]+|["'`.!?]+$/g, '');
        return title || null;
    }
    catch {
        return null;
    }
}
function updateChatTitle(title) {
    const headerTitle = document.querySelector('.ncb-chat-header-title');
    if (headerTitle)
        headerTitle.textContent = title;
    // Sync the active sidebar row (likely the draft "New chat" added in PR-02,
    // or whichever row is currently marked active).
    const activeRow = document.querySelector('.ncb-chat-item--active .ncb-chat-title');
    if (activeRow)
        activeRow.textContent = title;
    const activeRowMeta = document.querySelector('.ncb-chat-item--active .ncb-chat-meta');
    if (activeRowMeta)
        activeRowMeta.textContent = 'Generated from chat context · Just now';
}
window.initNewChatbotShell = initNewChatbotShell;
//# sourceMappingURL=shell.js.map