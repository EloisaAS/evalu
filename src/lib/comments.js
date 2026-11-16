// Comment analysis: tags each written comment as positive / negative / mixed / neutral, marks suggestions,
// and finds the topics it talks about. Built-in word lists for English and Filipino/Taglish; it runs inside
// evalU, so the confidential comments are never sent to an outside AI service.
// It is a reading aid: it can miss sarcasm or unusual wording, so the comments themselves stay on screen.

const POSITIVE = [
  'good', 'great', 'excellent', 'clear', 'clearly', 'helpful', 'kind', 'approachable', 'patient', 'engaging', 'interesting',
  'organized', 'prepared', 'fair', 'knowledgeable', 'understandable', 'enjoy', 'enjoyed', 'love', 'loved', 'best', 'effective',
  'informative', 'inspiring', 'respectful', 'supportive', 'nice', 'awesome', 'amazing', 'well', 'friendly', 'fun', 'thank', 'thanks',
  'dedication', 'dedicated', 'passionate', 'creative', 'consistent', 'consistently', 'improved', 'outstanding', 'appreciate',
  'magaling', 'galing', 'mabait', 'malinaw', 'maayos', 'masaya', 'salamat', 'sulit', 'matiyaga', 'masipag',
];
const NEGATIVE = [
  'late', 'absent', 'unclear', 'confusing', 'confused', 'boring', 'rude', 'unfair', 'unprepared', 'disorganized', 'poor', 'bad',
  'lack', 'lacks', 'lacking', 'delayed', 'noisy', 'favoritism', 'yell', 'yelling', 'shout', 'shouting', 'hard', 'difficult',
  'difficulty', 'struggle', 'worst', 'lazy', 'careless', 'intimidating', 'too',
  'masungit', 'sungit', 'magulo', 'huli', 'kulang', 'mahirap', 'nakakainip', 'nakakatakot', 'pabaya', 'walang',
];
// words that turn the next words around ("not clear", "hindi malinaw")
const NEGATORS = ['not', 'no', 'never', "don't", 'dont', "doesn't", 'doesnt', "isn't", 'isnt', "wasn't", 'wasnt', 'hardly', 'hindi', 'di', 'wala'];
// a request or advice for the person, usually what to improve
const SUGGESTION = ['please', 'should', 'sana', 'wish', 'need to', 'needs to', 'sooner', 'more', 'less', 'pakiusap', 'dapat', 'paki'];
// these also match longer forms ("hopefully", "improvement"); the others must be the exact word ("less" is not "lessons")
const SUGGESTION_STEMS = ['hope', 'improve', 'recommend'];

export const TOPICS = {
  clarity: { label: 'Clarity of teaching', words: ['explain', 'explanation', 'clear', 'unclear', 'understand', 'confusing', 'discussion', 'lesson', 'lecture', 'teach', 'malinaw', 'paliwanag', 'intindi', 'turo', 'magturo'] },
  feedback: { label: 'Feedback and grading', words: ['feedback', 'grade', 'grading', 'score', 'checked', 'return', 'corrected', 'rubric', 'quiz', 'quizzes', 'exam', 'test', 'marka', 'output'] },
  punctuality: { label: 'Punctuality and attendance', words: ['late', 'absent', 'on time', 'punctual', 'attendance', 'early', 'huli', 'pumapasok'] },
  preparation: { label: 'Preparation and materials', words: ['prepared', 'unprepared', 'module', 'material', 'slides', 'ppt', 'handout', 'organized', 'disorganized', 'syllabus', 'handa'] },
  approach: { label: 'Approachability and respect', words: ['kind', 'approachable', 'respect', 'rude', 'patient', 'friendly', 'strict', 'consult', 'mabait', 'masungit', 'sungit', 'yell', 'shout', 'favoritism', 'intimidating'] },
  pace: { label: 'Pace and workload', words: ['fast', 'slow', 'pace', 'workload', 'homework', 'requirement', 'deadline', 'too many', 'mabilis', 'marami', 'dami'] },
  activities: { label: 'Class activities and engagement', words: ['activity', 'activities', 'classroom', 'engaging', 'interactive', 'boring', 'fun', 'interesting', 'group', 'recitation', 'participation', 'masaya', 'nakakainip'] },
  language: { label: 'Language and communication', words: ['english', 'filipino', 'voice', 'speak', 'communication', 'loud', 'boses', 'salita'] },
  growth: { label: 'Professional growth', words: ['research', 'seminar', 'training', 'graduate', 'masters', 'doctorate', 'degree', 'studies', 'publication', 'workshop'] },
};

