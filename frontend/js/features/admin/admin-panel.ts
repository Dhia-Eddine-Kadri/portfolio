import {
  checkAdminStatus,
  searchUsers,
  setUserPlan,
  reindexUserCourse,
  listRetrievalLogs,
  getRetrievalLog,
  type RetrievalLogLite,
  type RetrievalLogFull,
  type RetrievalChunkMeta,
} from '../../services/admin-service.js';
import { escapeHtml } from '../../utils/escape-html.js';

interface AdminUser {
  id: string;
  email?: string;
  plan?: string;
  status?: string;
  created_at?: string;
}

export function adminShowIfEligible(user: { id?: string } | null): void {
  const btn = document.getElementById('psbAdmin');
  if (!btn || !user) return;
  btn.style.display = 'none';
  checkAdminStatus()
    .then((data) => {
      const isAdmin = !!(data && typeof data === 'object' && 'isAdmin' in data && (data as { isAdmin?: boolean }).isAdmin);
      if (isAdmin) btn.style.display = '';
    })
    .catch(() => {});
}

export function initAdminPanel(): void {
  const searchBtn = document.getElementById('adminSearchBtn');
  const searchInput = document.getElementById('adminSearchInput') as HTMLInputElement | null;
  const navBtn = document.getElementById('psbAdmin');

  if (navBtn) {
    navBtn.addEventListener('click', () => {
      if (typeof window.showPortal === 'function') window.showPortal();
      if (typeof window.setNavActive === 'function') window.setNavActive('psbAdmin');
      if (typeof window.showPortalSection === 'function') window.showPortalSection('admin');
    });
  }
  if (searchBtn) searchBtn.addEventListener('click', adminSearch);
  if (searchInput) {
    searchInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') adminSearch();
    });
  }
  initRetrievalInspector();
}

// ── Retrieval inspector ────────────────────────────────────────────────────

function initRetrievalInspector(): void {
  const btn = document.getElementById('retrInspectorLoad');
  if (!btn) return;
  btn.addEventListener('click', loadRetrievalLogs);
}

