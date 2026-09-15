/**
 * HEY ENEM!
 * API de geração de temas e correção de redações
 *
 * Arquivo:
 * /api/avaliar.js
 *
 * Variáveis da Vercel:
 * GEMINI_API_KEY = sua chave do Google AI Studio
 * GEMINI_MODEL   = opcional
 *
 * Modelo padrão:
 * gemini-2.5-flash
 */

const DEFAULT_MODEL =
    process.env.GEMINI_MODEL || "gemini-2.5-flash";

const MAX_REQUEST_BYTES = 4_000_000;
const MAX_TOTAL_BASE64 = 3_000_000;

/* ---------------------------------------------------------
   UTILIDADES
--------------------------------------------------------- */

function sendJSON(res, status, data) {
    res.status(status);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.json(data);
}

function getBody(req) {
    if (!req.body) return {};

    if (typeof req.body === "object") {
        return req.body;
    }

    if (typeof req.body === "string") {
        try {
            return JSON.parse(req.body);
        } catch {
            throw new Error("O corpo da requisição não contém JSON válido.");
        }
    }

    return {};
}

function cleanText(value, maxLength = 30000) {
    if (typeof value !== "string") return "";
    return value.trim().slice(0, maxLength);
}

function normalizeScore(value) {
    let score = Number(value);

    if (!Number.isFinite(score)) {
        return 0;
    }

    // A competência do ENEM trabalha em múltiplos de 40.
    score = Math.round(score / 40) * 40;

    return Math.max(0, Math.min(200, score));
}

function extractGeminiText(data) {
    try {
        const candidates = data?.candidates;

        if (!Array.isArray(candidates) || !candidates.length) {
            return "";
        }

        const parts = candidates[0]?.content?.parts;

        if (!Array.isArray(parts)) {
            return "";
        }

        return parts
            .map(part => part?.text || "")
            .filter(Boolean)
            .join("\n")
            .trim();
    } catch {
        return "";
    }
}

function parseModelJSON(text) {
    if (!text) {
        throw new Error("O Gemini não retornou conteúdo.");
    }

    // Primeiro tenta JSON puro.
    try {
        return JSON.parse(text);
    } catch {}

    // Remove ```json ... ```
    const cleaned = text
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

    try {
        return JSON.parse(cleaned);
    } catch {}

    // Procura o primeiro objeto JSON.
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");

    if (first !== -1 && last !== -1 && last > first) {
        const possibleJSON = cleaned.slice(first, last + 1);

        try {
            return JSON.parse(possibleJSON);
        } catch {}
    }

    throw new Error(
        "O Gemini respondeu, mas a resposta não veio em JSON válido."
    );
}

function normalizeMimeType(mime) {
    if (typeof mime !== "string") {
        return "image/jpeg";
    }

    const allowed = [
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/webp",
        "image/heic",
        "image/heif",
        "image/avif"
    ];

    return allowed.includes(mime.toLowerCase())
        ? mime.toLowerCase()
        : "image/jpeg";
}

function validateImages(images) {
    if (!Array.isArray(images)) {
        return [];
    }

    const valid = [];
    let total = 0;

    for (const image of images.slice(0, 5)) {
        if (!image || typeof image !== "object") {
            continue;
        }

        const data = typeof image.data === "string"
            ? image.data.replace(/^data:[^;]+;base64,/, "")
            : "";

        if (!data) {
            continue;
        }

        if (!/^[A-Za-z0-9+/=\s]+$/.test(data)) {
            continue;
        }

        total += data.length;

        if (total > MAX_TOTAL_BASE64) {
            throw new Error(
                "As imagens enviadas são grandes demais. Reduza a quantidade ou o tamanho das fotos."
            );
        }

        valid.push({
            mimeType: normalizeMimeType(image.mimeType),
            data
        });
    }

    return valid;
}

/* ---------------------------------------------------------
   CHAMADA AO GEMINI
--------------------------------------------------------- */

