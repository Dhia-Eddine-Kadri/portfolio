export function closeAllOpts() {
  document.querySelectorAll('.chip-drawer').forEach(function (el) {
    el.classList.remove('open');
  });
}

export function chipPrompt(type, level) {
  var pdfFullText = window.pdfFullText || '';
  var activeFileName = window.activeFileName || '';
  var hasDoc = !!pdfFullText;
  var base = hasDoc
    ? 'Using ONLY the content of the document "' +
      activeFileName +
      '" provided in the system prompt, '
    : 'As a knowledgeable tutor, ';
  if (!hasDoc && window.addBotMsg && window._t) window.addBotMsg(window._t('ai_tip_no_pdf'));

  var prompts = {
    summarise: {
      small:
        base +
        'give me a SHORT summary of the document in exactly 3 bullet points. Each bullet must be one sentence only. No intro, no outro, just the 3 bullets.',
      medium:
        base +
        'give me a MEDIUM summary of the document. Structure it with: ## 📝 Overview (3-4 sentences), ## 🔑 Main Topics (bullet points), ## 💡 Key Takeaways (3-5 points).',
      thorough:
        base +
        'give me a THOROUGH and detailed summary of the entire document. Cover every section in depth. Structure it with: ## 📝 Overview, ## 🔑 Main Topics (with sub-points for each), ## 🔢 Formulas Mentioned, ## 💡 Key Takeaways, ## 📌 Things to Remember for the Exam.'
    },
    formulas:
      base +
      'extract and explain every formula, equation and mathematical expression in the document. For each one: show the formula, define every symbol, and give a brief explanation of what it calculates.',
    quiz: {
      easy:
        base +
        'create an EASY quiz of 6 questions based on the document. Focus on basic definitions and straightforward facts. After each question provide the answer with a simple explanation.',
      medium:
        base +
        'create a MEDIUM difficulty quiz of 8 questions based on the document. Mix multiple choice and open questions requiring understanding. After each question provide the answer and explanation.',
      hard:
        base +
        'create a HARD quiz of 10 challenging questions based on the document. Include calculation problems, tricky concepts, and application questions. After each question provide a detailed answer and explanation.'
    },
    keyideas:
      base +
      'identify and explain the 8-10 most important concepts and key ideas from the document. For each concept give a clear definition and explain why it matters.',
    analogy:
      base +
      'explain the main concepts from the document using simple real-world analogies that an engineering student would understand easily. Make each analogy vivid and memorable.'
  };

  var prompt = typeof prompts[type] === 'object' ? prompts[type][level || 'medium'] : prompts[type];
  closeAllOpts();
  if (window.askAI) window.askAI(prompt);
}

export function initChipListeners() {
  (
    document.getElementById('chip-summarise') || { addEventListener: function () {} }
  ).addEventListener('click', function () {
    closeAllOpts();
    var opts = document.getElementById('opts-summarise');
    if (opts) opts.classList.toggle('open');
  });
  (document.getElementById('chip-quiz') || { addEventListener: function () {} }).addEventListener(
    'click',
    function () {
      closeAllOpts();
      var opts = document.getElementById('opts-quiz');
      if (opts) opts.classList.toggle('open');
    }
  );
  (
    document.getElementById('chip-formulas') || { addEventListener: function () {} }
  ).addEventListener('click', function () {
    closeAllOpts();
    chipPrompt('formulas');
  });
  (
    document.getElementById('chip-keyideas') || { addEventListener: function () {} }
  ).addEventListener('click', function () {
    closeAllOpts();
    chipPrompt('keyideas');
  });
  (
    document.getElementById('chip-analogy') || { addEventListener: function () {} }
  ).addEventListener('click', function () {
    closeAllOpts();
    chipPrompt('analogy');
  });

  document.querySelectorAll('.chip-sub').forEach(function (opt) {
    opt.addEventListener('click', function () {
      chipPrompt(opt.getAttribute('data-type'), opt.getAttribute('data-level'));
    });
  });
}
