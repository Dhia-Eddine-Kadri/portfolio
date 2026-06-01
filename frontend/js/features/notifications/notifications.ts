// Minallo notifications — lightweight, per-user, localStorage-backed.
//
// The notifications section (#psec-notifications) is static markup in
// portal.html (header + All/Unread tabs + #notifList + mark-all). This module
// owns the data + rendering and exposes `window.addNotification(...)` so other
// flows (e.g. onboarding's welcome message) can push notifications.
//
// Storage: `ss_notifs_<uid>` = Notif[] (newest first, capped). Per-device for
// now; can later be backed by a Supabase `notifications` table for cross-device
// sync / server-sent notifications without changing callers.

interface Notif {
  id: string;
  title: string;
  body?: string;
  icon?: string;
  ts: number;
  read?: boolean;
}

interface AddNotifInput {
  title: string;
  body?: string;
  icon?: string;
  // When set, the notification is only added once per user (re-adds are
  // ignored). Used so the welcome message isn't duplicated on re-login.
  dedupeKey?: string;
}

const MAX_NOTIFS = 100;
let _tab: 'all' | 'unread' = 'all';

function _uid(): string {
  try {
    return localStorage.getItem('ss_last_uid') || '';
  } catch {
    return '';
  }
}

function _key(): string {
  return 'ss_notifs_' + _uid();
}

function _load(): Notif[] {
  try {
    const raw = localStorage.getItem(_key());
    const list = raw ? (JSON.parse(raw) as Notif[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function _save(list: Notif[]): void {
  try {
    localStorage.setItem(_key(), JSON.stringify(list.slice(0, MAX_NOTIFS)));
  } catch {
    /* quota — ignore */
  }
}

function _esc(s: string): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function _t(key: string, fallback: string): string {
  const w = window as unknown as { _t?: (k: string) => string };
  if (typeof w._t === 'function') {
    const v = w._t(key);
    if (v && v !== key) return v;
  }
  return fallback;
}

function _relTime(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const m = Math.floor(diff / 60000);
  if (m < 1) return _t('notif_now', 'Just now');
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h';
  const d = Math.floor(h / 24);
  if (d < 7) return d + 'd';
  try {
    return new Date(ts).toLocaleDateString();
  } catch {
    return d + 'd';
  }
}

function _unreadCount(list: Notif[]): number {
  return list.reduce((n, x) => (x.read ? n : n + 1), 0);
}

function _updateBadge(unread: number): void {
  const item = document.getElementById('psbNotifications');
  if (!item) return;
  let badge = item.querySelector('.sb-badge') as HTMLElement | null;
  if (unread > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'sb-badge';
      item.appendChild(badge);
    }
    badge.textContent = unread > 9 ? '9+' : String(unread);
    badge.style.display = '';
  } else if (badge) {
    badge.style.display = 'none';
  }
}

export function renderNotifications(): void {
  const list = _load();
  const unread = _unreadCount(list);
  _updateBadge(unread);

  const countEl = document.getElementById('notifCount');
  if (countEl) {
    countEl.textContent =
      unread > 0
        ? unread + ' ' + _t('notif_unread_label', 'unread')
        : _t('notif_all_caught', 'All caught up');
  }

  const listEl = document.getElementById('notifList');
  if (!listEl) return;

  const shown = _tab === 'unread' ? list.filter((x) => !x.read) : list;
  if (shown.length === 0) {
    listEl.innerHTML =
      '<div class="notif-empty">' +
      '<div class="notif-empty-icon">🔔</div>' +
      '<div class="notif-empty-title">' +
      _esc(_t('notif_empty_title', "You're all caught up!")) +
      '</div>' +
      '<div class="notif-empty-sub">' +
      _esc(_t('notif_empty_sub', 'New notifications will appear here')) +
      '</div>' +
      '</div>';
    return;
  }

  listEl.innerHTML = shown
    .map(
      (x) =>
        '<div class="notif-item' +
        (x.read ? '' : ' unread') +
        '" data-id="' +
        _esc(x.id) +
        '">' +
        '<div class="notif-item-icon">' +
        _esc(x.icon || '🔔') +
        '</div>' +
        '<div class="notif-item-main">' +
        '<div class="notif-item-title">' +
        _esc(x.title) +
        '</div>' +
        (x.body ? '<div class="notif-item-text">' + _esc(x.body) + '</div>' : '') +
        '<div class="notif-item-time">' +
        _esc(_relTime(x.ts)) +
        '</div>' +
        '</div>' +
        '</div>'
    )
    .join('');
}

export function addNotification(input: AddNotifInput): void {
  if (!input || !input.title) return;
  if (!_uid()) return;
  const list = _load();
  if (input.dedupeKey && list.some((x) => x.id.indexOf(input.dedupeKey + ':') === 0)) return;
  const item: Notif = {
    id:
      (input.dedupeKey ? input.dedupeKey + ':' : '') +
      Date.now().toString(36) +
      Math.random().toString(36).slice(2, 7),
    title: input.title,
    body: input.body || '',
    icon: input.icon || '🔔',
    ts: Date.now(),
    read: false,
  };
  list.unshift(item);
  _save(list);
  renderNotifications();
}

function markAllRead(): void {
  const list = _load().map((x) => ({ ...x, read: true }));
  _save(list);
  renderNotifications();
}

export function initNotifications(): void {
  const markAll = document.getElementById('notifMarkAll');
  if (markAll && !markAll.dataset.bound) {
    markAll.dataset.bound = '1';
    markAll.addEventListener('click', markAllRead);
  }

  document.querySelectorAll<HTMLElement>('.notif-tab').forEach((tabEl) => {
    if (tabEl.dataset.bound) return;
    tabEl.dataset.bound = '1';
    tabEl.addEventListener('click', () => {
      _tab = tabEl.dataset.tab === 'unread' ? 'unread' : 'all';
      document.querySelectorAll('.notif-tab').forEach((x) => x.classList.remove('active'));
      tabEl.classList.add('active');
      renderNotifications();
    });
  });

  // Opening the section marks everything read after a beat (so the unread
  // highlight is briefly visible), and keeps the badge in sync.
  const navItem = document.getElementById('psbNotifications');
  if (navItem && !navItem.dataset.notifBound) {
    navItem.dataset.notifBound = '1';
    navItem.addEventListener('click', () => {
      renderNotifications();
      window.setTimeout(markAllRead, 1500);
    });
  }

  const w = window as unknown as {
    addNotification?: typeof addNotification;
    renderNotifications?: typeof renderNotifications;
  };
  w.addNotification = addNotification;
  w.renderNotifications = renderNotifications;

  renderNotifications();
}
