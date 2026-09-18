export const LETTERS = ['A','B','C','D','E'];
export const SUBJECTS = ['Física','Química','Biologia'];
export const DIFFICULTIES = ['F','M','D'];
export const DIFFICULTY_LABEL = { F:'Fácil', M:'Média', D:'Difícil' };

const ORDERED = [
  136,147,148,138,140,137,139,146,164,180,141,142,143,144,145,
  151,152,153,154,155,156,157,158,159,160,149,161,162,163,179,
  166,167,168,169,170,150,171,172,173,174,175,165,176,177,178
];

const META = {
  136:['Física','F'],147:['Física','F'],148:['Física','F'],138:['Física','F'],140:['Física','F'],
  137:['Física','M'],139:['Física','M'],146:['Física','M'],164:['Física','M'],180:['Física','M'],
  141:['Física','D'],142:['Física','D'],143:['Física','D'],144:['Física','D'],145:['Física','D'],
  151:['Química','F'],152:['Química','F'],153:['Química','F'],154:['Química','F'],155:['Química','F'],
  156:['Química','M'],157:['Química','M'],158:['Química','M'],159:['Química','M'],160:['Química','M'],
  149:['Química','D'],161:['Química','D'],162:['Química','D'],163:['Química','D'],179:['Química','D'],
  166:['Biologia','F'],167:['Biologia','F'],168:['Biologia','F'],169:['Biologia','F'],170:['Biologia','F'],
  150:['Biologia','M'],171:['Biologia','M'],172:['Biologia','M'],173:['Biologia','M'],174:['Biologia','M'],
  175:['Biologia','D'],165:['Biologia','D'],176:['Biologia','D'],177:['Biologia','D'],178:['Biologia','D']
};

// Gabarito exatamente como aparece na planilha, em ordem numérica 136 → 180.
export const ANSWER_KEY = [
  'A','B','C','C','B','E','A','C','E','E','B','C','C','C','E',
  'D','A','A','D','D','A','E','E','B','D','D','B','E','B','C',
  'B','A','D','E','C','E','D','A','B','C','E','B','C','C','D'
];

export const EXAM_CONFIG = {
  id:'natureza-136-180',
  name:'Natureza',
  totalQuestions:45,
  questionNumbers:Array.from({length:45},(_,i)=>136+i),
  orderedQuestions:ORDERED,
  answerKey:ANSWER_KEY,
  metadata:META,
  subjects:SUBJECTS,
  difficulties:DIFFICULTIES,
  spreadsheetFormula:{
    score:'SUM(all 45 binary item results)',
    easy:'F',
    medium:'M',
    hard:'D',
    tri:'400 + 900 * ((F + 1.5*M + 1.75*D) / 90) ^ 1.14'
  }
};

export function getQuestionMeta(question){
  const pair = META[Number(question)];
  if(!pair) return { subject:'—', difficulty:null };
  return { subject:pair[0], difficulty:pair[1] };
}
