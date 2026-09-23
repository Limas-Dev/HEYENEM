const MAX_FILE_BYTES = 12 * 1024 * 1024;
const TARGET_BYTES = 2.7 * 1024 * 1024;
const TOTAL_QUESTIONS = 90;

const PROMPT = `Você é o módulo de VISÃO do HeyENEM.

Sua única função é ler visualmente uma folha de respostas de uma prova com EXATAMENTE 90 questões, numeradas de 01 a 90.

Além das respostas, tente identificar os dados do estudante presentes no cabeçalho:
- nome completo;
- documento (CPF, RG ou outro documento visível);
- matrícula, se existir.

NÃO invente nenhum dado. Se um campo não puder ser lido com segurança, use string vazia.

REGRAS PARA AS QUESTÕES:
- Examine a folha inteira.
- Identifique somente a marcação feita pelo estudante.
- Ignore letras impressas, números, círculos vazios, cabeçalhos, legendas e exemplos.
- Ignore completamente qualquer região impressa como “EXEMPLO DE RESPOSTA”.
- Uma questão sem marcação deve ser "blank".
- Duas ou mais alternativas marcadas devem ser "ambiguous".
- Uma marca ilegível também deve ser "ambiguous".
- Nunca invente uma alternativa.
- Não calcule nota, média, dificuldade ou estatística.
- A posição deve corresponder exatamente à questão.
- Retorne exatamente 90 questões, do número 1 ao 90.
- confidence deve ficar entre 0 e 1.

Responda APENAS JSON válido neste formato:
{
  "student": {
    "name": "",
    "document": "",
    "registration": ""
  },
  "sheetDetected": true,
  "sheetQuality": "good",
  "isBlankSheet": false,
  "questions": [
    {"number":1,"answer":"A","confidence":0.98}
  ],
  "notes":""
}

answer só pode ser A, B, C, D, E, blank ou ambiguous.
sheetQuality só pode ser good, acceptable, poor ou invalid.`;

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
    reader.readAsDataURL(file);
  });
}

async function compressImage(file) {
  if (file.size <= TARGET_BYTES && ['image/jpeg','image/png','image/webp'].includes(file.type)) {
    const dataUrl = await fileToDataURL(file);
    return { base64: dataUrl.split(',')[1], mimeType: file.type };
  }

  const dataUrl = await fileToDataURL(file);
  const img = new Image();

  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error('Imagem inválida ou formato não suportado pelo navegador.'));
    img.src = dataUrl;
  });

  const maxSides = [3000, 2600, 2200, 1900, 1600, 1400];

  for (const maxSide of maxSides) {
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) continue;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    for (const quality of [0.88, 0.80, 0.72, 0.64, 0.56]) {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (!blob || blob.size > TARGET_BYTES) continue;

      const compressed = await fileToDataURL(blob);
      return { base64: compressed.split(',')[1], mimeType: 'image/jpeg' };
    }
  }

  throw new Error('Não foi possível reduzir a imagem para um tamanho seguro.');
}

function cleanJson(text) {
  const value = String(text || '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  return start >= 0 && end > start ? value.slice(start, end + 1) : value;
}

export async function analyzeSheet(file) {
  if (!file) throw new Error('Selecione uma imagem.');
  if (file.size > MAX_FILE_BYTES) throw new Error('A imagem original é muito grande. Use uma foto de até 12 MB.');

  const image = await compressImage(file);

  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: PROMPT,
      imageBase64: image.base64,
      mimeType: image.mimeType
    })
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const parts = [payload.error || 'A API de análise recusou a solicitação.'];
    if (payload.apiCode) parts.push(`código ${payload.apiCode}`);
    if (payload.apiStatus) parts.push(payload.apiStatus);
    if (payload.model) parts.push(`modelo ${payload.model}`);
    throw new Error(parts.join(' · '));
  }

  const questions = Array.from({ length: TOTAL_QUESTIONS }, (_, i) => {
    const number = i + 1;
    const found = Array.isArray(payload.questions)
      ? payload.questions.find(x => Number(x.number) === number)
      : null;

    const raw = String(found?.answer || '').toLowerCase();
    const answer = ['a','b','c','d','e'].includes(raw)
      ? raw.toUpperCase()
      : (raw === 'blank' || raw === 'ambiguous' ? raw : 'ambiguous');

    const confidence = Math.max(0, Math.min(1, Number(found?.confidence ?? 0)));

    return {
      question: number,
      answer,
      confidence
    };
  });

  return {
    model: payload.model || 'gemini',
    student: {
      name: String(payload.student?.name || '').trim(),
      document: String(payload.student?.document || '').trim(),
      registration: String(payload.student?.registration || '').trim()
    },
    sheetDetected: payload.sheetDetected !== false,
    sheetQuality: payload.sheetQuality || 'acceptable',
    notes: String(payload.notes || ''),
    questions
  };
}
