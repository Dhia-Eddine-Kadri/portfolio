// New chatbot shell (PR-01). Flag-gated behind localStorage.ss_new_chatbot === '1'.
// Hides the existing #aipOuter and reveals #ncbRoot. Idempotent.

export function initNewChatbotShell(): void {
  let flag: string | null = null;
  try {
    flag = localStorage.getItem('ss_new_chatbot');
  } catch {
    // private browsing / storage disabled — leave flag null
  }
  if (flag !== '1') return;

  const newRoot = document.getElementById('ncbRoot') as HTMLElement | null;
  if (!newRoot) return;

  const oldRoot = document.getElementById('aipOuter') as HTMLElement | null;
  if (oldRoot) oldRoot.style.display = 'none';

  newRoot.hidden = false;
  newRoot.style.display = '';
}

(window as unknown as { initNewChatbotShell?: () => void }).initNewChatbotShell = initNewChatbotShell;
