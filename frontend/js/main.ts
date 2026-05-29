// Minallo frontend entry point.
//
// Imports app.js (compatibility bridge) which bootstraps all feature modules.
// As app.js shrinks, the init calls will move here and app.js will be removed.

import { initSidebarIcons } from './core/app-shell.js';
import { initPdfWorker } from './core/pdf-worker.js';
import { initDocumentRail } from './features/document-rail/document-rail.js';
// chatbot-new shell (~103 KB) is lazy-loaded by views/chatbot/chatbot.js on
// first navigation to the chatbot page. Keeping the static import here would
// pull it into the main.js module graph and download it on every login.

window.addEventListener('error', (event: ErrorEvent) => {
  console.error('[Minallo] Unhandled error:', event.error || event.message);
});

window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  console.error('[Minallo] Unhandled promise rejection:', event.reason);
});

// Eager: affects first paint or core infrastructure.
initSidebarIcons();
initPdfWorker();
initDocumentRail();

// Deferred: not needed before the first navigation. Run in idle time so they
// don't block the main thread during boot. Falls back to setTimeout(0) when
// requestIdleCallback isn't available (Safari pre-2023, some embedded WebViews).
const runIdle = (fn: () => void): void => {
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
  if (typeof ric === 'function') {
    ric(fn, { timeout: 8000 });
  } else {
    setTimeout(fn, 4000);
  }
};

const runDelayed = (fn: () => void, ms = 20000): void => {
  setTimeout(fn, ms);
};

function lazyImport(path: string): Promise<Record<string, unknown>> {
  // Keep the URL non-literal at parse time. Some browsers/CDN transforms can
  // discover literal import('...') targets immediately, defeating the delay.
  return import(/* @vite-ignore */ path);
}

runIdle(() => lazyImport('./core/' + 'pull-to-refresh.js').then((m) => (m.initPullToRefresh as () => void)()));
runIdle(() => lazyImport('./core/' + 'console-filter.js').then((m) => (m.initConsoleFilter as () => void)()));
runDelayed(() => lazyImport('./features/admin/' + 'admin-panel.js').then((m) => (m.initAdminPanel as () => void)()));
runDelayed(() => lazyImport('./features/auth/' + 'onboarding.js').then((m) => (m.initOnboarding as () => void)()));
// AI Fair-Use banner — checks usage on portal load and renders the banner
// once the user crosses 80% of the monthly cap. Cheap: one GET request,
// no further work unless the response triggers the banner.
runDelayed(() => lazyImport('./services/' + 'ai-usage.js').then((m) => (m.initAiUsage as () => void)()), 12000);
runDelayed(() => lazyImport('./features/study-lounge/' + 'lounge.js').then((m) => (m.initStudyLounge as () => void)()));
runDelayed(() => lazyImport('./features/music/' + 'music-services.js').then((m) => (m.initMusicServices as (opts: unknown) => void)({
  sb: window._sb as never,
  getCurrentUser: () => window._currentUser ?? null,
  applyUserTypeUI: () => {
    if (typeof window._applyUserTypeUI === 'function') {
      window._applyUserTypeUI();
    }
  },
  showToast: (title: string, sub?: string) => {
    if (typeof window.showToast === 'function') window.showToast(title, sub);
  },
})));
runDelayed(() => lazyImport('./features/study-timer/' + 'study-timer.js').then((m) => (m.initStudyTimer as () => void)()));
runDelayed(() => lazyImport('./features/writing-coach/' + 'writing-coach.js').then((m) => (m.initWritingCoach as () => void)()));

// Notifications shell: the portal section #psec-notifications is scaffolded
// UI without a backend feed yet. Wire #notifMarkAll so the button gives
// the user feedback instead of looking broken. Once a real notifications
// table exists we can swap the body for a Supabase update.
runIdle(() => {
  const btn = document.getElementById('notifMarkAll');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const list = document.getElementById('notifList');
    if (list) {
      const items = list.querySelectorAll<HTMLElement>('.notif-item');
      items.forEach((el) => el.classList.remove('is-unread'));
    }
    const count = document.getElementById('notifCount');
    if (count) {
      // i18n: prefer the "all caught up" translation if it has been
      // injected; fall back to the literal default that lives in the
      // HTML data-i18n attribute.
      count.textContent = count.dataset.allCaughtText || 'All caught up';
    }
    const original = btn.textContent;
    btn.textContent = '✓';
    (btn as HTMLButtonElement).disabled = true;
    setTimeout(() => {
      (btn as HTMLButtonElement).disabled = false;
      if (original) btn.textContent = original;
    }, 1200);
    if (typeof window.showToast === 'function') {
      window.showToast('Notifications', 'All marked as read.');
    }
  });
});

// @ts-ignore — dynamic import with cache-busting query string
import('./app.js?v=7');
