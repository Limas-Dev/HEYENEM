import { EXAM_CONFIG, LETTERS, DIFFICULTY_LABEL } from './examConfig.js';

const $=id=>document.getElementById(id);

export function renderKeyGrid(key,onChange){
  const grid=$('keyGrid');
  grid.innerHTML='';
  EXAM_CONFIG.questionNumbers.forEach((q,i)=>{
    const cell=document.createElement('div');
    cell.className='key-cell';
    cell.innerHTML=`<span class="key-number">${q}</span><select aria-label="Gabarito ${q}">${LETTERS.map(l=>`<option value="${l}" ${key[i]===l?'selected':''}>${l}</option>`).join('')}</select>`;
    cell.querySelector('select').addEventListener('change',e=>onChange(i,e.target.value));
    grid.appendChild(cell);
  });
}

export function updateKeyMeta(key){
  $('keyCount').textContent=`${key.filter(Boolean).length}/${EXAM_CONFIG.totalQuestions} preenchidas`;
}

let objectUrl=null;
export function setPreview(file){
  if(objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl=URL.createObjectURL(file);
  $('previewImage').src=objectUrl;
  $('previewImage').alt=`Pré-visualização de ${file.name}`;
  $('fileName').textContent=file.name;
  $('imageSizeBadge').textContent=`${(file.size/1024/1024).toFixed(1)} MB`;
  $('uploadEmpty').classList.add('hidden');
  $('previewWrap').classList.remove('hidden');
  $('uploadStatus').textContent='Imagem pronta para análise.';
  $('uploadHint').textContent='Confira se toda a folha está enquadrada e sem reflexos.';
}

export function clearPreview(){
  if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}
  $('previewImage').src='';
  $('fileName').textContent='Nenhuma imagem selecionada';
  $('imageSizeBadge').textContent='—';
  $('uploadEmpty').classList.remove('hidden');
  $('previewWrap').classList.add('hidden');
  $('uploadStatus').textContent='Aguardando uma imagem.';
  $('uploadHint').textContent='Clique, arraste ou fotografe a folha.';
}

export function setStep(step){
  document.querySelectorAll('.step').forEach((el,i)=>{
    el.classList.toggle('active',i<=step);
    el.classList.toggle('current',i===step);
  });
}

export function setLoading(loading){
  document.body.classList.toggle('is-loading',loading);
  $('loadingOverlay').classList.toggle('hidden',!loading);
  $('analyzeBtn').disabled=loading;
}

export function renderResult(result,items){
  $('resultsSection').classList.remove('hidden');
  $('scoreValue').textContent=result.score;
  $('scoreTotal').textContent=`/ ${result.total}`;
  $('percentage').textContent=`${result.percentage.toFixed(1)}%`;
  $('triValue').textContent=result.tri==null?'—':result.tri.toFixed(1).replace('.',',');
  $('correctValue').textContent=result.correct;
  $('wrongValue').textContent=result.wrong;
  $('blankValue').textContent=result.blank;
  $('ambiguousValue').textContent=result.ambiguous;
  $('progressFill').style.width=`${Math.min(100,result.percentage)}%`;

  const subjectContainer=$('subjectCards');
  subjectContainer.innerHTML='';
  for(const [subject,v] of Object.entries(result.bySubject)){
    subjectContainer.insertAdjacentHTML('beforeend',`
      <article class="subject-card">
        <div class="subject-top"><span>${subject}</span><strong>${v.correct}/${v.total}</strong></div>
        <div class="bar"><i style="width:${v.percentage}%"></i></div>
        <div class="subject-percent">${v.percentage.toFixed(1)}%</div>
        <div class="mini-grid">
          <span>Fácil <b>${result.matrix[subject].F.correct}/${result.matrix[subject].F.total}</b></span>
          <span>Média <b>${result.matrix[subject].M.correct}/${result.matrix[subject].M.total}</b></span>
          <span>Difícil <b>${result.matrix[subject].D.correct}/${result.matrix[subject].D.total}</b></span>
        </div>
      </article>`);
  }

  const diffContainer=$('difficultyCards');
  diffContainer.innerHTML='';
  for(const d of ['F','M','D']){
    const v=result.byDifficulty[d];
    diffContainer.insertAdjacentHTML('beforeend',`
      <article class="difficulty-card">
        <div><span>${DIFFICULTY_LABEL[d]}</span><strong>${v.correct}/${v.total}</strong></div>
        <div class="bar"><i style="width:${v.percentage}%"></i></div>
        <small>${v.percentage.toFixed(1)}% de aproveitamento</small>
      </article>`);
  }

  const map=$('questionMap');
  map.innerHTML='';
  items.forEach(item=>{
    const button=document.createElement('button');
    button.className=`question-chip ${item.status}`;
    button.innerHTML=`<span>${item.question}</span><b>${item.status==='correct'?'✓':item.status==='wrong'?'×':item.status==='ambiguous'?'!':'—'}</b>`;
    button.title=`Questão ${item.question} • ${item.subject} • ${item.difficulty||'—'}`;
    button.addEventListener('click',()=>openQuestion(item));
    map.appendChild(button);
  });

  $('resultSummary').textContent=buildReadableSummary(result);
  window.scrollTo({top:$('resultsSection').offsetTop-20,behavior:'smooth'});
}

