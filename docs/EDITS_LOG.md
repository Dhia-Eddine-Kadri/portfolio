# StudySphere — Edit Log

## Session: 2026-03-26 — Persist Portal Section Across Refresh

**User request:** "When I refresh the website it should always stay at the same page that I was at, not return to the homepage."

**File modified:** `app.js`

---

### Root Cause
`saveState()` had an early return whenever the portal was visible:
```js
if(portalVisible) return; // don't save portal state
```
This meant navigating to Profile / Settings / Subscription never saved anything to localStorage. On refresh, `_enterApp()` always defaulted to the Dashboard.

---

### Edit 1 — Added `activePortalSection` variable
**Location:** line ~808, next to `var activeCourseRef=null,activeCourseSection='files';`

**Added:**
```js
var activePortalSection='dashboard';
```
Tracks which portal section (dashboard / profile / settings / subscription) is currently visible.

---

### Edit 2 — Rewrote `saveState()`
**Location:** line ~165

**Before:**
```js
function saveState(){
  try{
    var portalVisible = document.getElementById('portal').classList.contains('show');
    if(portalVisible) return; // don't save portal state
    var st={
      semId: activeSemId,
      courseId: activeCourseId,
      fileName: activeFileName,
      section: activeCourseSection,
      inApp: true
    };
    localStorage.setItem('ss_state', JSON.stringify(st));
  }catch(e){}
}
```

**After:**
```js
function saveState(){
  try{
    var portalVisible = document.getElementById('portal').classList.contains('show');
    var st;
    if(portalVisible){
      st={ inApp: false, portalSection: activePortalSection || 'dashboard' };
    } else {
      st={
        semId: activeSemId,
        courseId: activeCourseId,
        fileName: activeFileName,
        section: activeCourseSection,
        inApp: true
      };
    }
    localStorage.setItem('ss_state', JSON.stringify(st));
  }catch(e){}
}
```
Instead of skipping the save, now writes `{ inApp: false, portalSection: '...' }` when on the portal.

---

### Edit 3 — Updated `showPortal()` setTimeout to include `portalSection`
**Location:** line ~116 (inside `showPortal()`'s setTimeout callback)

**Before:**
```js
try{var st=JSON.parse(localStorage.getItem('ss_state')||'{}');st.inApp=false;localStorage.setItem('ss_state',JSON.stringify(st));}catch(e){}
```

**After:**
```js
try{var st=JSON.parse(localStorage.getItem('ss_state')||'{}');st.inApp=false;st.portalSection=activePortalSection||'dashboard';localStorage.setItem('ss_state',JSON.stringify(st));}catch(e){}
```
Also persists the active section when navigating back to the portal.

---

### Edit 4 — Updated `showPortalSection` wrapper to track section + save state
**Location:** line ~2028

**Before:**
```js
var _origShowPortalSection = showPortalSection;
showPortalSection = function(sec) {
  _origShowPortalSection(sec);
  _ssPushHistory(
    { view: 'portal', section: sec || 'dashboard' },
    '#portal=' + encodeURIComponent(sec || 'dashboard')
  );
};
```

**After:**
```js
var _origShowPortalSection = showPortalSection;
showPortalSection = function(sec) {
  activePortalSection = sec || 'dashboard';
  _origShowPortalSection(sec);
  saveState();
  _ssPushHistory(
    { view: 'portal', section: sec || 'dashboard' },
    '#portal=' + encodeURIComponent(sec || 'dashboard')
  );
};
```
Now updates `activePortalSection` and calls `saveState()` every time a section is switched.

---

### Edit 5 — Added `ss-ready` listener to restore portal section on refresh
**Location:** line ~2046 (just before the existing `popstate` listener)

**Added:**
```js
window.addEventListener('ss-ready', function(){
  setTimeout(function(){
    try{
      var raw=localStorage.getItem('ss_state');
      if(!raw)return;
      var st=JSON.parse(raw);
      if(st&&!st.inApp&&st.portalSection&&st.portalSection!=='dashboard'){
        var navMap={profile:'psbProfile',settings:'psbSettings',subscription:'psbSubscription'};
        setNavActive(navMap[st.portalSection]||'psbDashboard');
        _origShowPortalSection(st.portalSection);
        activePortalSection=st.portalSection;
      }
    }catch(e){}
  },200);
});
```
After the app finishes loading on refresh (200ms delay lets `_enterApp` complete), reads `portalSection` from localStorage and jumps directly to the saved section — skipping Dashboard for Profile, Settings, or Subscription.

---

### How It All Works Together

| Action | What happens |
|--------|-------------|
| User clicks "Settings" nav pill | `showPortalSection('settings')` → sets `activePortalSection='settings'` → `saveState()` writes `{inApp:false, portalSection:'settings'}` to localStorage |
| User refreshes | `ss-ready` fires → 200ms later reads localStorage → sees `portalSection='settings'` → calls `_origShowPortalSection('settings')` + `setNavActive('psbSettings')` |
| User is in PDF viewer and refreshes | `inApp:true` in state → `_enterApp` restores course/file view as before (unchanged behaviour) |
