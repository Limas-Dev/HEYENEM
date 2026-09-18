import { EXAM_CONFIG } from './examConfig.js';
import { compareAnswers, calculateResult, parseAnswerKeyText } from './correctionEngine.js';
import { analyzeSheet } from './gemini.js';
import * as UI from './ui.js';

const $=id=>document.getElementById(id);
const state={
  answerKey:[...EXAM_CONFIG.answerKey],
  file:null,
  items:[],
  result:null
};

function onKeyChange(index,value){
  state.answerKey[index]=value;
  UI.updateKeyMeta(state.answerKey);
}

function resetAll(){
  state.answerKey=[...EXAM_CONFIG.answerKey];
  state.file=null;
  state.items=[];
  state.result=null;
  $('fileInput').value='';
  $('keyPaste').value='';
  UI.renderKeyGrid(state.answerKey,onKeyChange);
  UI.updateKeyMeta(state.answerKey);
  UI.clearPreview();
  $('resultsSection').classList.add('hidden');
  $('analysisError').classList.add('hidden');
  UI.setStep(0);
  window.scrollTo({top:0,behavior:'smooth'});
}

async function runAnalysis(){
  if(!state.file){UI.toast('Selecione ou fotografe a folha primeiro.','error');return;}
  if(state.answerKey.some(x=>!x)){UI.toast('Preencha todas as alternativas do gabarito.','error');return;}

  UI.setLoading(true);
  UI.setStep(1);
  $('analysisError').classList.add('hidden');
  UI.setApiStatus('IA analisando a folha…');

  try{
    const vision=await analyzeSheet(state.file);
    state.items=compareAnswers(
      state.answerKey,
      vision.answers.map(x=>x.answer),
      vision.answers.map(x=>x.confidence)
    );
    state.result=calculateResult(state.items);
    UI.renderResult(state.result,state.items);
    UI.setStep(2);
    UI.setApiStatus(`Leitura concluída • ${vision.model}`,true);
    UI.toast(`Correção concluída: ${state.result.correct} acertos.`,'success');
  }catch(error){
    console.error(error);
    $('analysisError').textContent=error?.message||'Não foi possível analisar a folha.';
    $('analysisError').classList.remove('hidden');
    UI.setApiStatus('Falha na análise');
    UI.toast('A análise não foi concluída.','error');
    UI.setStep(1);
  }finally{
    UI.setLoading(false);
  }
}

function init(){
  UI.renderKeyGrid(state.answerKey,onKeyChange);
  UI.updateKeyMeta(state.answerKey);

  $('fillAllA').addEventListener('click',()=>{
    state.answerKey.fill('A');
    UI.renderKeyGrid(state.answerKey,onKeyChange);
    UI.updateKeyMeta(state.answerKey);
    $('keyPaste').value='';
    UI.toast('Gabarito preenchido com A.');
  });

  $('restoreOfficialKey').addEventListener('click',()=>{
    state.answerKey=[...EXAM_CONFIG.answerKey];
    UI.renderKeyGrid(state.answerKey,onKeyChange);
    UI.updateKeyMeta(state.answerKey);
    $('keyPaste').value='';
    UI.toast('Gabarito da planilha restaurado.','success');
  });

  $('clearKey').addEventListener('click',()=>{
    state.answerKey.fill(null);
    UI.renderKeyGrid(state.answerKey,onKeyChange);
    UI.updateKeyMeta(state.answerKey);
  });

  $('keyPaste').addEventListener('input',e=>{
    const parsed=parseAnswerKeyText(e.target.value);
    if(parsed.some(Boolean)){
      state.answerKey=parsed;
      UI.renderKeyGrid(state.answerKey,onKeyChange);
      UI.updateKeyMeta(state.answerKey);
    }
  });

  $('fileInput').addEventListener('change',e=>{
    const file=e.target.files?.[0];
    if(!file)return;
    if(!file.type.startsWith('image/')){UI.toast('Escolha um arquivo de imagem.','error');return;}
    state.file=file;
    UI.setPreview(file);
  });

  const drop=$('dropzone');
  drop.addEventListener('click',e=>{if(!e.target.closest('button'))$('fileInput').click();});
  drop.addEventListener('keydown',e=>{
    if((e.key==='Enter'||e.key===' ')&&!e.target.closest('button')){$('fileInput').click();e.preventDefault();}
  });
  for(const event of ['dragenter','dragover'])drop.addEventListener(event,e=>{e.preventDefault();drop.classList.add('dragging');});
  for(const event of ['dragleave','drop'])drop.addEventListener(event,e=>{e.preventDefault();drop.classList.remove('dragging');});
  drop.addEventListener('drop',e=>{
    const file=e.dataTransfer.files?.[0];
    if(file){state.file=file;UI.setPreview(file);}
  });

  $('removeImage').addEventListener('click',e=>{
    e.stopPropagation();state.file=null;$('fileInput').value='';UI.clearPreview();
  });
  $('analyzeBtn').addEventListener('click',runAnalysis);
  $('newCorrection').addEventListener('click',resetAll);
  $('printResult').addEventListener('click',()=>window.print());

  $('closeModal').addEventListener('click',UI.closeModal);
  $('questionModal').addEventListener('click',e=>{if(e.target.id==='questionModal')UI.closeModal();});

  $('copyResult').addEventListener('click',async()=>{
    if(!state.result)return;
    const text=UI.buildSummaryExport(state.result,state.items);
    try{await navigator.clipboard.writeText(text);UI.toast('Resultado copiado.','success');}
    catch{UI.toast('Não foi possível copiar automaticamente.','error');}
  });

  $('scrollUpload').addEventListener('click',()=>document.getElementById('uploadSection').scrollIntoView({behavior:'smooth'}));

  UI.setStep(0);
}

window.HEY_ENEM={state,runAnalysis,resetAll};
document.addEventListener('DOMContentLoaded',init);
