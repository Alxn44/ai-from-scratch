/**
 * The lesson card is part of the teaching material, not a UI label.  The
 * database keeps the Spanish source of record, while this small catalog holds
 * the authored English card that accompanies the bilingual lesson prose.
 */
export interface LessonMeta {
  eyebrow: string;
  title: string;
  summary: string;
  math: string;
  math_cap: string;
}

const EN: Record<number, LessonMeta> = {
  1: { eyebrow: 'AI', title: 'It learns from examples', summary: 'Nobody writes rules for it. It finds resemblance across thousands of examples on its own.', math: '100,000', math_cap: 'cat photos to learn what a cat is. You only need three.' },
  2: { eyebrow: 'HOW IT IMPROVES', title: 'Hot and cold', summary: 'For a model, improvement is one thing: the number for how far off it was goes down.', math: '94 -> 23 -> 4', math_cap: 'that is how practice lowers error. Training means making it drop.' },
  3: { eyebrow: 'WHERE IT LIVES', title: 'It all lives in dials', summary: 'What it learned is not photos or sentences. It is millions of adjusted numbers.', math: '70,000,000,000', math_cap: 'dials a large model has. Each is just a number.' },
  4: { eyebrow: 'WHY IT DOES NOT CHANGE', title: 'It does not learn from you', summary: 'Studying and answering are separate moments. By the time you talk to it, studying is over.', math: 'once', math_cap: 'it trains, at a cost of millions. Answering costs cents.' },
  5: { eyebrow: 'HOW IT READS', title: 'It reads chunks: tokens', summary: 'It does not see words or letters. It cuts your text into chunks and works with those.', math: '3 words = 5 tokens', math_cap: 'everything is measured and billed in tokens.' },
  6: { eyebrow: 'HOW IT WRITES', title: 'It picks the next token', summary: 'It weighs options, picks one token, then calculates again with the new text.', math: '31 out of 100', math_cap: 'the probabilities for every option add up to 100.' },
  7: { eyebrow: 'HOW TO ASK', title: 'The formula for a good prompt', summary: 'It cannot guess what is in your head. Your explanation is everything it receives.', math: 'what + for whom + how', math_cap: 'that is the whole formula. Anything you omit becomes generic.' },
  8: { eyebrow: 'ITS MEMORY', title: 'The table fills up', summary: 'It can only keep a limited amount of a conversation in view at once.', math: 'tokens', math_cap: 'the limit changes by model. Older material can fall out.' },
  9: { eyebrow: 'ITS DIAL', title: 'Serious or creative: you choose', summary: 'Temperature decides whether it plays safe or takes a chance on unusual options.', math: '99 out of 100', math_cap: 'times the top option wins with the dial turned down.' },
  10: { eyebrow: 'ITS RISK', title: 'It makes things up confidently', summary: 'It has no built-in “I do not know” switch. When data is missing, it can assemble a convincing answer.', math: 'sounds right != true', math_cap: 'its score measures how plausible it sounds, not whether it is true.' },
  11: { eyebrow: 'ITS DATE', title: 'Its memory has a date', summary: 'It studied until a particular day. Later events do not exist unless it searches for them.', math: 'memory: yesterday', math_cap: 'internet: today. Connected, it stops guessing.' },
  12: { eyebrow: 'START TODAY', title: 'Copy, paste, done', summary: 'It is a tool to think and produce faster. It does not decide for you.', math: '5 minutes a day', math_cap: 'are enough to get the hang of it.' },
};

/** Overlay the card in the requested language. Spanish remains the database
 * source and any language without an authored card falls back to it. */
export function localizeLesson<T extends { n: number }>(lesson: T, lang: string): T {
  const translation = lang === 'en' ? EN[lesson.n] : undefined;
  return translation ? { ...lesson, ...translation } : lesson;
}
