import { checkAdminStatus, searchUsers, setUserPlan } from '../../services/admin-service.js';

export function adminShowIfEligible(user) {
  var btn = document.getElementById('psbAdmin');
  if (!btn || !user) return;
  btn.style.display = 'none';
  checkAdminStatus()
    .then(function (data) {
      if (data && data.isAdmin) btn.style.display = '';
    })
    .catch(function () {});
}

export function initAdminPanel() {
  var searchBtn = document.getElementById('adminSearchBtn');
  var searchInput = document.getElementById('adminSearchInput');
  var navBtn = document.getElementById('psbAdmin');

  if (navBtn) {
    navBtn.addEventListener('click', function () {
      if (typeof window.showPortal === 'function') window.showPortal();
      if (typeof window.setNavActive === 'function') window.setNavActive('psbAdmin');
      if (typeof window.showPortalSection === 'function') window.showPortalSection('admin');
    });
  }
  if (searchBtn) searchBtn.addEventListener('click', adminSearch);
  if (searchInput)
    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') adminSearch();
    });
}

async function adminSearch() {
  var q = (document.getElementById('adminSearchInput').value || '').trim();
  var results = document.getElementById('adminResults');
  if (!q) return;
  results.innerHTML =
    '<div style="color:var(--on-glass-muted);font-size:.85rem">Searching...</div>';
  try {
    var users = await searchUsers(q);
    if (!Array.isArray(users) || !users.length) {
      results.innerHTML =
        '<div style="color:var(--on-glass-muted);font-size:.85rem">No users found.</div>';
      return;
    }
    results.innerHTML = '';
    users.forEach(function (u) {
      var isPro = u.plan === 'pro' && u.status === 'active';
      var joined = u.created_at ? new Date(u.created_at).toLocaleDateString() : '';
      var card = document.createElement('div');
      card.style.cssText =
        'background:var(--glass-bg);border:1px solid var(--glass-border);border-radius:14px;padding:14px 18px;margin-bottom:10px;display:flex;align-items:center;gap:12px';

      var info = document.createElement('div');
      info.style.cssText = 'flex:1;min-width:0';

      var emailEl = document.createElement('div');
      emailEl.style.cssText = 'font-weight:800;color:var(--on-glass);font-size:.88rem';
      emailEl.textContent = u.email || '';

      var joinedEl = document.createElement('div');
      joinedEl.style.cssText = 'font-size:.72rem;color:var(--on-glass-muted)';
      joinedEl.textContent = 'Joined ' + joined;

      var statusEl = document.createElement('div');
      statusEl.style.cssText =
        'font-size:.75rem;margin-top:4px;font-weight:800;color:' + (isPro ? '#22c55e' : '#f87171');
      statusEl.textContent = isPro ? '✓ Pro (subscribed)' : '✕ Free (not subscribed)';

      info.append(emailEl, joinedEl, statusEl);

      var actionBtn = document.createElement('button');
      actionBtn.className = 'sub-btn ' + (isPro ? 'sub-btn-current' : 'sub-btn-upgrade');
      actionBtn.dataset.uid = u.id;
      actionBtn.dataset.pro = isPro;
      actionBtn.style.cssText = 'width:auto;padding:8px 18px;font-size:.78rem';
      actionBtn.textContent = isPro ? 'Revoke Pro' : 'Grant Pro';

      actionBtn.addEventListener('click', async function () {
        var uid = this.dataset.uid;
        var grantPro = this.dataset.pro === 'false';
        this.textContent = '...';
        this.disabled = true;
        try {
          await setUserPlan(uid, grantPro ? 'pro' : 'free');
          if (typeof window.showToast === 'function')
            window.showToast(grantPro ? '✓ Pro granted' : 'Pro revoked', u.email);
          adminSearch();
        } catch (e) {
          if (typeof window.showToast === 'function') window.showToast('Error', e.message);
          this.disabled = false;
        }
      });

      card.append(info, actionBtn);
      results.appendChild(card);
    });
  } catch (e) {
    results.innerHTML =
      '<div style="color:#f87171;font-size:.85rem">Error: ' + e.message + '</div>';
  }
}
