/**
 * Reads multiple-choice questions out of plain text taken from a Word, PDF or PowerPoint file.
 * Marking convention: the correct answer has an asterisk in front, e.g.
 *
 *   1. What is the station's frequency?
 *   A. 88.1 FM
 *   *B. 89.7 FM
 *   C. 90.5 FM
 *
 * Accepted variations: "Q1)", "(A)", "A)", "B. *89.7 FM", options without letters (the asterisk still marks the answer),
 * questions separated by blank lines instead of numbers, and options or questions that wrap onto a second line.
 */
export interface ParsedQuestion { text: string; options: { key: string; text: string }[]; correctKey: string; line: number }
export interface ParseIssue { line: number; message: string }

const QUESTION_START = /^(?:q(?:uestion)?\s*)?(\d{1,3})\s*[.):\-]\s*(.+)$/i;
const OPTION_LETTERED = /^(\*?)\s*\(?([A-Ha-h])\)?\s*[.):\-]\s+(\*?)\s*(.+)$/;
const OPTION_STAR_ONLY = /^\*\s*(.+)$/;
const BULLET = /^[•▪◦·●○■□–—]\s+/;
const MAX_QUESTIONS = 300;

interface Ln { line: number; text: string }
interface Opt { key: string | null; text: string; star: boolean }

const lettered = (t: string): Opt | null => {
  const m = OPTION_LETTERED.exec(t);
  return m ? { key: m[2].toUpperCase(), text: m[4].trim(), star: m[1] === '*' || m[3] === '*' } : null;
};
const starOnly = (t: string): Opt | null => { const m = OPTION_STAR_ONLY.exec(t); return m ? { key: null, text: m[1].trim(), star: true } : null; };

export function parseQuestions(input: string): { questions: ParsedQuestion[]; issues: ParseIssue[] } {
  const raw = input.replace(/\r/g, '').split('\n');
  const issues: ParseIssue[] = [];
  const questions: ParsedQuestion[] = [];

  // 1. Group into blocks: a blank line ends a block, and so does a new numbered question.
  const blocks: Ln[][] = [];
  let cur: Ln[] = [];
  raw.forEach((l, i) => {
    const text = l.replace(BULLET, '').trim();
    if (!text) { if (cur.length) { blocks.push(cur); cur = []; } return; }
    const numbered = QUESTION_START.exec(text);
    const isOption = !!lettered(text) || !!starOnly(text);
    if (numbered && !isOption && cur.length) { blocks.push(cur); cur = []; }
    cur.push({ line: i + 1, text: numbered && !isOption ? numbered[2].trim() : text });
  });
  if (cur.length) blocks.push(cur);

  // 2. Turn each block into a question.
  for (const b of blocks) {
    const firstOpt = b.findIndex((x) => !!lettered(x.text));
    let qLines: Ln[]; let opts: Opt[] = [];
    if (firstOpt >= 0) {
      qLines = b.slice(0, firstOpt);
      for (const x of b.slice(firstOpt)) {
        const o = lettered(x.text) ?? starOnly(x.text);
        if (o) opts.push({ ...o });
        else if (opts.length) opts[opts.length - 1].text += ' ' + x.text; // wrapped option
      }
    } else {
      const star = b.findIndex((x) => !!starOnly(x.text));
      if (star < 0) { if (b.length >= 2) issues.push({ line: b[0].line, message: `Item at line ${b[0].line} has no answer marked with *, so it was skipped.` }); continue; }
      // Options without letters: the question runs up to the last line before the first option that ends in ? or :, otherwise it is the first line.
      let qEnd = 0;
      for (let i = star - 1; i >= 0; i--) if (/[?:]$/.test(b[i].text)) { qEnd = i; break; }
      qLines = b.slice(0, qEnd + 1);
      opts = b.slice(qEnd + 1).map((x) => starOnly(x.text) ?? { key: null, text: x.text, star: false });
    }
    const line = b[0].line;
    const text = qLines.map((x) => x.text).join(' ').replace(/\s+/g, ' ').trim();
    const label = `Question at line ${line}`;
    if (!text) { issues.push({ line, message: `${label} has options but no question text.` }); continue; }
    if (opts.length < 2) { issues.push({ line, message: `${label} needs at least two answer options.` }); continue; }
    if (opts.length > 8) { issues.push({ line, message: `${label} has more than 8 options.` }); continue; }
    const stars = opts.filter((o) => o.star);
    if (stars.length === 0) { issues.push({ line, message: `${label} has no correct answer: put * in front of the right option.` }); continue; }
    if (stars.length > 1) { issues.push({ line, message: `${label} has ${stars.length} options marked with *: only one answer can be correct.` }); continue; }
    if (opts.some((o) => !o.text)) { issues.push({ line, message: `${label} has an empty option.` }); continue; }
    if (questions.length >= MAX_QUESTIONS) { issues.push({ line, message: `Only the first ${MAX_QUESTIONS} questions can be imported at once.` }); break; }
    const letters = opts.map((o) => o.key);
    const usable = letters.every((k) => k) && new Set(letters).size === letters.length;
    const keyed = opts.map((o, i) => ({ key: usable ? (o.key as string) : String.fromCharCode(65 + i), text: o.text, star: o.star }));
    questions.push({ text, options: keyed.map(({ key, text: t }) => ({ key, text: t })), correctKey: keyed.find((o) => o.star)!.key, line });
  }
  return { questions, issues };
}

/** Marks one attempt. `correct` maps question id to the right key; `answers` maps question id to the chosen key. Unanswered scores zero. */
export function markAttempt(correct: Record<string, string>, answers: Record<string, string>): { correct: number; total: number; pct: number } {
  const ids = Object.keys(correct);
  const right = ids.filter((id) => answers[id] && answers[id] === correct[id]).length;
  return { correct: right, total: ids.length, pct: ids.length ? Math.round((right / ids.length) * 10000) / 100 : 0 };
}

/** Deterministic pseudo-random order: the same person gets the same questions on reload, different people get different ones. */
export function pickQuestions<T extends { id: string }>(pool: T[], count: number, seed: string): T[] {
  const h = (s: string) => { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; };
  return [...pool].sort((a, b) => h(seed + a.id) - h(seed + b.id)).slice(0, Math.max(0, count));
}