async function callGemini(contents, options = {}) {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        const error = new Error(
            "GEMINI_API_KEY não está configurada na Vercel."
        );

        error.code = "MISSING_API_KEY";
        error.status = 500;

        throw error;
    }

    const model = options.model || DEFAULT_MODEL;

    const url =
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    const payload = {
        contents,

        generationConfig: {
            temperature:
                typeof options.temperature === "number"
                    ? options.temperature
                    : 0.4,

            topP: 0.9,

            maxOutputTokens:
                options.maxOutputTokens || 5000,

            responseMimeType: "application/json"
        }
    };

    const controller = new AbortController();

    const timeout = setTimeout(() => {
        controller.abort();
    }, 55_000);

    let response;

    try {
        response = await fetch(url, {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": apiKey
            },

            body: JSON.stringify(payload),

            signal: controller.signal
        });
    } catch (error) {
        clearTimeout(timeout);

        if (error?.name === "AbortError") {
            const timeoutError = new Error(
                "O Gemini demorou demais para responder. Tente novamente."
            );

            timeoutError.code = "GEMINI_TIMEOUT";
            timeoutError.status = 504;

            throw timeoutError;
        }

        throw error;
    }

    clearTimeout(timeout);

    const raw = await response.text();

    let data = {};

    try {
        data = raw ? JSON.parse(raw) : {};
    } catch {
        data = {
            raw
        };
    }

    if (!response.ok) {
        console.error("========== ERRO GEMINI ==========");
        console.error("HTTP:", response.status);
        console.error(
            "Resposta:",
            JSON.stringify(data, null, 2)
        );
        console.error("=================================");

        const googleMessage =
            data?.error?.message ||
            data?.message ||
            data?.error?.details?.[0]?.message ||
            raw ||
            "O Google recusou a solicitação.";

        const error = new Error(googleMessage);

        error.status = response.status;

        error.code =
            data?.error?.status ||
            data?.error?.reason ||
            "GEMINI_ERROR";

        error.googleError = data?.error || null;

        throw error;
    }

    const text = extractGeminiText(data);

    if (!text) {
        console.error(
            "Resposta sem texto:",
            JSON.stringify(data, null, 2)
        );

        throw new Error(
            "O Gemini recebeu a solicitação, mas não retornou texto."
        );
    }

    return parseModelJSON(text);
}

/* ---------------------------------------------------------
   PROMPT — GERAR TEMA
--------------------------------------------------------- */

function buildThemePrompt() {
    return `
Você é um especialista em elaboração de propostas de redação do ENEM.

Gere UMA proposta de tema de redação no padrão ENEM.

O tema deve:
- abordar um problema social brasileiro relevante;
- permitir discussão crítica;
- ser suficientemente específico;
- não exigir conhecimento acadêmico especializado;
- permitir uma proposta de intervenção;
- evitar temas excessivamente genéricos;
- não copiar temas oficiais anteriores;
- estar relacionado à realidade brasileira contemporânea.

Crie também textos motivadores curtos e informativos.

IMPORTANTE:
Não escreva uma redação pronta.
Não dê a resposta do tema.
Não inclua uma proposta de intervenção pronta.

RETORNE EXCLUSIVAMENTE JSON válido neste formato:

{
  "tema": "Título completo do tema",
  "recorte": "Uma frase explicando o recorte temático.",
  "contexto": "Breve contextualização.",
  "textos_motivadores": [
    {
      "titulo": "Texto motivador 1",
      "texto": "Texto motivador..."
    },
    {
      "titulo": "Texto motivador 2",
      "texto": "Texto motivador..."
    },
    {
      "titulo": "Texto motivador 3",
      "texto": "Texto motivador..."
    }
  ],
  "comando": "A partir da leitura dos textos motivadores e com base nos conhecimentos construídos ao longo de sua formação, redija texto dissertativo-argumentativo em modalidade escrita formal da língua portuguesa sobre o tema proposto, apresentando proposta de intervenção que respeite os direitos humanos."
}
`;
}

/* ---------------------------------------------------------
   PROMPT — CORREÇÃO
--------------------------------------------------------- */

