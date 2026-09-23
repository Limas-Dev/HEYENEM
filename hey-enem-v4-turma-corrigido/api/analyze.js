const PRIMARY_MODEL =
  process.env.GEMINI_MODEL ||
  'gemini-3.6-flash';

/*
  Modelo reserva.
  Pode ser alterado na Vercel com:
  GEMINI_FALLBACK_MODEL=...
*/
const FALLBACK_MODEL =
  process.env.GEMINI_FALLBACK_MODEL ||
  'gemini-3.5-flash-lite';

const MAX_BODY_CHARS =
  5_000_000;

const TOTAL_QUESTIONS =
  90;

const ALLOWED_MIME_TYPES =
  new Set([
    'image/jpeg',
    'image/png',
    'image/webp'
  ]);

/*
  Evita que uma chamada fique presa
  indefinidamente na função serverless.
*/
const REQUEST_TIMEOUT_MS =
  45_000;

/* ============================================================
   RESPONSE
   ============================================================ */

function send(
  res,
  status,
  body
) {
  return res
    .status(status)
    .json(body);
}

/* ============================================================
   LIMPEZA DO JSON
   ============================================================ */

function clean(text) {
  const value =
    String(text || '')
      .trim()
      .replace(
        /^```json\s*/i,
        ''
      )
      .replace(
        /^```\s*/i,
        ''
      )
      .replace(
        /\s*```$/i,
        ''
      )
      .trim();

  const start =
    value.indexOf('{');

  const end =
    value.lastIndexOf('}');

  return start >= 0 &&
    end > start
    ? value.slice(
        start,
        end + 1
      )
    : value;
}

/* ============================================================
   RESPOSTA DA QUESTÃO
   ============================================================ */

function normalizeAnswer(
  value
) {
  const answer =
    String(value ?? '')
      .trim()
      .toLowerCase();

  if (
    [
      'a',
      'b',
      'c',
      'd',
      'e'
    ].includes(answer)
  ) {
    return answer;
  }

  if (
    answer === 'blank' ||
    answer === 'ambiguous'
  ) {
    return answer;
  }

  return 'ambiguous';
}

/* ============================================================
   NORMALIZA 90 QUESTÕES
   ============================================================ */

function normalizeQuestions(
  rawQuestions
) {
  const source =
    Array.isArray(rawQuestions)
      ? rawQuestions
      : [];

  return Array.from(
    {
      length:
        TOTAL_QUESTIONS
    },
    (_, index) => {
      const number =
        index + 1;

      const found =
        source.find(
          item =>
            Number(
              item?.number
            ) === number
        );

      const confidenceNumber =
        Number(
          found?.confidence
        );

      return {
        number,

        answer:
          normalizeAnswer(
            found?.answer
          ),

        confidence:
          Number.isFinite(
            confidenceNumber
          )
            ? Math.max(
                0,
                Math.min(
                  1,
                  confidenceNumber
                )
              )
            : 0
      };
    }
  );
}

/* ============================================================
   REQUEST PARA O GEMINI
   ============================================================ */

function buildRequest(
  prompt,
  mimeType,
  imageBase64
) {
  return {
    contents: [
      {
        role: 'user',

        parts: [
          {
            inline_data: {
              mime_type:
                mimeType,

              data:
                imageBase64
            }
          },

          {
            text:
              prompt
          }
        ]
      }
    ],

    generation_config: {
      response_mime_type:
        'application/json',

      max_output_tokens:
        10000
    }
  };
}

/* ============================================================
   ERROS TEMPORÁRIOS
   ============================================================ */

function isRetryableStatus(
  status
) {
  return [
    408,
    425,
    429,
    500,
    502,
    503,
    504
  ].includes(
    Number(status)
  );
}

/* ============================================================
   MODELOS DISPONÍVEIS
   ============================================================ */

function modelChain() {
  return [
    ...new Set(
      [
        PRIMARY_MODEL,
        FALLBACK_MODEL
      ].filter(Boolean)
    )
  ];
}

/* ============================================================
   CHAMADA INDIVIDUAL AO GEMINI
   ============================================================ */

async function callGemini(
  model,
  requestBody,
  apiKey
) {
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent`;

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => {
        controller.abort();
      },
      REQUEST_TIMEOUT_MS
    );

  try {
    const response =
      await fetch(
        endpoint,
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json',

            'x-goog-api-key':
              apiKey
          },

          body:
            JSON.stringify(
              requestBody
            ),

          signal:
            controller.signal
        }
      );

    const rawText =
      await response.text();

    let data = {};

    try {
      data =
        rawText
          ? JSON.parse(
              rawText
            )
          : {};
    } catch {
      data = {
        raw: rawText
      };
    }

    /* --------------------------------------------------------
       ERRO DA GOOGLE
       -------------------------------------------------------- */

    if (!response.ok) {
      const googleError =
        data?.error || {};

      return {
        ok: false,

        httpStatus:
          response.status,

        apiCode:
          googleError?.code ||
          response.status,

        apiStatus:
          googleError?.status ||
          response.statusText ||
          'API_ERROR',

        message:
          googleError?.message ||
          'A Gemini API recusou a solicitação.'
      };
    }

    return {
      ok: true,

      httpStatus:
        response.status,

      data
    };
  } catch (error) {
    /* --------------------------------------------------------
       TIMEOUT
       -------------------------------------------------------- */

    if (
      error?.name ===
      'AbortError'
    ) {
      return {
        ok: false,

        httpStatus: 504,

        apiCode: 504,

        apiStatus:
          'DEADLINE_EXCEEDED',

        message:
          'A Gemini demorou mais do que o tempo máximo esperado para responder.'
      };
    }

    /* --------------------------------------------------------
       ERRO DE CONEXÃO
       -------------------------------------------------------- */

    return {
      ok: false,

      httpStatus: 502,

      apiCode: 502,

      apiStatus:
        'BAD_GATEWAY',

      message:
        error?.message ||
        'Não foi possível conectar à Gemini API.'
    };
  } finally {
    clearTimeout(timeout);
  }
}

