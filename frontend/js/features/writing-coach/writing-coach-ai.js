// Writing Coach — AI integration module (compiled from writing-coach-ai.ts).
// Real backend call is intentionally not wired yet; analyzeParagraph returns a
// deterministic mock so the UI can be built and verified without spending tokens.
export async function analyzeParagraph(opts) {
    await _wait(900, opts.signal);
    return _mockAnalysis(opts.text, opts.level);
}
function _wait(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
        }
        const t = window.setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => {
            window.clearTimeout(t);
            reject(new DOMException('Aborted', 'AbortError'));
        });
    });
}
function _mockAnalysis(text, level) {
    const trimmed = text.trim();
    const isAdvanced = level === 'B2' || level === 'C1' || level === 'C2';
    const issues = [
        {
            type: 'grammar',
            color: 'red',
            original: 'habe gegangen',
            correction: 'bin gegangen',
            explanation: "The verb 'gehen' takes 'sein' in the Perfekt tense.",
        },
        {
            type: 'grammar',
            color: 'red',
            original: 'in Schule',
            correction: 'in die Schule',
            explanation: 'Movement / direction takes the accusative.',
        },
        {
            type: 'tense',
            color: 'orange',
            original: 'ich mache',
            correction: 'ich habe gemacht',
            explanation: 'The sentence refers to yesterday, so Perfekt is preferred.',
        },
    ];
    const vocab = [
        {
            type: 'vocabulary',
            color: 'yellow',
            original: 'Hausaufgaben machen',
            correction: 'Hausaufgaben erledigen',
            explanation: "'erledigen' sounds more natural and slightly more advanced.",
        },
    ];
    const corrected = trimmed
        ? trimmed
            .replace(/\bhabe\s+gegangen\b/gi, 'bin gegangen')
            .replace(/\bin\s+Schule\b/gi, 'in die Schule')
        : 'Ich bin gestern in die Schule gegangen und habe viele Hausaufgaben gemacht.';
    const improved = isAdvanced
        ? 'Gestern bin ich zur Schule gegangen und habe anschließend meine Hausaufgaben erledigt.'
        : 'Gestern bin ich in die Schule gegangen und habe meine Hausaufgaben gemacht.';
    return {
        correctedText: corrected,
        improvedText: improved,
        estimatedLevel: 'A2/B1',
        issues,
        vocabularySuggestions: vocab,
        practiceTips: [
            'Practice Perfekt with sein and haben.',
            'Review accusative after movement prepositions.',
            'Practice word order with time expressions (gestern, heute, danach).',
        ],
    };
}