function buildEvaluationPrompt({
    studentName,
    theme,
    essayText,
    trainingMode
}) {
    return `
Você é um avaliador especializado em redações do ENEM.

Avalie a redação de um estudante seguindo rigorosamente as cinco competências oficiais da redação do ENEM.

Nome do estudante:
${studentName || "Estudante"}

Modo:
${trainingMode || "Simulado"}

Tema:
${theme}

REDAÇÃO:
${essayText}

COMPETÊNCIAS:

Competência 1:
Domínio da modalidade escrita formal da língua portuguesa.

Competência 2:
Compreensão da proposta de redação e desenvolvimento do tema dentro dos limites estruturais do texto dissertativo-argumentativo.

Competência 3:
Seleção, relação, organização e interpretação de informações, fatos, opiniões e argumentos em defesa de um ponto de vista.

Competência 4:
Conhecimento dos mecanismos linguísticos necessários para a construção da argumentação.

Competência 5:
Elaboração de proposta de intervenção para o problema abordado, respeitando os direitos humanos.

A nota de cada competência deve ser obrigatoriamente:
0, 40, 80, 120, 160 ou 200.

A nota total deve ser a soma das cinco competências:
0 a 1000 pontos.

NÃO invente critérios diferentes dos utilizados na redação do ENEM.

Se houver problemas graves de fuga ao tema, trate isso explicitamente na análise.

Analise:
- tese;
- introdução;
- desenvolvimento;
- conclusão;
- repertório;
- argumentação;
- coesão;
- coerência;
- domínio linguístico;
- proposta de intervenção;
- erros gramaticais relevantes;
- pontos fortes;
- pontos que precisam ser melhorados.

Não seja excessivamente elogioso.
Não seja excessivamente punitivo.
Justifique as notas com evidências presentes na redação.

RETORNE EXCLUSIVAMENTE JSON válido neste formato:

{
  "competencias": {
    "c1": {
      "nota": 0,
      "nome": "Competência 1",
      "titulo": "Domínio da modalidade escrita formal",
      "analise": "Análise detalhada."
    },
    "c2": {
      "nota": 0,
      "nome": "Competência 2",
      "titulo": "Compreensão da proposta",
      "analise": "Análise detalhada."
    },
    "c3": {
      "nota": 0,
      "nome": "Competência 3",
      "titulo": "Seleção e organização dos argumentos",
      "analise": "Análise detalhada."
    },
    "c4": {
      "nota": 0,
      "nome": "Competência 4",
      "titulo": "Mecanismos linguísticos",
      "analise": "Análise detalhada."
    },
    "c5": {
      "nota": 0,
      "nome": "Competência 5",
      "titulo": "Proposta de intervenção",
      "analise": "Análise detalhada."
    }
  },

  "nota_total": 0,

  "diagnostico": {
    "resumo": "Resumo geral da redação.",
    "pontos_fortes": [
      "Ponto forte 1",
      "Ponto forte 2",
      "Ponto forte 3"
    ],
    "pontos_melhorar": [
      "Ponto a melhorar 1",
      "Ponto a melhorar 2",
      "Ponto a melhorar 3"
    ]
  },

  "estrutura": {
    "introducao": "Análise da introdução.",
    "desenvolvimento": "Análise dos parágrafos argumentativos.",
    "conclusao": "Análise da conclusão."
  },

  "linguagem": {
    "erros": [
      {
        "trecho": "Trecho problemático.",
        "correcao": "Forma sugerida.",
        "explicacao": "Explicação."
      }
    ]
  },

  "intervencao": {
    "agente": "Análise",
    "acao": "Análise",
    "meio": "Análise",
    "finalidade": "Análise",
    "detalhamento": "Análise"
  },

  "feedback_final": "Feedback final direcionado ao estudante."
}
`;
}

/* ---------------------------------------------------------
   NORMALIZAÇÃO DA AVALIAÇÃO
--------------------------------------------------------- */

