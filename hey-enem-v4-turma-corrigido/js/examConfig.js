export const TOTAL_QUESTIONS = 90;
export const LETTERS = ['A','B','C','D','E'];
export const QUESTION_NUMBERS = Array.from({ length: TOTAL_QUESTIONS }, (_, i) => i + 1);

export const EXAM_CONFIG = {
  id: 'classroom-90',
  name: 'Prova — 90 questões',
  totalQuestions: TOTAL_QUESTIONS,
  questionNumbers: QUESTION_NUMBERS
};
