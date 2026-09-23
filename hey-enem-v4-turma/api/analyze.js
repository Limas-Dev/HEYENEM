const MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const MAX_BODY_CHARS = 5_000_000;
const TOTAL_QUESTIONS = 90;

function send(res, status, body) {
  return res.status(status).json(body);
}

function clean(text) {
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return send(res, 405, { error: 'Método não permitido.' });
  }

  if (!process.env.GEMINI_API_KEY) {
    return send(res, 500, { error: 'GEMINI_API_KEY não está configurada na Vercel.' });
  }

  try {
    const body = req.body || {};
    const prompt = String(body.prompt || '');
    const mimeType = String(body.mimeType || 'image/jpeg');
    const imageBase64 = String(body.imageBase64 || '');

    if (!prompt || !imageBase64) {
      return send(res, 400, { error: 'Prompt ou imagem ausente.' });
    }

    if (JSON.stringify(body).length > MAX_BODY_CHARS) {
      return send(res, 413, { error: 'Imagem muito grande para a requisição.' });
    }

    if (!['image/jpeg','image/png','image/webp'].includes(mimeType)) {
      return send(res, 400, { error: 'Formato de imagem não suportado.' });
    }

    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`;

    const google = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': process.env.GEMINI_API_KEY
      },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType,
                data: imageBase64
              }
            }
          ]
        }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              student: {
                type: 'OBJECT',
                properties: {
                  name: { type: 'STRING' },
                  document: { type: 'STRING' },
                  registration: { type: 'STRING' }
                },
                required: ['name','document','registration']
              },
              sheetDetected: { type: 'BOOLEAN' },
              sheetQuality: { type: 'STRING' },
              isBlankSheet: { type: 'BOOLEAN' },
              questions: {
                type: 'ARRAY',
                minItems: TOTAL_QUESTIONS,
                maxItems: TOTAL_QUESTIONS,
                items: {
                  type: 'OBJECT',
                  properties: {
                    number: { type: 'INTEGER' },
                    answer: { type: 'STRING' },
                    confidence: { type: 'NUMBER' }
                  },
                  required: ['number','answer','confidence']
                }
              },
              notes: { type: 'STRING' }
            },
            required: ['student','sheetDetected','sheetQuality','isBlankSheet','questions','notes']
          },
          maxOutputTokens: 8000
        }
      })
    });

    const data = await google.json();

    if (!google.ok) {
      const detail = data?.error?.message || 'A Gemini API recusou a solicitação.';
      console.error('Gemini:', data?.error || data);
      return send(res, google.status >= 500 ? 502 : 400, { error: detail });
    }

    const text = data?.candidates?.[0]?.content?.parts
      ?.map(part => part?.text || '')
      .join('') || '';

    if (!text) {
      return send(res, 502, { error: 'A Gemini não retornou conteúdo.' });
    }

    let parsed;
    try {
      parsed = JSON.parse(clean(text));
    } catch {
      return send(res, 502, { error: 'A resposta da Gemini não veio em JSON válido.' });
    }

    const questions = Array.from({ length: TOTAL_QUESTIONS }, (_, i) => {
      const number = i + 1;
      const found = Array.isArray(parsed.questions)
        ? parsed.questions.find(x => Number(x.number) === number)
        : null;

      const raw = String(found?.answer || '').toLowerCase();
      let answer = raw;

      if (!['a','b','c','d','e','blank','ambiguous'].includes(answer)) {
        answer = 'ambiguous';
      }

      const confidence = Math.max(
        0,
        Math.min(1, Number(found?.confidence ?? 0))
      );

      return {
        number,
        answer,
        confidence
      };
    });

    return send(res, 200, {
      model: MODEL,
      student: {
        name: String(parsed.student?.name || '').trim(),
        document: String(parsed.student?.document || '').trim(),
        registration: String(parsed.student?.registration || '').trim()
      },
      sheetDetected: parsed.sheetDetected !== false,
      sheetQuality: parsed.sheetQuality || 'acceptable',
      isBlankSheet: parsed.isBlankSheet === true,
      questions,
      notes: String(parsed.notes || '')
    });

  } catch (error) {
    console.error(error);
    return send(res, 500, {
      error: error?.message || 'Erro interno ao analisar a folha.'
    });
  }
}
