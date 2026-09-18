import { EXAM_CONFIG, LETTERS, SUBJECTS, DIFFICULTIES, getQuestionMeta } from './examConfig.js';

export const STATUS = {
  CORRECT:'correct',
  WRONG:'wrong',
  BLANK:'blank',
  AMBIGUOUS:'ambiguous'
};

export function normalizeLetter(value){
  const v=String(value ?? '').trim().toUpperCase();
  return LETTERS.includes(v) ? v : null;
}

export function normalizeAnswerArray(input){
  const arr=Array.isArray(input)?input:[];
  return EXAM_CONFIG.questionNumbers.map((_,i)=>normalizeLetter(arr[i]));
}

export function parseAnswerKeyText(text){
  const raw=String(text ?? '').toUpperCase();
  const compact=(raw.match(/[A-E]/g)||[]);
  if(!compact.length) return Array(EXAM_CONFIG.totalQuestions).fill(null);
  return EXAM_CONFIG.questionNumbers.map((_,i)=>compact[i]||null);
}

export function compareAnswers(answerKey, studentAnswers, confidence=[]){
  const key=normalizeAnswerArray(answerKey);
  const student=normalizeAnswerArray(studentAnswers);
  return EXAM_CONFIG.questionNumbers.map((question,index)=>{
    const meta=getQuestionMeta(question);
    const answer=student[index];
    const conf=Number.isFinite(Number(confidence[index])) ? Math.max(0,Math.min(1,Number(confidence[index]))) : 1;
    let status=STATUS.BLANK;
    if(answer && conf<0.65) status=STATUS.AMBIGUOUS;
    else if(answer && key[index] && answer===key[index]) status=STATUS.CORRECT;
    else if(answer) status=STATUS.WRONG;
    return {question,index,key:key[index],answer,confidence:conf,status,...meta};
  });
}

function summarizeBucket(items){
  const correct=items.filter(x=>x.status===STATUS.CORRECT).length;
  const wrong=items.filter(x=>x.status===STATUS.WRONG).length;
  const blank=items.filter(x=>x.status===STATUS.BLANK).length;
  const ambiguous=items.filter(x=>x.status===STATUS.AMBIGUOUS).length;
  const attempted=correct+wrong;
  const denominator=items.length;
  return {
    total:denominator, correct, wrong, blank, ambiguous, attempted,
    percentage:denominator ? correct/denominator*100 : 0,
    attemptedPercentage:denominator ? attempted/denominator*100 : 0
  };
}

export function calculateResult(items){
  const all=summarizeBucket(items);
  const bySubject={};
  for(const subject of SUBJECTS){
    bySubject[subject]=summarizeBucket(items.filter(x=>x.subject===subject));
  }
  const byDifficulty={};
  for(const difficulty of DIFFICULTIES){
    byDifficulty[difficulty]=summarizeBucket(items.filter(x=>x.difficulty===difficulty));
  }
  const matrix={};
  for(const subject of SUBJECTS){
    matrix[subject]={};
    for(const difficulty of DIFFICULTIES){
      matrix[subject][difficulty]=summarizeBucket(items.filter(x=>x.subject===subject && x.difficulty===difficulty));
    }
  }

  // Compatibilidade exata com a planilha:
  // S = soma dos 45 resultados binários
  // F = soma dos 15 itens fáceis
  // M = soma dos 15 itens médios
  // D = soma dos 15 itens difíceis
  // TRI = 400 + 900 * ((F + 1.5*M + 1.75*D)/90)^1.14
  const F=byDifficulty.F.correct;
  const M=byDifficulty.M.correct;
  const D=byDifficulty.D.correct;
  const S=all.correct;
  const tri=400 + 900 * Math.pow((F + 1.5*M + 1.75*D)/90,1.14);

  return {
    total:EXAM_CONFIG.totalQuestions,
    S,F,M,D,
    score:S,
    correct:all.correct,
    wrong:all.wrong,
    blank:all.blank,
    ambiguous:all.ambiguous,
    attempted:all.attempted,
    percentage:all.percentage,
    tri:Number.isFinite(tri)?tri:null,
    all,
    bySubject,
    byDifficulty,
    matrix
  };
}

function mode(values){
  const nums=values.filter(Number.isFinite);
  if(!nums.length) return null;
  const counts=new Map();
  for(const n of nums) counts.set(n,(counts.get(n)||0)+1);
  let bestCount=0, best=[];
  for(const [n,c] of counts){
    if(c>bestCount){bestCount=c;best=[n];}
    else if(c===bestCount) best.push(n);
  }
  return best[0];
}
function average(values){
  const nums=values.filter(Number.isFinite);
  return nums.length ? nums.reduce((a,b)=>a+b,0)/nums.length : null;
}
function median(values){
  const nums=values.filter(Number.isFinite).sort((a,b)=>a-b);
  if(!nums.length) return null;
  const m=Math.floor(nums.length/2);
  return nums.length%2 ? nums[m] : (nums[m-1]+nums[m])/2;
}

// Estatísticas da planilha por coluna/questão.
// "mode/median/max/min" são calculados sobre o vetor de totais por questão,
// exatamente como as fórmulas das abas M1/M2/N1/N2 fazem na região C:G etc.
export function calculateClassStatistics(rows){
  const normalized=Array.isArray(rows)?rows:[];
  const perQuestion=EXAM_CONFIG.questionNumbers.map((question,index)=>({
    question,
    totalCorrect:normalized.reduce((sum,row)=>sum + (row?.items?.[index]?.status===STATUS.CORRECT?1:0),0)
  }));

  const totals=perQuestion.map(x=>x.totalCorrect);
  return {
    students:normalized.length,
    perQuestion,
    questionTotals:{
      average:average(totals),
      mode:mode(totals),
      median:median(totals),
      max:totals.length?Math.max(...totals):null,
      min:totals.length?Math.min(...totals):null
    },
    perDifficulty:Object.fromEntries(DIFFICULTIES.map(d=>{
      const vals=perQuestion.filter(q=>getQuestionMeta(q.question).difficulty===d).map(q=>q.totalCorrect);
      return [d,{average:average(vals),mode:mode(vals),median:median(vals),max:vals.length?Math.max(...vals):null,min:vals.length?Math.min(...vals):null}];
    })),
    perSubject:Object.fromEntries(SUBJECTS.map(s=>{
      const vals=perQuestion.filter(q=>getQuestionMeta(q.question).subject===s).map(q=>q.totalCorrect);
      return [s,{average:average(vals),mode:mode(vals),median:median(vals),max:vals.length?Math.max(...vals):null,min:vals.length?Math.min(...vals):null}];
    }))
  };
}

export function buildSummary(result){
  if(!result) return '';
  const parts=[];
  parts.push(`Você acertou ${result.correct} de ${result.total} questões.`);
  if(result.blank) parts.push(`${result.blank} ficaram em branco.`);
  if(result.ambiguous) parts.push(`${result.ambiguous} marcações precisam de revisão.`);
  const subjectScores=Object.entries(result.bySubject).map(([name,v])=>({name,p:v.percentage}));
  const best=subjectScores.reduce((a,b)=>b.p>a.p?b:a,subjectScores[0]);
  if(best) parts.push(`O maior aproveitamento foi em ${best.name} (${best.p.toFixed(1)}%).`);
  return parts.join(' ');
}
