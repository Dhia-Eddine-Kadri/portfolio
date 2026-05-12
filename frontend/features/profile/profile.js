(function () {
  var feature = {
    sectionId: 'psec-profile',
    html: 'features/profile/profile.html',
    css: 'features/profile/profile.css'
  };
  if (window.Minallo) {
    window.Minallo.registerFeature('profile', feature);
  } else {
    window.MinalloFeatures = window.MinalloFeatures || {};
    window.MinalloFeatures.profile = feature;
  }

  var section = document.getElementById('psec-profile');
  if (section) section.dataset.feature = 'profile';
})();

async function saveProfile() {
  if (!_currentUser) {
    showToast(_t('toast_sign_in'), '');
    return;
  }
  var data = {
    id: _currentUser.id,
    full_name: (document.getElementById('profileName') || {}).value || '',
    email: (document.getElementById('profileEmail') || {}).value || '',
    auth_email: _currentUser.email || '',
    university: (document.getElementById('profileUniversity') || {}).value || '',
    programme: (document.getElementById('profileProgramme') || {}).value || '',
    vertiefung: (document.getElementById('profileVertiefung') || {}).value || '',
    matrikel: (document.getElementById('profileMatrikel') || {}).value || '',
    updated_at: new Date().toISOString()
  };
  try {
    var _pr = await _sb.from('profiles').upsert(data);
    if (_pr && _pr.error) {
      var _fb = Object.assign({}, data);
      delete _fb.vertiefung;
      await _sb.from('profiles').upsert(_fb);
    }
    showToast(_t('toast_profile_saved'), _t('toast_profile_saved_sub'));
    if (data.vertiefung) {
      _userVertiefung = data.vertiefung;
      localStorage.setItem('ss_vertiefung', data.vertiefung);
    }
    if (data.programme) {
      var _spRaw = data.programme.split(',')[0].trim();
      var _spM = MAJOR_LIST.find(function (m) {
        return m.toLowerCase() === _spRaw.toLowerCase();
      });
      if (_spM) {
        _userMajor = _spM;
        localStorage.setItem('ss_major', _spM);
      }
    }
    try {
      localStorage.setItem('profile_cache_' + _currentUser.id, JSON.stringify(data));
    } catch (e) {}
    var init = document.getElementById('profileInitial');
    if (init && data.full_name) init.textContent = data.full_name.charAt(0).toUpperCase();
    updateAuthIndicator(_currentUser);
  } catch (e) {
    showToast(_t('toast_save_failed'), String(e));
  }
}

(function bindProfileControls() {
  var profileSaveBtn = document.querySelector('.profile-save-btn');
  if (profileSaveBtn) {
    profileSaveBtn.addEventListener('click', saveProfile);
  }
})();