const norm = (t) => String(t || '').toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9ñ' ]+/g, ' ').replace(/\s+/g, ' ').trim();
const tokensOf = (t) => norm(t).split(' ').filter(Boolean);
/** A word matches the same word, or a longer form of it ("explain" → "explained", "explanation"). */
const wordHit = (tok, kw) => tok === kw || (kw.length >= 4 && tok.startsWith(kw));
const hasPhrase = (text, toks, kw) => (kw.includes(' ') ? ` ${text} `.includes(` ${kw} `) : toks.some((t) => wordHit(t, kw)));

// short phrases that mean more than their words (negative ones are checked first: "not on time")
const NEGATIVE_PHRASES = ['not on time', 'does not return', "doesn't return", 'doesnt return', 'hard to understand', 'hard to follow', 'hindi pumapasok', 'walang feedback'];
const POSITIVE_PHRASES = ['on time', 'easy to understand', 'easy to follow', 'very helpful', 'well explained'];

/** Analyse one comment: { sentiment, suggestion, topics, positive: [...words], negative: [...words] }. */
export function analyzeComment(text) {
  const t = norm(text);
  const pos = [], neg = [];
  let rest = ` ${t} `;
  for (const ph of NEGATIVE_PHRASES) if (rest.includes(` ${ph} `)) { neg.push(ph); rest = rest.replace(` ${ph} `, ' '); }
  for (const ph of POSITIVE_PHRASES) if (rest.includes(` ${ph} `)) { pos.push(ph); rest = rest.replace(` ${ph} `, ' '); }
  const toks = tokensOf(rest);
  toks.forEach((tok, i) => {
    const isPos = POSITIVE.some((k) => wordHit(tok, k)), isNeg = NEGATIVE.some((k) => wordHit(tok, k));
    if (!isPos && !isNeg) return;
    // "not clear", "hindi malinaw", "not very helpful": a negator up to 2 words before turns it around
    const flipped = toks.slice(Math.max(0, i - 2), i).some((w) => NEGATORS.includes(w));
    if (tok === 'too' || tok === 'walang') { neg.push(tok); return; } // "too fast", "walang feedback"
    if (isPos) (flipped ? neg : pos).push(flipped ? `not ${tok}` : tok);
    else if (isNeg) (flipped ? pos : neg).push(flipped ? `not ${tok}` : tok);
  });
  const suggestion = SUGGESTION.some((k) => (k.includes(' ') ? hasPhrase(t, toks, k) : toks.includes(k))) || SUGGESTION_STEMS.some((k) => toks.some((w) => w.startsWith(k)));
  const sentiment = pos.length && neg.length ? 'mixed' : pos.length ? 'positive' : neg.length ? 'negative' : 'neutral';
  const topics = Object.entries(TOPICS).filter(([, x]) => x.words.some((k) => hasPhrase(t, toks, k))).map(([k]) => k);
  return { sentiment, suggestion, topics, positive: pos, negative: neg };
}

/** Summary of many comments: counts per sentiment and per topic (with how many of them were negative). */
export function summarizeComments(texts) {
  const list = texts.filter((x) => x && String(x).trim()).map((x) => ({ text: x, ...analyzeComment(x) }));
  const count = (s) => list.filter((x) => x.sentiment === s).length;
  const topics = Object.keys(TOPICS).map((k) => {
    const xs = list.filter((x) => x.topics.includes(k));
    return { key: k, label: TOPICS[k].label, count: xs.length, negative: xs.filter((x) => x.sentiment === 'negative' || x.sentiment === 'mixed').length, positive: xs.filter((x) => x.sentiment === 'positive').length };
  }).filter((x) => x.count).sort((a, b) => b.count - a.count);
  return { total: list.length, positive: count('positive'), negative: count('negative'), mixed: count('mixed'), neutral: count('neutral'), suggestions: list.filter((x) => x.suggestion).length, topics, list };
}

export const SENTIMENT_LABEL = { positive: 'Positive', negative: 'Negative', mixed: 'Mixed', neutral: 'Neutral' };
