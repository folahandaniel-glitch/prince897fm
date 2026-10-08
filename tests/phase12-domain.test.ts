import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { markAttempt, parseQuestions, pickQuestions } from '../src/domain/questions';
import { bandOfRank, composite, normaliseWeights, periodBounds, pickProfile, ratingOf, scoreMetric, standardTarget, standardWeights, DEPARTMENT_CORE, GENERIC_CORE, KPI_LIBRARY } from '../src/domain/kpi';
import { daysUntilNext } from '../src/server/overview';
import { extractText, sniffDoc } from '../src/server/docs-extract';

const SAMPLE = `Product and Service Knowledge Test

1. What is the station's frequency?
A. 88.1 FM
*B. 89.7 FM
C. 90.5 FM
D. 101.1 FM

2) Which package includes a jingle and ten spots a week?
a) Bronze
b) Silver
*c) Gold

Q3. Who owns PRINCE 89.7 FM?
A. Fodan Softnet
B. *Oruomeniowo International
C. Another company`;

describe('question parser', () => {
  it('reads numbered questions with lettered options and * before the correct one', () => {
    const { questions, issues } = parseQuestions(SAMPLE);
    expect(issues).toEqual([]);
    expect(questions).toHaveLength(3);
    expect(questions[0]).toMatchObject({ text: "What is the station's frequency?", correctKey: 'B' });
    expect(questions[0].options.map((o) => o.text)).toEqual(['88.1 FM', '89.7 FM', '90.5 FM', '101.1 FM']);
    expect(questions[1]).toMatchObject({ correctKey: 'C' });
    expect(questions[2]).toMatchObject({ correctKey: 'B' }); // asterisk after the letter also counts
    expect(questions[2].options[1].text).toBe('Oruomeniowo International');
  });
  it('reads blocks separated by blank lines and options without letters', () => {
    const { questions, issues } = parseQuestions('What colour is the logo?\nRed\n*Yellow\nBlue\n\nWhich band do we broadcast on?\n*FM\nAM');
    expect(issues).toEqual([]);
    expect(questions.map((q) => q.correctKey)).toEqual(['B', 'A']);
    expect(questions[0].options).toEqual([{ key: 'A', text: 'Red' }, { key: 'B', text: 'Yellow' }, { key: 'C', text: 'Blue' }]);
  });
  it('joins wrapped lines and ignores bullets', () => {
    const { questions } = parseQuestions('1. What is the minimum notice a client must give\nto cancel a campaign?\n• A. 24 hours\n• *B. 7 days, in writing\n  and signed\n• C. None');
    expect(questions[0].text).toBe('What is the minimum notice a client must give to cancel a campaign?');
    expect(questions[0].options[1].text).toBe('7 days, in writing and signed');
    expect(questions[0].correctKey).toBe('B');
  });
  it('reports every problem with a plain message and skips only the bad questions', () => {
    const { questions, issues } = parseQuestions('1. No answer marked\nA. Yes\nB. No\n\n2. Two marked\n*A. Yes\n*B. No\n\n3. Only one option\n*A. Yes\n\n4. Good question\nA. x\n*B. y');
    expect(questions).toHaveLength(1);
    expect(questions[0].text).toBe('Good question');
    expect(issues.map((i) => i.message)).toEqual([
      expect.stringContaining('no correct answer'), expect.stringContaining('2 options marked'), expect.stringContaining('at least two'),
    ]);
  });
  it('does not mistake a question that starts with a letter for an option', () => {
    const { questions } = parseQuestions('1. B-52 radio jingles are made by which department?\nA. Production\n*B. Programmes');
    expect(questions).toHaveLength(1);
    expect(questions[0].text).toContain('B-52');
  });
});

describe('marking and picking', () => {
  it('scores correct answers and treats blanks as wrong', () => {
    expect(markAttempt({ a: 'A', b: 'B', c: 'C', d: 'D' }, { a: 'A', b: 'C', c: 'C' })).toEqual({ correct: 2, total: 4, pct: 50 });
    expect(markAttempt({}, {})).toEqual({ correct: 0, total: 0, pct: 0 });
    expect(markAttempt({ a: 'A' }, { a: 'a' }).correct).toBe(0);
  });
  it('picks a stable, person-specific sample', () => {
    const pool = Array.from({ length: 40 }, (_, i) => ({ id: `q${i}` }));
    const a = pickQuestions(pool, 10, 'emp1:ass'), b = pickQuestions(pool, 10, 'emp1:ass'), c = pickQuestions(pool, 10, 'emp2:ass');
    expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id));
    expect(a.map((x) => x.id)).not.toEqual(c.map((x) => x.id));
    expect(new Set(a.map((x) => x.id)).size).toBe(10);
    expect(pickQuestions(pool, 100, 's')).toHaveLength(40);
  });
});