function buildReadableSummary(result){
  const best=Object.entries(result.bySubject).sort((a,b)=>b[1].percentage-a[1].percentage)[0];
  const hard=result.byDifficulty.D;
  let text=`Você acertou ${result.correct} de ${result.total} questões (${result.percentage.toFixed(1)}%).`;
  if(best) text+=` Seu maior aproveitamento foi em ${best[0]} (${best[1].percentage.toFixed(1)}%).`;
  text+=` Em questões difíceis, foram ${hard.correct}/${hard.total}.`;
  if(result.ambiguous) text+=` ${result.ambiguous} marcação(ões) ficaram para revisão.`;
  return text;
}

function openQuestion(item){
  const modal=$('questionModal');
  $('modalQuestion').textContent=`Questão ${item.question}`;
  $('modalSubject').textContent=item.subject;
  $('modalDifficulty').textContent=item.difficulty==='F'?'Fácil':item.difficulty==='M'?'Média':'Difícil';
  $('modalStudent').textContent=item.answer||'—';
  $('modalKey').textContent=item.key||'—';
  const labels={correct:'CORRETA',wrong:'INCORRETA',blank:'EM BRANCO',ambiguous:'REVISAR'};
  $('modalStatus').textContent=labels[item.status];
  $('modalStatus').className=`modal-status ${item.status}`;
  $('modalConfidence').textContent=item.answer?`${Math.round(item.confidence*100)}% de confiança na leitura`:'Sem marcação identificada';
  modal.classList.remove('hidden');
}

export function closeModal(){$('questionModal').classList.add('hidden');}

export function toast(message,type='info'){
  const el=$('toast');
  el.textContent=message;
  el.className=`toast show ${type}`;
  clearTimeout(window.__toastTimer);
  window.__toastTimer=setTimeout(()=>el.className='toast',3200);
}

export function setApiStatus(text,ok=false){
  $('apiStatus').textContent=text;
  $('apiStatus').className=ok?'status ok':'status';
}

export function buildSummaryExport(result,items){
  const lines=[
    'HEYENEM — CORREÇÃO DE NATUREZA',
    `Acertos: ${result.correct}/${result.total}`,
    `Aproveitamento: ${result.percentage.toFixed(1)}%`,
    `TRI: ${result.tri?.toFixed(1)??'—'}`,
    `Erros: ${result.wrong}`,
    `Em branco: ${result.blank}`,
    `Ambíguas: ${result.ambiguous}`,
    '',
    'QUESTÕES'
  ];
  items.forEach(x=>lines.push(`${x.question};${x.answer||'—'};${x.key||'—'};${x.status}`));
  return lines.join('\n');
}
