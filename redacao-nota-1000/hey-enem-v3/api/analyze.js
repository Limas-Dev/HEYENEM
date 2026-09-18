const MODEL=process.env.GEMINI_MODEL||'gemini-3.6-flash';
const MAX_BODY_CHARS=5_000_000;
const QUESTIONS=Array.from({length:45},(_,i)=>136+i);

function send(res,status,body){return res.status(status).json(body);}
function clean(text){
  return String(text||'').trim().replace(/^```json/i,'').replace(/^```/,'').replace(/```$/,'').trim();
}

export default async function handler(req,res){
  if(req.method!=='POST') return send(res,405,{error:'Método não permitido.'});
  if(!process.env.GEMINI_API_KEY) return send(res,500,{error:'GEMINI_API_KEY não está configurada na Vercel.'});

  try{
    const body=req.body||{};
    const prompt=String(body.prompt||'');
    const mimeType=String(body.mimeType||'image/jpeg');
    const imageBase64=String(body.imageBase64||'');

    if(!prompt||!imageBase64) return send(res,400,{error:'Prompt ou imagem ausente.'});
    if(JSON.stringify(body).length>MAX_BODY_CHARS) return send(res,413,{error:'Imagem muito grande para a requisição.'});
    if(!['image/jpeg','image/png','image/webp'].includes(mimeType)) return send(res,400,{error:'Formato de imagem não suportado.'});

    const endpoint=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`;
    const google=await fetch(endpoint,{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'x-goog-api-key':process.env.GEMINI_API_KEY
      },
      body:JSON.stringify({
        contents:[{
          role:'user',
          parts:[
            {text:prompt},
            {inline_data:{mime_type:mimeType,data:imageBase64}}
          ]
        }],
        generationConfig:{
          response_mime_type:'application/json',
          response_schema:{
            type:'OBJECT',
            properties:{
              answers:{
                type:'ARRAY',
                minItems:45,
                maxItems:45,
                items:{
                  type:'OBJECT',
                  properties:{
                    question:{type:'INTEGER'},
                    answer:{type:'STRING',nullable:true},
                    confidence:{type:'NUMBER'}
                  },
                  required:['question','answer','confidence']
                }
              }
            },
            required:['answers']
          },
          max_output_tokens:5000,
          temperature:0
        }
      })
    });

    const data=await google.json();
    if(!google.ok){
      const detail=data?.error?.message||'A Gemini API recusou a solicitação.';
      console.error('Gemini:',data?.error||data);
      return send(res,google.status>=500?502:400,{error:detail});
    }

    const text=data?.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||'';
    if(!text) return send(res,502,{error:'A Gemini não retornou conteúdo.'});

    let parsed;
    try{parsed=JSON.parse(clean(text));}
    catch{ return send(res,502,{error:'A resposta da Gemini não veio em JSON válido.'}); }

    const answers=QUESTIONS.map(question=>{
      const found=Array.isArray(parsed.answers)?parsed.answers.find(x=>Number(x.question)===question):null;
      const raw=String(found?.answer||'').toUpperCase();
      const answer=['A','B','C','D','E'].includes(raw)?raw:null;
      const confidence=Math.max(0,Math.min(1,Number(found?.confidence??0)));
      return {question,answer,confidence};
    });

    return send(res,200,{model:MODEL,answers});
  }catch(error){
    console.error(error);
    return send(res,500,{error:error?.message||'Erro interno ao analisar a folha.'});
  }
}