describe('KPI rules', () => {
  it('maps seniority to level bands', () => {
    expect([1, 3, 20, 30, 45, 50, 60, 70, 80, 90].map(bandOfRank)).toEqual(['executive', 'executive', 'management', 'management', 'management', 'management', 'supervisory', 'senior', 'junior', 'intern']);
    expect(bandOfRank(null)).toBe('junior');
  });
  it('scores metrics against targets and caps at 100', () => {
    expect(scoreMetric(80)).toBe(80);
    expect(scoreMetric(1_500_000, 2_000_000)).toBe(75);
    expect(scoreMetric(3_000_000, 2_000_000)).toBe(100);
    expect(scoreMetric(null)).toBeNull();
    expect(scoreMetric(-5)).toBe(0);
  });
  it('averages by weight, leaves out measures without data, and reports coverage', () => {
    const r = composite([{ key: 'a', name: 'A', weight: 50, score: 80 }, { key: 'b', name: 'B', weight: 30, score: 60 }, { key: 'c', name: 'C', weight: 20, score: null }]);
    expect(r).toEqual({ score: 72.5, coverage: 80 });
    expect(composite([{ key: 'a', name: 'A', weight: 100, score: null }])).toEqual({ score: null, coverage: 0 });
  });
  it('rates by band', () => {
    expect([95, 80, 65, 45, 10].map((s) => ratingOf(s).label)).toEqual(['Outstanding', 'Exceeds expectations', 'Meets expectations', 'Needs improvement', 'Unsatisfactory']);
    expect(ratingOf(null).tone).toBe('none');
  });
  it('picks the most specific profile', () => {
    const ps = [
      { id: 'default', departmentId: null, levelBand: null }, { id: 'senior', departmentId: null, levelBand: 'senior' as const },
      { id: 'news', departmentId: 'd1', levelBand: 'junior' as const }, { id: 'news-all', departmentId: 'd1', levelBand: null }, { id: 'off', departmentId: 'd2', levelBand: 'junior' as const, active: false },
    ];
    expect(pickProfile(ps, 'd1', 'junior')?.id).toBe('news');
    expect(pickProfile(ps, 'd1', 'senior')?.id).toBe('news-all');
    expect(pickProfile(ps, 'd2', 'junior')?.id).toBe('default');
    expect(pickProfile(ps, 'd9', 'senior')?.id).toBe('senior');
    expect(pickProfile(ps, null, 'executive')?.id).toBe('default');
    expect(pickProfile([], 'd1', 'junior')).toBeNull();
  });
  it('standard weights always add up to exactly 100 and only use known measures', () => {
    const keys = new Set(KPI_LIBRARY.map((m) => m.key));
    for (const core of [GENERIC_CORE, ...DEPARTMENT_CORE.map((d) => d.weights)]) {
      expect(core.reduce((a, [, w]) => a + w, 0)).toBe(100);
      for (const band of ['executive', 'management', 'supervisory', 'senior', 'junior', 'intern'] as const) {
        const w = standardWeights(core, band);
        expect(Math.round(w.reduce((a, [, x]) => a + x, 0) * 100) / 100).toBe(100);
        for (const [k] of w) expect(keys.has(k)).toBe(true);
      }
    }
    expect(standardWeights(GENERIC_CORE, 'executive').find(([k]) => k === 'leadership')![1]).toBe(50);
    expect(standardWeights(GENERIC_CORE, 'junior').some(([k]) => k === 'leadership')).toBe(false);
    const mk = DEPARTMENT_CORE.find((d) => d.label === 'Advertising & marketing')!;
    expect(standardWeights(mk.weights, 'intern').some(([k]) => k === 'sales_target')).toBe(false);
    expect(standardTarget('sales_target', 'junior', mk.targets)).toBe(2_000_000);
    expect(standardTarget('sales_target', 'management', mk.targets)).toBe(6_000_000);
    expect(standardTarget('punctuality', 'junior', mk.targets)).toBeNull();
    expect(normaliseWeights([['a', 33.33], ['b', 33.33], ['c', 33.33]]).reduce((s, [, w]) => s + w, 0)).toBeCloseTo(100, 2);
  });
  it('knows the bounds of a month', () => {
    expect(periodBounds('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28', next: '2026-03-01' });
    expect(periodBounds('2028-02').to).toBe('2028-02-29');
    expect(periodBounds('2026-12').next).toBe('2027-01-01');
  });
});

