var toastTimer = null;

function showToast(title, sub) {
  var toast = document.getElementById('ss-toast');
  document.getElementById('ss-toast-title').textContent = title;
  document.getElementById('ss-toast-sub').textContent = sub || 'From StudySphere Extension';
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () {
    toast.classList.remove('show');
  }, 6000);
}

window.showToast = showToast;
