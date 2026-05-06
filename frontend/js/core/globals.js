export function exposeLegacyVar(name, getValue, setValue) {
  try {
    Object.defineProperty(window, name, {
      configurable: true,
      get: getValue,
      set: setValue || function () {}
    });
  } catch (e) {}
}

export function publishLegacyGlobals(bindings) {
  Object.keys(bindings || {}).forEach(function (key) {
    window[key] = bindings[key];
  });
}
