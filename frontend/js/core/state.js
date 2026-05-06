// Central application state.
// Modules should read/write through these exports instead of using bare globals.
// Global window bridges are kept for backward compatibility with legacy inline handlers.

export var appState = {
  activeSemId: 'ws2526',
  activeCourseId: null,
  activeFileName: null,
  activeCourseSection: 'files',
  currentCourseShort: '',
  currentUser: null,
  selectedFiles: new Set(),
  settings: {},

  // PDF viewer state
  pdfDoc: null,
  pdfPage: 1,
  pdfTotal: 0,
  pdfScale: 0.9,
  pdfShowAll: false,
  pdfFullText: ''
};

export function setActiveSem(semId) {
  appState.activeSemId = semId;
}
export function setActiveCourse(courseId) {
  appState.activeCourseId = courseId;
}
export function setActiveFile(fileName) {
  appState.activeFileName = fileName;
}
export function setCurrentUser(user) {
  appState.currentUser = user;
}

// Expose on window for legacy code that reads these as globals
window._appState = appState;