function _fmtTs(iso: string): string {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

async function loadRetrievalLogs(): Promise<void> {
  const list = document.getElementById('retrInspectorList');
  const detail = document.getElementById('retrInspectorDetail');
  if (!list) return;
  if (detail) detail.innerHTML = '';
  const userId = (document.getElementById('retrInspectorUser') as HTMLInputElement | null)?.value.trim() || undefined;
  const courseId = (document.getElementById('retrInspectorCourse') as HTMLInputElement | null)?.value.trim() || undefined;
  list.innerHTML =
    '<div style="color:var(--on-glass-muted);font-size:.85rem">Loading…</div>';
  try {
    const { rows } = await listRetrievalLogs({ userId, courseId, limit: 25 });
    if (!rows.length) {
      list.innerHTML =
        '<div style="color:var(--on-glass-muted);font-size:.85rem">No rows.</div>';
      return;
    }
    list.innerHTML = '';
    rows.forEach((r) => list.appendChild(_renderLogRow(r)));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    list.innerHTML = '<div style="color:#f87171;font-size:.85rem">Error: ' + escapeHtml(msg) + '</div>';
  }
}

function _renderLogRow(r: RetrievalLogLite): HTMLElement {
  const card = document.createElement('div');
  card.style.cssText =
    'background:var(--glass-bg);border:1px solid var(--glass-border);' +
    'border-radius:12px;padding:10px 14px;margin-bottom:8px;cursor:pointer';
  const mode = r.retrieval_mode || '?';
  const modeColor = mode === 'strong' ? '#22c55e' : mode === 'weak' ? '#facc15' : '#94a3b8';
  card.innerHTML =
    '<div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline">' +
      '<div style="font-weight:700;color:var(--on-glass);font-size:.88rem;min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
        escapeHtml(r.question) +
      '</div>' +
      '<div style="font-size:.72rem;color:' + modeColor + ';font-weight:700">' + escapeHtml(mode) + '</div>' +
    '</div>' +
    '<div style="display:flex;gap:10px;flex-wrap:wrap;font-size:.72rem;color:var(--on-glass-muted);margin-top:4px">' +
      '<span>' + _fmtTs(r.created_at) + '</span>' +
      '<span>course: ' + escapeHtml(r.course_id) + '</span>' +
      '<span>endpoint: ' + escapeHtml(r.endpoint) + '</span>' +
      (r.cache_hit ? '<span style="color:#60a5fa">cache</span>' : '') +
      (r.retrieval_strategy ? '<span>strategy: ' + escapeHtml(r.retrieval_strategy) + '</span>' : '') +
      (r.candidate_doc_count != null ? '<span>docs: ' + r.candidate_doc_count + '</span>' : '') +
    '</div>';
  card.addEventListener('click', () => loadLogDetail(r.id));
  return card;
}

async function loadLogDetail(id: string): Promise<void> {
  const detail = document.getElementById('retrInspectorDetail');
  if (!detail) return;
  detail.innerHTML =
    '<div style="color:var(--on-glass-muted);font-size:.85rem">Loading detail…</div>';
  try {
    const { row } = await getRetrievalLog(id);
    detail.innerHTML = '';
    detail.appendChild(_renderLogDetail(row));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    detail.innerHTML = '<div style="color:#f87171;font-size:.85rem">Error: ' + escapeHtml(msg) + '</div>';
  }
}

function _renderLogDetail(r: RetrievalLogFull): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText =
    'background:var(--glass-bg);border:1px solid var(--glass-border);' +
    'border-radius:14px;padding:16px 18px';

  const head = document.createElement('div');
  head.innerHTML =
    '<div style="font-weight:800;font-size:.95rem;color:var(--on-glass);margin-bottom:6px">' +
      escapeHtml(r.question) +
    '</div>' +
    '<div style="font-size:.72rem;color:var(--on-glass-muted);display:flex;flex-wrap:wrap;gap:10px">' +
      '<span>' + _fmtTs(r.created_at) + '</span>' +
      '<span>user: ' + escapeHtml(r.user_id) + '</span>' +
      '<span>course: ' + escapeHtml(r.course_id) + '</span>' +
      '<span>endpoint: ' + escapeHtml(r.endpoint) + '</span>' +
      (r.active_document_id ? '<span>active doc: ' + escapeHtml(r.active_document_id) + '</span>' : '') +
      (r.selected_document_ids?.length ? '<span>selected: ' + r.selected_document_ids.length + '</span>' : '') +
      '<span>strategy: ' + escapeHtml(r.retrieval_strategy || '?') + '</span>' +
      '<span>mode: ' + escapeHtml(r.retrieval_mode || '?') + '</span>' +
      (r.cache_hit ? '<span style="color:#60a5fa">cache hit</span>' : '') +
      (r.model ? '<span>model: ' + escapeHtml(r.model) + '</span>' : '') +
      (r.prompt_tokens != null ? '<span>tok in: ' + r.prompt_tokens + '</span>' : '') +
      (r.completion_tokens != null ? '<span>tok out: ' + r.completion_tokens + '</span>' : '') +
    '</div>';
  wrap.appendChild(head);

  if (r.exercise_hit) {
    const ex = document.createElement('pre');
    ex.style.cssText =
      'margin-top:12px;padding:10px 12px;background:rgba(34,197,94,.08);' +
      'border:1px solid rgba(34,197,94,.3);border-radius:10px;font-size:.72rem;overflow:auto';
    ex.textContent = 'exact hits: ' + JSON.stringify(r.exercise_hit, null, 2);
    wrap.appendChild(ex);
  }
  if (r.error) {
    const err = document.createElement('div');
    err.style.cssText =
      'margin-top:12px;padding:10px 12px;background:rgba(248,113,113,.08);' +
      'border:1px solid rgba(248,113,113,.4);border-radius:10px;font-size:.78rem;color:#fecaca';
    err.textContent = 'error: ' + r.error;
    wrap.appendChild(err);
  }

  const chunks = Array.isArray(r.chunk_metadata) ? r.chunk_metadata : [];
  const chunksTitle = document.createElement('div');
  chunksTitle.style.cssText = 'margin-top:14px;font-weight:700;color:var(--on-glass);font-size:.82rem';
  chunksTitle.textContent = 'Top chunks (' + chunks.length + ')';
  wrap.appendChild(chunksTitle);

  chunks.forEach((c: RetrievalChunkMeta, i: number) => {
    const row = document.createElement('div');
    row.style.cssText =
      'margin-top:8px;padding:10px 12px;border:1px solid var(--glass-border);' +
      'border-radius:10px;background:rgba(255,255,255,.02)';
    const pages = c.pageStart != null
      ? (c.pageEnd && c.pageEnd !== c.pageStart ? c.pageStart + '-' + c.pageEnd : String(c.pageStart))
      : '?';
    row.innerHTML =
      '<div style="display:flex;gap:10px;flex-wrap:wrap;font-size:.72rem;color:var(--on-glass-muted)">' +
        '<span style="font-weight:800;color:var(--on-glass)">#' + (i + 1) + '</span>' +
        (c.fileName ? '<span>' + escapeHtml(c.fileName) + '</span>' : '') +
        '<span>p.' + escapeHtml(pages) + '</span>' +
        (c.chunkType ? '<span>type: ' + escapeHtml(c.chunkType) + '</span>' : '') +
        (c.synthetic ? '<span style="color:#60a5fa">exact</span>' : '') +
        (c.sectionTitle ? '<span>§ ' + escapeHtml(c.sectionTitle) + '</span>' : '') +
        (c.score != null ? '<span>score: ' + c.score.toFixed(3) + '</span>' : '') +
        (c.similarity != null ? '<span>sim: ' + c.similarity.toFixed(3) + '</span>' : '') +
      '</div>' +
      (c.excerpt
        ? '<div style="margin-top:6px;font-size:.78rem;color:var(--on-glass);white-space:pre-wrap">' +
            escapeHtml(c.excerpt) + '</div>'
        : '');
    wrap.appendChild(row);
  });

  return wrap;
}