function normalizeEvaluation(result) {
    const competencias = result?.competencias || {};

    const c1 = normalizeScore(competencias?.c1?.nota);
    const c2 = normalizeScore(competencias?.c2?.nota);
    const c3 = normalizeScore(competencias?.c3?.nota);
    const c4 = normalizeScore(competencias?.c4?.nota);
    const c5 = normalizeScore(competencias?.c5?.nota);

    return {
        ...result,

        competencias: {
            c1: {
                nota: c1,
                nome:
                    competencias?.c1?.nome ||
                    "Competência 1",
                titulo:
                    competencias?.c1?.titulo ||
                    "Domínio da modalidade escrita formal",
                analise:
                    competencias?.c1?.analise ||
                    ""
            },

            c2: {
                nota: c2,
                nome:
                    competencias?.c2?.nome ||
                    "Competência 2",
                titulo:
                    competencias?.c2?.titulo ||
                    "Compreensão da proposta",
                analise:
                    competencias?.c2?.analise ||
                    ""
            },

            c3: {
                nota: c3,
                nome:
                    competencias?.c3?.nome ||
                    "Competência 3",
                titulo:
                    competencias?.c3?.titulo ||
                    "Seleção e organização dos argumentos",
                analise:
                    competencias?.c3?.analise ||
                    ""
            },

            c4: {
                nota: c4,
                nome:
                    competencias?.c4?.nome ||
                    "Competência 4",
                titulo:
                    competencias?.c4?.titulo ||
                    "Mecanismos linguísticos",
                analise:
                    competencias?.c4?.analise ||
                    ""
            },

            c5: {
                nota: c5,
                nome:
                    competencias?.c5?.nome ||
                    "Competência 5",
                titulo:
                    competencias?.c5?.titulo ||
                    "Proposta de intervenção",
                analise:
                    competencias?.c5?.analise ||
                    ""
            }
        },

        nota_total: c1 + c2 + c3 + c4 + c5
    };
}

/* ---------------------------------------------------------
   LEGACY
   Aceita também o formato antigo do projeto.
--------------------------------------------------------- */

function detectLegacyRequest(body) {
    if (body?.action) {
        return null;
    }

    if (Array.isArray(body?.contents)) {
        const hasImage = JSON.stringify(body.contents)
            .includes("inline");

        return hasImage
            ? "evaluate"
            : "theme";
    }

    return null;
}

/* ---------------------------------------------------------
   HANDLER
--------------------------------------------------------- */

