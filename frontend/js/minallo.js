(function () {
  if (window.Minallo && window.Minallo.version) return;

  var state = {};
  var events = {};
  var features = {};
  var ready = {};

  function clone(value) {
    if (!value || typeof value !== 'object') return value;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (err) {
      return value;
    }
  }

  function on(name, handler) {
    if (!name || typeof handler !== 'function') return function () {};
    events[name] = events[name] || [];
    events[name].push(handler);
    return function () {
      off(name, handler);
    };
  }

  function off(name, handler) {
    var list = events[name];
    if (!list) return;
    events[name] = list.filter(function (fn) {
      return fn !== handler;
    });
  }

  function emit(name, detail) {
    var payload = detail || {};
    (events[name] || []).slice().forEach(function (handler) {
      try {
        handler(payload);
      } catch (err) {
        console.error('Minallo event handler failed:', name, err);
      }
    });
    document.dispatchEvent(new CustomEvent('minallo:' + name, { detail: payload }));
  }

  function setState(patch) {
    if (!patch || typeof patch !== 'object') return clone(state);
    Object.keys(patch).forEach(function (key) {
      state[key] = patch[key];
    });
    emit('state:change', clone(state));
    return clone(state);
  }

  function getState(key) {
    return key ? clone(state[key]) : clone(state);
  }

  function summarizeUser(user) {
    if (!user || typeof user !== 'object') return null;
    return {
      id: user.id || null,
      email: user.email || null
    };
  }

  function setAuth(status, detail) {
    var payload = Object.assign({}, detail || {});
    var auth = {
      status: status,
      source: payload.source || null,
      user: summarizeUser(payload.user)
    };
    state.auth = auth;
    emit('auth:' + status, auth);
    emit('auth:change', auth);
    return clone(auth);
  }

  function registerFeature(name, definition) {
    if (!name) return null;
    features[name] = Object.assign({ name: name }, definition || {});
    emit('feature:registered', features[name]);
    return features[name];
  }

  function getFeature(name) {
    return name ? features[name] : Object.assign({}, features);
  }

  function markReady(name, detail) {
    ready[name] = true;
    emit('ready:' + name, detail || {});
  }

  function isReady(name) {
    return !!ready[name];
  }

  window.Minallo = {
    version: '1.0.0',
    on: on,
    off: off,
    emit: emit,
    setState: setState,
    getState: getState,
    setAuth: setAuth,
    registerFeature: registerFeature,
    getFeature: getFeature,
    markReady: markReady,
    isReady: isReady
  };
})();