async function adminSearch(): Promise<void> {
  const input = document.getElementById('adminSearchInput') as HTMLInputElement | null;
  const results = document.getElementById('adminResults');
  if (!results) return;
  const q = (input?.value || '').trim();
  if (!q) return;
  results.innerHTML =
    '<div style="color:var(--on-glass-muted);font-size:.85rem">Searching...</div>';
  try {
    const users = (await searchUsers(q)) as AdminUser[] | unknown;
    if (!Array.isArray(users) || !users.length) {
      results.innerHTML =
        '<div style="color:var(--on-glass-muted);font-size:.85rem">No users found.</div>';
      return;
    }
    results.innerHTML = '';
    (users as AdminUser[]).forEach((u) => {
      const isPro = u.plan === 'pro' && u.status === 'active';
      const joined = u.created_at ? new Date(u.created_at).toLocaleDateString() : '';

      const card = document.createElement('div');
      card.style.cssText =
        'background:var(--glass-bg);border:1px solid var(--glass-border);border-radius:14px;padding:14px 18px;margin-bottom:10px;display:flex;align-items:center;gap:12px';

      const info = document.createElement('div');
      info.style.cssText = 'flex:1;min-width:0';

      const emailEl = document.createElement('div');
      emailEl.style.cssText = 'font-weight:800;color:var(--on-glass);font-size:.88rem';
      emailEl.textContent = u.email || '';

      const joinedEl = document.createElement('div');
      joinedEl.style.cssText = 'font-size:.72rem;color:var(--on-glass-muted)';
      joinedEl.textContent = 'Joined ' + joined;

      const statusEl = document.createElement('div');
      statusEl.style.cssText =
        'font-size:.75rem;margin-top:4px;font-weight:800;color:' + (isPro ? '#22c55e' : '#f87171');
      statusEl.textContent = isPro ? '✓ Pro (subscribed)' : '✕ Free (not subscribed)';

      info.append(emailEl, joinedEl, statusEl);

      const actionBtn = document.createElement('button');
      actionBtn.className = 'sub-btn ' + (isPro ? 'sub-btn-current' : 'sub-btn-upgrade');
      actionBtn.dataset.uid = u.id;
      actionBtn.dataset.pro = String(isPro);
      actionBtn.style.cssText = 'width:auto;padding:8px 18px;font-size:.78rem';
      actionBtn.textContent = isPro ? 'Revoke Pro' : 'Grant Pro';

      actionBtn.addEventListener('click', async function (this: HTMLButtonElement) {
        const uid = this.dataset.uid || '';
        const grantPro = this.dataset.pro === 'false';
        this.textContent = '...';
        this.disabled = true;
        try {
          await setUserPlan(uid, grantPro ? 'pro' : 'free');
          if (typeof window.showToast === 'function')
            window.showToast(grantPro ? '✓ Pro granted' : 'Pro revoked', u.email);
          adminSearch();
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          if (typeof window.showToast === 'function') window.showToast('Error', msg);
          this.disabled = false;
        }
      });

      const reindexBtn = document.createElement('button');
      reindexBtn.className = 'sub-btn';
      reindexBtn.dataset.uid = u.id;
      reindexBtn.style.cssText = 'width:auto;padding:8px 14px;font-size:.72rem;margin-left:6px';
      reindexBtn.textContent = 'Reindex course…';
      reindexBtn.addEventListener('click', async function (this: HTMLButtonElement) {
        const uid = this.dataset.uid || '';
        const courseId = (window.prompt('Course ID to reindex for ' + (u.email || uid) + ':') || '').trim();
        if (!courseId) return;
        this.disabled = true;
        const origText = this.textContent;
        this.textContent = 'Checking…';
        try {
          const dry = await reindexUserCourse(uid, courseId, true);
          const n = typeof dry.count === 'number' ? dry.count : 0;
          if (dry.error) throw new Error(dry.error);
          if (!n) {
            if (typeof window.showToast === 'function') window.showToast('No documents', 'Course "' + courseId + '" has 0 docs for this user.');
            return;
          }
          if (!window.confirm('Reindex ' + n + ' document(s) in course "' + courseId + '"? This clears chunks/pages and re-runs the indexer.')) return;
          this.textContent = 'Reindexing…';
          const real = await reindexUserCourse(uid, courseId, false);
          if (real.error) throw new Error(real.error);
          if (typeof window.showToast === 'function')
            window.showToast('Reindex queued', 'Total ' + (real.total ?? 0) + ' · kicked ' + (real.kicked ?? 0) + (real.failed ? ' · failed ' + real.failed : ''));
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          if (typeof window.showToast === 'function') window.showToast('Error', msg);
        } finally {
          this.disabled = false;
          this.textContent = origText;
        }
      });

      card.append(info, actionBtn, reindexBtn);
      results.appendChild(card);
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    results.innerHTML = '<div style="color:#f87171;font-size:.85rem">Error: ' + escapeHtml(msg) + '</div>';
  }
}
