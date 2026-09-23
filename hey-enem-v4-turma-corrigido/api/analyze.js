const MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const MAX_BODY_CHARS = 5_000_000;
const TOTAL_QUESTIONS = 90;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

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

function normalizeAnswer(value) {
  const answer = String(value ?? '').trim().toLowerCase();

  if (['a', 'b', 'c', 'd', 'e'].includes(answer)) return answer;
  if (answer === 'blank' || answer === 'ambiguous') return answer;

  return 'ambiguous';
}

function normalizeQuestions(rawQuestions) {
  const source = Array.isArray(rawQuestions) ? rawQuestions : [];

  return Array.from({ length: TOTAL_QUESTIONS }, (_, index) => {
    const number = index + 1;
    const found = source.find(item => Number(item?.number) === number);
    const confidenceNumber = Number(found?.confidence);

    return {
      number,
      answer: normalizeAnswer(found?.answer),
      confidence: Number.isFinite(confidenceNumber)
        ? Math.max(0, Math.min(1, confidenceNumber))
        : 0
    };
  });
}

function buildRequest(prompt, mimeType, imageBase64) {
  // REST puro: use os nomes de campos aceitos pelo endpoint v1beta.
  // Evitamos response_schema aqui porque alguns modelos/contas podem
  // recusar determinadas combinações de schema com uma imagem.
  return {
    contents: [
      {
        role: 'user',
        parts: [
          {
            inline_data: {
              mime_type: mimeType,
              data: imageBase64
            }
          },
          { text: prompt }
        ]
      }
    ],
    generation_config: {
      response_mime_type: 'application/json',
      max_output_tokens: 10000
    }
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return send(res, 405, { error: 'Método não permitido.' });
  }

  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    return send(res, 500, {
      error: 'GEMINI_API_KEY não está configurada na Vercel.'
    });
  }

  try {
    const body = req.body || {};
    const prompt = String(body.prompt || '').trim();
    const mimeType = String(body.mimeType || 'image/jpeg').trim().toLowerCase();
    const imageBase64 = String(body.imageBase64 || '').trim();

    if (!prompt || !imageBase64) {
      return send(res, 400, { error: 'Prompt ou imagem ausente.' });
    }

    const bodySize = JSON.stringify(body).length;
    if (bodySize > MAX_BODY_CHARS) {
      return send(res, 413, {
        error: 'Imagem muito grande para a requisição. Tente uma imagem menor.'
      });
    }

    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return send(res, 400, {
        error: `Formato de imagem não suportado: ${mimeType}. Use JPG, PNG ou WEBP.`
      });
    }

    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`;

    const requestBody = buildRequest(prompt, mimeType, imageBase64);

    const google = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify(requestBody)
    });

    const rawText = await google.text();
    let data = {};

    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      data = { raw: rawText };
    }

    if (!google.ok) {
      const googleError = data?.error || {};
      const detail = googleError?.message || 'A Gemini API recusou a solicitação.';
      const code = googleError?.code || google.status;
      const status = googleError?.status || google.statusText || 'API_ERROR';

      console.error('Gemini API error:', {
        httpStatus: google.status,
        code,
        status,
        message: detail,
        model: MODEL,
        mimeType,
        bodySize
      });

      // Mensagem mais útil para o frontend, sem expor a chave.
      return send(res, google.status >= 500 ? 502 : google.status, {
        error: detail,
        apiCode: code,
        apiStatus: status,
        model: MODEL
      });
    }

    const text = data?.candidates?.[0]?.content?.parts
      ?.map(part => part?.text || '')
      .join('') || '';

    if (!text) {
      const finishReason = data?.candidates?.[0]?.finishReason || 'UNKNOWN';
      return send(res, 502, {
        error: `A Gemini não retornou conteúdo analisável. Motivo: ${finishReason}.`,
        model: MODEL
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(clean(text));
    } catch (error) {
      console.error('JSON Gemini inválido:', text.slice(0, 1200));
      return send(res, 502, {
        error: 'A Gemini respondeu, mas o JSON retornado não pôde ser lido.',
        model: MODEL
      });
    }

    const questions = normalizeQuestions(parsed.questions);

    return send(res, 200, {
      model: MODEL,
      student: {
        name: String(parsed?.student?.name || '').trim(),
        document: String(parsed?.student?.document || '').trim(),
        registration: String(parsed?.student?.registration || '').trim()
      },
      sheetDetected: parsed?.sheetDetected !== false,
      sheetQuality: String(parsed?.sheetQuality || 'acceptable'),
      isBlankSheet: parsed?.isBlankSheet === true,
      questions,
      notes: String(parsed?.notes || '').trim()
    });

  } catch (error) {
    console.error('Erro interno /api/analyze:', error);
    return send(res, 500, {
      error: error?.message || 'Erro interno ao analisar a folha.'
    });
  }
}
