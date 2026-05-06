// Centralized localStorage/sessionStorage helpers.
// Features should read/write through these instead of calling localStorage directly.

export function getItem(key, defaultValue) {
  try {
    var val = localStorage.getItem(key);
    return val !== null ? val : defaultValue !== undefined ? defaultValue : null;
  } catch (e) {
    return defaultValue !== undefined ? defaultValue : null;
  }
}

export function setItem(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {}
}

export function removeItem(key) {
  try {
    localStorage.removeItem(key);
  } catch (e) {}
}

export function getJson(key, defaultValue) {
  try {
    var raw = localStorage.getItem(key);
    return raw !== null ? JSON.parse(raw) : defaultValue !== undefined ? defaultValue : null;
  } catch (e) {
    return defaultValue !== undefined ? defaultValue : null;
  }
}

export function setJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {}
}

// App state persistence (ss_state)
export function loadAppState() {
  return getJson('ss_state', {});
}

export function saveAppState(state) {
  setJson('ss_state', state);
}

// User settings
export function loadSettings() {
  return {
    dark: getItem('ss_dark') === 'true',
    lang: getItem('ss_lang', 'en'),
    autoOpenAI: getItem('ss_auto_open_ai') === 'true',
    saveChatHistory: getItem('ss_save_chat') !== 'false'
  };
}

export function saveSetting(key, value) {
  setItem(key, String(value));
}

// Per-file chat history
export function loadChat(filename) {
  return getJson('ss_chat_' + filename, []);
}

export function saveChat(filename, messages) {
  setJson('ss_chat_' + filename, messages);
}

export function clearChat(filename) {
  removeItem('ss_chat_' + filename);
}
