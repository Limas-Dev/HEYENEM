import { TOTAL_QUESTIONS, LETTERS, QUESTION_NUMBERS } from './examConfig.js';

export const STATUS = {
  CORRECT: 'correct',
  WRONG: 'wrong',
  BLANK: 'blank',
  AMBIGUOUS: 'ambiguous'
};

export function normalizeLetter(value) {
  const v = String(value ?? '').trim().toUpperCase();
  return LETTERS.includes(v) ? v : null;
}

export function normalizeAnswerArray(input) {
  const arr = Array.isArray(input) ? input : [];
  return QUESTION_NUMBERS.map((_, i) => normalizeLetter(arr[i]));
}

export function normalizeStudentAnswer(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (LETTERS.map(x => x.toLowerCase()).includes(v)) return v.toUpperCase();
  if (v === 'blank' || v === 'ambiguous') return v;
  return null;
}

export function parseAnswerKeyText(text) {
  const normalized = String(text ?? '')
    .toUpperCase()
    .replace(/[ÁÀÃÂÄ]/g, 'A')
    .replace(/[ÉÈÊË]/g, 'E')
    .replace(/[ÍÌÎÏ]/g, 'I')
    .replace(/[ÓÒÕÔÖ]/g, 'O')
    .replace(/[ÚÙÛÜ]/g, 'U');

  const numbered = [...normalized.matchAll(/(?:^|[\s,;])\d{1,3}\s*[-.:)]\s*([A-E])(?=\s|$)/g)]
    .map(m => m[1]);

  if (numbered.length >= TOTAL_QUESTIONS) {
    return numbered.slice(0, TOTAL_QUESTIONS);
  }

  const tokens = normalized.match(/\b[A-E]\b/g) || [];
  if (tokens.length >= TOTAL_QUESTIONS) {
    return tokens.slice(0, TOTAL_QUESTIONS);
  }

  const compact = normalized.replace(/[^A-E]/g, '');
  if (compact.length >= TOTAL_QUESTIONS) {
    return compact.slice(0, TOTAL_QUESTIONS).split('');
  }

  return QUESTION_NUMBERS.map(() => null);
}

export function compareAnswers(answerKey, studentAnswers, confidence = []) {
  const key = normalizeAnswerArray(answerKey);
  const rawStudent = Array.isArray(studentAnswers) ? studentAnswers : [];
  const student = QUESTION_NUMBERS.map((_, i) => normalizeStudentAnswer(rawStudent[i]));

  return QUESTION_NUMBERS.map((question, index) => {
    const answer = student[index];
    const confValue = Number(confidence[index]);
    const conf = Number.isFinite(confValue)
      ? Math.max(0, Math.min(1, confValue))
      : 0;

    let status = STATUS.BLANK;

    if (answer === 'blank' || answer === null) {
      status = STATUS.BLANK;
    } else if (answer === 'ambiguous') {
      status = STATUS.AMBIGUOUS;
    } else if (conf < 0.65) {
      status = STATUS.AMBIGUOUS;
    } else if (key[index] && answer === key[index]) {
      status = STATUS.CORRECT;
    } else {
      status = STATUS.WRONG;
    }

    return {
      question,
      key: key[index] ?? null,
      answer,
      confidence: conf,
      status
    };
  });
}

export function calculateStudentResult(items) {
  const list = Array.isArray(items) ? items : [];
  const total = list.length;
  const correct = list.filter(x => x.status === STATUS.CORRECT).length;
  const wrong = list.filter(x => x.status === STATUS.WRONG).length;
  const blank = list.filter(x => x.status === STATUS.BLANK).length;
  const ambiguous = list.filter(x => x.status === STATUS.AMBIGUOUS).length;
  const identified = correct + wrong;
  const confidence = total
    ? list.reduce((sum, x) => sum + Number(x.confidence || 0), 0) / total
    : 0;

  return {
    total,
    correct,
    wrong,
    blank,
    ambiguous,
    identified,
    confidence,
    percentage: total ? (correct / total) * 100 : 0
  };
}

export function buildClassStatistics(students, answerKey) {
  const list = Array.isArray(students) ? students : [];
  const n = list.length;

  const totals = {
    correct: 0,
    wrong: 0,
    blank: 0,
    ambiguous: 0,
    confidence: 0,
    scoreSum: 0
  };

  for (const student of list) {
    totals.correct += Number(student.correct || 0);
    totals.wrong += Number(student.wrong || 0);
    totals.blank += Number(student.blank || 0);
    totals.ambiguous += Number(student.ambiguous || 0);
    totals.confidence += Number(student.confidence || 0);
    totals.scoreSum += Number(student.percentage || 0);
  }

  const questions = QUESTION_NUMBERS.map((question, index) => {
    let correct = 0;
    let wrong = 0;
    let blank = 0;
    let ambiguous = 0;

    for (const student of list) {
      const item = student.items?.[index];
      if (!item) continue;
      if (item.status === STATUS.CORRECT) correct++;
      else if (item.status === STATUS.WRONG) wrong++;
      else if (item.status === STATUS.BLANK) blank++;
      else if (item.status === STATUS.AMBIGUOUS) ambiguous++;
    }

    const answered = correct + wrong;
    let difficulty = 'none';

    if (answered > 0) {
      if (correct > wrong) difficulty = 'easy';
      else if (wrong > correct) difficulty = 'hard';
      else difficulty = 'medium';
    }

    return {
      question,
      key: answerKey?.[index] ?? null,
      correct,
      wrong,
      blank,
      ambiguous,
      answered,
      correctRate: answered ? (correct / answered) * 100 : 0,
      difficulty
    };
  });

  const distribution = [
    { label: '0–19%', min: 0, max: 19.999 },
    { label: '20–39%', min: 20, max: 39.999 },
    { label: '40–59%', min: 40, max: 59.999 },
    { label: '60–79%', min: 60, max: 79.999 },
    { label: '80–100%', min: 80, max: 100 }
  ].map(bucket => ({
    ...bucket,
    count: list.filter(s => s.percentage >= bucket.min && s.percentage <= bucket.max).length
  }));

  return {
    students: n,
    average: n ? totals.scoreSum / n : 0,
    averageCorrect: n ? totals.correct / n : 0,
    averageWrong: n ? totals.wrong / n : 0,
    averageBlank: n ? totals.blank / n : 0,
    averageAmbiguous: n ? totals.ambiguous / n : 0,
    averageConfidence: n ? totals.confidence / n : 0,
    totalCorrect: totals.correct,
    totalWrong: totals.wrong,
    totalBlank: totals.blank,
    totalAmbiguous: totals.ambiguous,
    questions,
    distribution,
    difficultyCounts: {
      easy: questions.filter(q => q.difficulty === 'easy').length,
      medium: questions.filter(q => q.difficulty === 'medium').length,
      hard: questions.filter(q => q.difficulty === 'hard').length,
      none: questions.filter(q => q.difficulty === 'none').length
    }
  };
}

export function makeStudentId({ name, document, sourceFile }) {
  const clean = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const doc = clean(document);
  if (doc) return `doc:${doc}`;
  const student = clean(name);
  if (student) return `name:${student}`;
  return `file:${clean(sourceFile)}:${Date.now()}`;
}