/* ============================================================
   TEXTO DA RESPOSTA
   ============================================================ */

function extractText(
  data
) {
  return data
    ?.candidates?.[0]
    ?.content?.parts
    ?.map(
      part =>
        part?.text || ''
    )
    .join('') || '';
}

/* ============================================================
   HANDLER
   ============================================================ */

export default async function handler(
  req,
  res
) {
  /* ----------------------------------------------------------
     MÉTODO
     ---------------------------------------------------------- */

  if (req.method !== 'POST') {
    return send(
      res,
      405,
      {
        error:
          'Método não permitido.'
      }
    );
  }

  /* ----------------------------------------------------------
     API KEY
     ---------------------------------------------------------- */

  const apiKey =
    String(
      process.env.GEMINI_API_KEY ||
        ''
    ).trim();

  if (!apiKey) {
    return send(
      res,
      500,
      {
        error:
          'GEMINI_API_KEY não está configurada na Vercel.'
      }
    );
  }

  try {
    const body =
      req.body || {};

    const prompt =
      String(
        body.prompt || ''
      ).trim();

    const mimeType =
      String(
        body.mimeType ||
          'image/jpeg'
      )
        .trim()
        .toLowerCase();

    const imageBase64 =
      String(
        body.imageBase64 ||
          ''
      ).trim();

    /* --------------------------------------------------------
       INPUT
       -------------------------------------------------------- */

    if (
      !prompt ||
      !imageBase64
    ) {
      return send(
        res,
        400,
        {
          error:
            'Prompt ou imagem ausente.'
        }
      );
    }

    /* --------------------------------------------------------
       TAMANHO
       -------------------------------------------------------- */

    const bodySize =
      JSON.stringify(
        body
      ).length;

    if (
      bodySize >
      MAX_BODY_CHARS
    ) {
      return send(
        res,
        413,
        {
          error:
            'Imagem muito grande para a requisição. Tente uma imagem menor.'
        }
      );
    }

    /* --------------------------------------------------------
       MIME
       -------------------------------------------------------- */

    if (
      !ALLOWED_MIME_TYPES.has(
        mimeType
      )
    ) {
      return send(
        res,
        400,
        {
          error:
            `Formato de imagem não suportado: ${mimeType}. Use JPG, PNG ou WEBP.`
        }
      );
    }

    /* --------------------------------------------------------
       MONTA PAYLOAD
       -------------------------------------------------------- */

    const requestBody =
      buildRequest(
        prompt,
        mimeType,
        imageBase64
      );

    /* --------------------------------------------------------
       DEFINE MODELOS
       -------------------------------------------------------- */

    const models =
      modelChain();

    const failures = [];

    /* --------------------------------------------------------
       TENTA MODELOS EM ORDEM
       -------------------------------------------------------- */

    for (
      let index = 0;
      index < models.length;
      index++
    ) {
      const model =
        models[index];

      const result =
        await callGemini(
          model,
          requestBody,
          apiKey
        );

      /* ------------------------------------------------------
         FALHA
         ------------------------------------------------------ */

      if (!result.ok) {
        failures.push({
          model,

          httpStatus:
            result.httpStatus,

          apiCode:
            result.apiCode,

          apiStatus:
            result.apiStatus,

          message:
            result.message
        });

        console.error(
          'Gemini API error:',
          {
            model,

            httpStatus:
              result.httpStatus,

            code:
              result.apiCode,

            status:
              result.apiStatus,

            message:
              result.message,

            mimeType,

            bodySize
          }
        );

        const hasAnotherModel =
          index <
          models.length - 1;

        /*
          Se o primeiro modelo estiver temporariamente
          indisponível, tenta imediatamente o modelo reserva.

          Não fazemos isso para erro de API Key, argumento
          inválido ou permissão.
        */

        if (
          hasAnotherModel &&
          isRetryableStatus(
            result.httpStatus
          )
        ) {
          console.warn(
            `Modelo ${model} indisponível. Tentando modelo reserva ${models[index + 1]}.`
          );

          continue;
        }

        /*
          Mantemos o status real recebido da Google.
          Isso é importante para o frontend saber
          se deve fazer retry.
        */

        return send(
          res,
          Number(
            result.httpStatus
          ) || 502,
          {
            error:
              result.message,

            apiCode:
              result.apiCode,

            apiStatus:
              result.apiStatus,

            model,

            modelsTried:
              models.slice(
                0,
                index + 1
              ),

            retryable:
              isRetryableStatus(
                result.httpStatus
              )
          }
        );
      }

      /* ------------------------------------------------------
         EXTRAI TEXTO
         ------------------------------------------------------ */

      const text =
        extractText(
          result.data
        );

      if (!text) {
        const finishReason =
          result
            ?.data
            ?.candidates?.[0]
            ?.finishReason ||
          'UNKNOWN';

        return send(
          res,
          502,
          {
            error:
              `A Gemini não retornou conteúdo analisável. Motivo: ${finishReason}.`,

            model,

            modelsTried:
              models.slice(
                0,
                index + 1
              ),

            retryable:
              true
          }
        );
      }

      /* ------------------------------------------------------
         JSON
         ------------------------------------------------------ */

      let parsed;

      try {
        parsed =
          JSON.parse(
            clean(text)
          );
      } catch (error) {
        console.error(
          'JSON Gemini inválido:',
          text.slice(
            0,
            1200
          )
        );

        return send(
          res,
          502,
          {
            error:
              'A Gemini respondeu, mas o JSON retornado não pôde ser lido.',

            model,

            modelsTried:
              models.slice(
                0,
                index + 1
              ),

            retryable:
              true
          }
        );
      }

      /* ------------------------------------------------------
         NORMALIZA QUESTÕES
         ------------------------------------------------------ */

      const questions =
        normalizeQuestions(
          parsed.questions
        );

      /* ------------------------------------------------------
         SUCESSO
         ------------------------------------------------------ */

      return send(
        res,
        200,
        {
          model,

          /*
            true quando o primeiro modelo falhou
            e o segundo conseguiu processar.
          */
          fallbackUsed:
            index > 0,

          modelsTried:
            models.slice(
              0,
              index + 1
            ),

          student: {
            name:
              String(
                parsed
                  ?.student
                  ?.name || ''
              ).trim(),

            document:
              String(
                parsed
                  ?.student
                  ?.document || ''
              ).trim(),

            registration:
              String(
                parsed
                  ?.student
                  ?.registration ||
                  ''
              ).trim()
          },

          sheetDetected:
            parsed?.sheetDetected !==
            false,

          sheetQuality:
            String(
              parsed
                ?.sheetQuality ||
                'acceptable'
            ),

          isBlankSheet:
            parsed?.isBlankSheet ===
            true,

          questions,

          notes:
            String(
              parsed?.notes || ''
            ).trim()
        }
      );
    }

    /* --------------------------------------------------------
       TODOS OS MODELOS FALHARAM
       -------------------------------------------------------- */

    const last =
      failures.length
        ? failures[
            failures.length - 1
          ]
        : {};

    return send(
      res,
      Number(
        last.httpStatus
      ) || 503,
      {
        error:
          last.message ||
          'A Gemini não conseguiu processar a imagem.',

        apiCode:
          last.apiCode ||
          last.httpStatus ||
          503,

        apiStatus:
          last.apiStatus ||
          'UNAVAILABLE',

        model:
          last.model ||
          PRIMARY_MODEL,

        modelsTried:
          models,

        retryable:
          true
      }
    );
  } catch (error) {
    console.error(
      'Erro interno /api/analyze:',
      error
    );

    return send(
      res,
      500,
      {
        error:
          error?.message ||
          'Erro interno ao analisar a folha.',

        retryable:
          false
      }
    );
  }
}
