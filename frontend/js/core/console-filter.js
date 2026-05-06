export function initConsoleFilter() {
  var _w = console.warn.bind(console);
  var _e = console.error.bind(console);
  var sup = ['fake worker', 'TT:', 'undefined function', 'scale-factor'];

  console.warn = function () {
    var m = Array.prototype.join.call(arguments, ' ');
    if (
      sup.some(function (s) {
        return m.indexOf(s) !== -1;
      })
    ) {
      return;
    }
    _w.apply(console, arguments);
  };

  console.error = function () {
    var m = Array.prototype.join.call(arguments, ' ');
    if (
      sup.some(function (s) {
        return m.indexOf(s) !== -1;
      })
    ) {
      return;
    }
    _e.apply(console, arguments);
  };
}