describe('birthday arithmetic', () => {
  it('counts days to the next occurrence, including today and year end', () => {
    expect(daysUntilNext('2026-03-10', 3, 10)).toBe(0);
    expect(daysUntilNext('2026-03-10', 3, 11)).toBe(1);
    expect(daysUntilNext('2026-12-30', 1, 2)).toBe(3);
    expect(daysUntilNext('2026-03-10', 3, 9)).toBe(364);
  });
  it('puts 29 February on the next leap year', () => {
    expect(daysUntilNext('2027-03-01', 2, 29)).toBeGreaterThan(300);
    expect(daysUntilNext('2028-02-28', 2, 29)).toBe(1);
  });
});

describe('reading uploaded Word, PowerPoint and PDF files', () => {
  const body = ['1. What is the frequency?', 'A. 88.1', '*B. 89.7', 'C. 90.5', '', '2. Who is the Chairman?', '*A. The owner', 'B. A guest'];
  const docx = async () => { const z = new JSZip(); z.file('[Content_Types].xml', '<Types/>'); z.file('word/document.xml', `<w:document><w:body>${body.map((l) => `<w:p><w:r><w:t>${l.replace(/&/g, '&amp;')}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`); return z.generateAsync({ type: 'nodebuffer' }); };
  const pptx = async () => { const z = new JSZip(); z.file('ppt/slides/slide2.xml', '<p:sld><a:p><a:r><a:t>2. Who is the Chairman?</a:t></a:r></a:p><a:p><a:r><a:t>*A. The owner</a:t></a:r></a:p><a:p><a:r><a:t>B. A guest</a:t></a:r></a:p></p:sld>'); z.file('ppt/slides/slide1.xml', '<p:sld><a:p><a:r><a:t>1. What is the frequency?</a:t></a:r></a:p><a:p><a:r><a:t>A. 88.1</a:t></a:r></a:p><a:p><a:r><a:t>*B. 89.7</a:t></a:r></a:p></p:sld>'); return z.generateAsync({ type: 'nodebuffer' }); };
  const pdf = async () => { const d = await PDFDocument.create(); const p = d.addPage([600, 800]); const f = await d.embedFont(StandardFonts.Helvetica); body.forEach((l, i) => { if (l) p.drawText(l, { x: 40, y: 760 - i * 20, size: 12, font: f }); }); return Buffer.from(await d.save()); };

  it('extracts and parses a .docx', async () => {
    const r = await extractText(await docx());
    expect(r.kind).toBe('docx');
    const q = parseQuestions(r.text);
    expect(q.issues).toEqual([]);
    expect(q.questions.map((x) => x.correctKey)).toEqual(['B', 'A']);
  });
  it('extracts and parses a .pptx with slides in order', async () => {
    const r = await extractText(await pptx());
    expect(r.kind).toBe('pptx');
    const q = parseQuestions(r.text);
    expect(q.questions.map((x) => x.text)).toEqual(['What is the frequency?', 'Who is the Chairman?']);
    expect(q.questions.map((x) => x.correctKey)).toEqual(['B', 'A']);
  });
  it('extracts and parses a PDF', async () => {
    const r = await extractText(await pdf());
    expect(r.kind).toBe('pdf');
    const q = parseQuestions(r.text);
    expect(q.questions.length).toBe(2);
    expect(q.questions[0].correctKey).toBe('B');
  });
  it('refuses other files by content, whatever the name says', async () => {
    await expect(extractText(Buffer.from('MZ\x90\x00 pretend this is a document'))).rejects.toThrow(/Word \(.docx\)/);
    await expect(extractText(Buffer.from('<html>hi</html>'))).rejects.toThrow(/Word \(.docx\)/);
    await expect(extractText(Buffer.alloc(0))).rejects.toThrow(/empty/);
    await expect(extractText(Buffer.alloc(6 * 1024 * 1024, 1))).rejects.toThrow(/5 MB/);
    const zip = new JSZip(); zip.file('notes.txt', 'just a zip'); expect(await sniffDoc(await zip.generateAsync({ type: 'nodebuffer' }))).toBeNull();
  });
});
