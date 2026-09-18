const MAX_FILE_BYTES=12*1024*1024;
const TARGET_BYTES=2.7*1024*1024;

const PROMPT=`Você é o módulo de VISÃO do HeyENEM. Sua única função é ler uma folha de respostas de uma prova de Natureza e identificar as alternativas efetivamente marcadas pelo aluno.

A folha possui exatamente 45 questões, numeradas de 136 a 180.
Retorne as 45 questões em ordem numérica.

REGRAS:
- Examine a folha inteira antes de responder.
- Identifique somente a marcação feita pelo aluno.
- Ignore letras impressas, números, círculos vazios, cabeçalhos, legendas e exemplos de resposta.
- Ignore especificamente qualquer área impressa como "EXEMPLO DE RESPOSTA".
- Se estiver sem marcação: answer=null, confidence=0.
- Se houver duas alternativas marcadas na mesma questão: answer=null, confidence baixo.
- Se a marcação estiver ilegível: answer=null.
- Nunca invente uma alternativa.
- confidence é 0 a 1.
- NÃO calcule acertos, nota, percentual, TRI ou qualquer estatística.
- Responda apenas JSON válido.

Formato:
{"answers":[{"question":136,"answer":"A","confidence":0.97}, ...]} `;

function fileToDataURL(file){
  return new Promise((resolve,reject)=>{
    const r=new FileReader();
    r.onload=()=>resolve(String(r.result));
    r.onerror=()=>reject(new Error('Não foi possível ler a imagem.'));
    r.readAsDataURL(file);
  });
}

async function compressImage(file){
  if(file.size<=TARGET_BYTES && ['image/jpeg','image/png','image/webp'].includes(file.type)){
    const dataUrl=await fileToDataURL(file);
    return {base64:dataUrl.split(',')[1],mimeType:file.type};
  }
  const dataUrl=await fileToDataURL(file);
  const img=new Image();
  await new Promise((resolve,reject)=>{
    img.onload=resolve; img.onerror=()=>reject(new Error('Imagem inválida.'));
    img.src=dataUrl;
  });
  const maxSides=[3000,2600,2200,1900,1600];
  for(const maxSide of maxSides){
    const scale=Math.min(1,maxSide/Math.max(img.naturalWidth,img.naturalHeight));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));
    canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
    const ctx=canvas.getContext('2d',{alpha:false});
    ctx.fillStyle='#fff'; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(img,0,0,canvas.width,canvas.height);
    for(const quality of [0.88,0.80,0.72,0.64]){
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));
      if(blob && blob.size<=TARGET_BYTES){
        const compressed=await fileToDataURL(blob);
        return {base64:compressed.split(',')[1],mimeType:'image/jpeg'};
      }
    }
  }
  throw new Error('Não foi possível reduzir a imagem para um tamanho seguro.');
}

function parseJson(text){
  const raw=String(text||'').trim().replace(/^```json/i,'').replace(/^```/,'').replace(/```$/,'').trim();
  return JSON.parse(raw);
}

export async function analyzeSheet(file){
  if(!file) throw new Error('Selecione uma imagem.');
  if(file.size>MAX_FILE_BYTES) throw new Error('A imagem original é muito grande. Escolha uma foto de até 12 MB.');
  const image=await compressImage(file);

  const response=await fetch('/api/analyze',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({prompt:PROMPT,imageBase64:image.base64,mimeType:image.mimeType})
  });
  const payload=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(payload.error||'A API de análise recusou a solicitação.');

  const answers=Array.from({length:45},(_,i)=>{
    const question=136+i;
    const found=Array.isArray(payload.answers)?payload.answers.find(x=>Number(x.question)===question):null;
    const raw=String(found?.answer||'').toUpperCase();
    const answer=['A','B','C','D','E'].includes(raw)?raw:null;
    const confidence=Math.max(0,Math.min(1,Number(found?.confidence??0)));
    return {question,answer,confidence};
  });
  return {model:payload.model||'gemini',answers};
}