module.exports = async function handler(req, res) {
    try {
        /* -----------------------------------------------
           GET
        ------------------------------------------------ */

        if (req.method === "GET") {
            const configured = Boolean(
                process.env.GEMINI_API_KEY
            );

            /*
             * /api/avaliar
             *
             * Apenas verifica configuração.
             */
            if (req.query?.check !== "google") {
                return sendJSON(res, 200, {
                    ok: true,
                    configured,
                    model: DEFAULT_MODEL,
                    message: configured
                        ? "API Hey ENEM configurada corretamente."
                        : "GEMINI_API_KEY não configurada."
                });
            }

            /*
             * /api/avaliar?check=google
             *
             * Testa de verdade a comunicação com o Google.
             */

            if (!configured) {
                return sendJSON(res, 500, {
                    ok: false,
                    configured: false,
                    valid: false,
                    error: {
                        code: "MISSING_API_KEY",
                        message:
                            "GEMINI_API_KEY não está configurada na Vercel."
                    }
                });
            }

            const result = await callGemini(
                [
                    {
                        role: "user",
                        parts: [
                            {
                                text:
                                    'Responda somente com JSON: {"ok":true}'
                            }
                        ]
                    }
                ],
                {
                    temperature: 0,
                    maxOutputTokens: 50
                }
            );

            return sendJSON(res, 200, {
                ok: true,
                configured: true,
                valid: true,
                model: DEFAULT_MODEL,
                google: result
            });
        }

        /* -----------------------------------------------
           MÉTODO
        ------------------------------------------------ */

        if (req.method !== "POST") {
            res.setHeader("Allow", "GET, POST");

            return sendJSON(res, 405, {
                ok: false,
                error: {
                    code: "METHOD_NOT_ALLOWED",
                    message: "Método não permitido."
                }
            });
        }

        /* -----------------------------------------------
           BODY
        ------------------------------------------------ */

        const body = getBody(req);

        const bodySize = Buffer.byteLength(
            JSON.stringify(body),
            "utf8"
        );

        if (bodySize > MAX_REQUEST_BYTES) {
            return sendJSON(res, 413, {
                ok: false,
                error: {
                    code: "PAYLOAD_TOO_LARGE",
                    message:
                        "A requisição ficou grande demais. Reduza o tamanho das imagens."
                }
            });
        }

        /* -----------------------------------------------
           LEGACY
        ------------------------------------------------ */

        const legacyAction = detectLegacyRequest(body);

        let action = body.action || legacyAction;

        if (!action) {
            action = "theme";
        }

        /* -----------------------------------------------
           GERAR TEMA
        ------------------------------------------------ */

        if (action === "theme") {
            const result = await callGemini(
                [
                    {
                        role: "user",
                        parts: [
                            {
                                text: buildThemePrompt()
                            }
                        ]
                    }
                ],
                {
                    temperature: 0.75,
                    maxOutputTokens: 3000
                }
            );

            if (!result?.tema) {
                throw new Error(
                    "O Gemini não retornou um tema válido."
                );
            }

            return sendJSON(res, 200, {
                ok: true,
                type: "theme",
                data: {
                    tema: result.tema,
                    recorte: result.recorte || "",
                    contexto: result.contexto || "",
                    textos_motivadores:
                        Array.isArray(result.textos_motivadores)
                            ? result.textos_motivadores
                            : [],
                    comando:
                        result.comando ||
                        "A partir da leitura dos textos motivadores e com base nos conhecimentos construídos ao longo de sua formação, redija texto dissertativo-argumentativo em modalidade escrita formal da língua portuguesa sobre o tema proposto, apresentando proposta de intervenção que respeite os direitos humanos."
                }
            });
        }

        /* -----------------------------------------------
           AVALIAR REDAÇÃO
        ------------------------------------------------ */

        if (
            action === "evaluate" ||
            action === "avaliar"
        ) {
            const studentName =
                cleanText(body.studentName, 100) ||
                "Estudante";

            const theme =
                cleanText(body.theme, 1000);

            const essayText =
                cleanText(body.essayText, 30000);

            const trainingMode =
                cleanText(body.trainingMode, 100);

            const images = validateImages(
                body.images
            );

            if (!theme) {
                return sendJSON(res, 400, {
                    ok: false,
                    error: {
                        code: "MISSING_THEME",
                        message:
                            "O tema da redação não foi informado."
                    }
                });
            }

            if (!essayText && !images.length) {
                return sendJSON(res, 400, {
                    ok: false,
                    error: {
                        code: "MISSING_ESSAY",
                        message:
                            "Envie o texto da redação ou imagens das folhas."
                    }
                });
            }

            const parts = [];

            /*
             * Texto.
             */
            if (essayText) {
                parts.push({
                    text: buildEvaluationPrompt({
                        studentName,
                        theme,
                        essayText,
                        trainingMode
                    })
                });
            } else {
                /*
                 * Quando a redação vem somente por imagem,
                 * o Gemini precisa saber que deverá transcrever
                 * mentalmente o conteúdo da folha antes de avaliar.
                 */
                parts.push({
                    text: buildEvaluationPrompt({
                        studentName,
                        theme,
                        essayText:
                            "[A redação está presente nas imagens anexadas. Leia e avalie o texto diretamente pelas imagens.]",
                        trainingMode
                    })
                });
            }

            /*
             * Imagens.
             *
             * O REST do Gemini aceita inline_data.
             */
            for (const image of images) {
                parts.push({
                    inline_data: {
                        mime_type: image.mimeType,
                        data: image.data
                    }
                });
            }

            const result = await callGemini(
                [
                    {
                        role: "user",
                        parts
                    }
                ],
                {
                    temperature: 0.2,
                    maxOutputTokens: 7000
                }
            );

            const normalized =
                normalizeEvaluation(result);

            return sendJSON(res, 200, {
                ok: true,
                type: "evaluation",
                data: normalized
            });
        }

        /* -----------------------------------------------
           AÇÃO DESCONHECIDA
        ------------------------------------------------ */

        return sendJSON(res, 400, {
            ok: false,
            error: {
                code: "INVALID_ACTION",
                message:
                    `Ação "${action}" não é reconhecida. Use "theme" ou "evaluate".`
            }
        });

    } catch (error) {
        console.error("========== HEY ENEM ERROR ==========");
        console.error(error);
        console.error("====================================");

        const status =
            Number.isInteger(error?.status)
                ? error.status
                : 500;

        return sendJSON(
            res,
            status >= 400 && status < 600
                ? status
                : 500,
            {
                ok: false,

                error: {
                    code:
                        error?.code ||
                        "INTERNAL_ERROR",

                    message:
                        error?.message ||
                        "Erro interno no servidor.",

                    /*
                     * Não enviamos a chave da API.
                     * Apenas informações seguras de diagnóstico.
                     */
                    model: DEFAULT_MODEL
                }
            }
        );
    }
};
