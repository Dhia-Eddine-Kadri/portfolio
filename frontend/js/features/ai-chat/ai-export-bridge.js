import {
  aiMakePdfBlob,
  aiDownloadPdf,
  ufDestPicker,
  glMoveDestPicker,
  aiExportToCourse,
  aiShowExportModal,
  aiResponseActions
} from './ai-export.js';

export function initAiExportBridge() {
  window._aiMakePdfBlob = aiMakePdfBlob;
  window._aiDownloadPdf = aiDownloadPdf;
  window._ufDestPicker = ufDestPicker;
  window._glMoveDestPicker = glMoveDestPicker;
  window._aiExportToCourse = aiExportToCourse;
  window._aiShowExportModal = aiShowExportModal;
  window._aiResponseActions = aiResponseActions;

  document.addEventListener('click', function (e) {
    if (e.target.id === 'aiExportClose' || e.target === document.getElementById('aiExportModal')) {
      var modal = document.getElementById('aiExportModal');
      if (modal) modal.style.display = 'none';
    }
  });

  return {
    aiMakePdfBlob: aiMakePdfBlob,
    aiDownloadPdf: aiDownloadPdf,
    ufDestPicker: ufDestPicker,
    glMoveDestPicker: glMoveDestPicker,
    aiExportToCourse: aiExportToCourse,
    aiShowExportModal: aiShowExportModal,
    aiResponseActions: aiResponseActions
  };
}
