export function initSemesterDropdown(options) {
  options = options || {};

  var sdSemBtn = document.getElementById('sdSemBtn');
  var sdSemDD = document.getElementById('sdSemDD');
  var sdSemDot = document.getElementById('sdSemDot');
  var sdSemLabel = document.getElementById('sdSemLabel');
  var sdSemChev = document.getElementById('sdSemChev');
  if (!sdSemBtn || !sdSemDD || !sdSemDot || !sdSemLabel || !sdSemChev) return;

  var sdDdOpen = false;

  sdSemBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    sdDdOpen = !sdDdOpen;
    sdSemDD.classList.toggle('open', sdDdOpen);
    sdSemBtn.classList.toggle('open', sdDdOpen);
    sdSemChev.classList.toggle('up', sdDdOpen);
  });

  sdSemDD.querySelectorAll('.sem-opt').forEach(function (o) {
    o.addEventListener('click', function () {
      options.setActiveSemesterId(o.getAttribute('data-sid'));
      sdSemLabel.textContent = o.textContent.trim();
      sdSemDot.style.background = o.getAttribute('data-col');
      sdSemDD.querySelectorAll('.sem-opt').forEach(function (x) {
        x.classList.remove('sel');
      });
      o.classList.add('sel');
      sdDdOpen = false;
      sdSemDD.classList.remove('open');
      sdSemBtn.classList.remove('open');
      sdSemChev.classList.remove('up');
      options.renderCourses();
    });
  });

  document.addEventListener('click', function (e) {
    if (sdDdOpen && !e.target.closest('#sdSemBtn') && !e.target.closest('#sdSemDD')) {
      sdDdOpen = false;
      sdSemDD.classList.remove('open');
      sdSemBtn.classList.remove('open');
      sdSemChev.classList.remove('up');
    }
  });
}
