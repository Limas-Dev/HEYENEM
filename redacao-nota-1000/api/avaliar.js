// ============================================================
// HEY ENEM! — API DE AVALIAÇÃO
// Gemini 3.6 Flash
// ============================================================

const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const MAX_IMAGE_BASE64 = 3.6 * 1024 * 1024;

function send(res, status, data) {
    return res.status(status).json(data);
}

function cleanBase64(value) {
    if (!value || typeof value !== "string") return "";

    return value
        .replace(/^data:[^;]+;base64,/i, "")
        .replace(/\s/g, "");
}

function normalizeMimeType(value) {
    const allowed = [
        "image/jpeg",
        "image/png",
        "image/webp"
    ];

    return allowed.includes(value) ? value : "image/jpeg";
}

function normalizeScore(value) {
    let score = Number(value);

    if (!Number.isFinite(score)) return 0;

    score = Math.max(0, Math.min(200, score));

    return Math.round(score / 40) * 40;
}

function normalizeCompetency(comp) {
    if (!comp || typeof comp !== "object") {
        return {
            nota: 0,
            justificativa: "Não foi possível obter a justificativa.",
            pontosFortes: [],
            melhorias: []
        };
    }

    return {
        nota: normalizeScore(comp.nota),
        justificativa:
            typeof comp.justificativa === "string"
                ? comp.justificativa
                : "",
        pontosFortes: Array.isArray(comp.pontosFortes)
            ? comp.pontosFortes.map(String)
            : [],
        melhorias: Array.isArray(comp.melhorias)
            ? comp.melhorias.map(String)
            : []
    };
}

function normalizeEvaluation(data) {
    const competencias = data?.competencias || {};

    const result = {
        resumo:
            typeof data?.resumo === "string"
                ? data.resumo
                : "",

        notaTotal: 0,

        competencias: {
            c1: normalizeCompetency(competencias.c1),
            c2: normalizeCompetency(competencias.c2),
            c3: normalizeCompetency(competencias.c3),
            c4: normalizeCompetency(competencias.c4),
            c5: normalizeCompetency(competencias.c5)
        },

        diagnostico:
            typeof data?.diagnostico === "string"
                ? data.diagnostico
                : "",

        pontosFortes: Array.isArray(data?.pontosFortes)
            ? data.pontosFortes.map(String)
            : [],

        prioridades: Array.isArray(data?.prioridades)
            ? data.prioridades.map(String)
            : [],

        reescritaSugerida:
            typeof data?.reescritaSugerida === "string"
                ? data.reescritaSugerida
                : "",

        observacoes:
            typeof data?.observacoes === "string"
                ? data.observacoes
                : ""
    };

    result.notaTotal =
        result.competencias.c1.nota +
        result.competencias.c2.nota +
        result.competencias.c3.nota +
        result.competencias.c4.nota +
        result.competencias.c5.nota;

    return result;
}

function extractJson(text) {
    if (!text || typeof text !== "string") {
        throw new Error("O Gemini não retornou conteúdo.");
    }

    let cleaned = text.trim();

    cleaned = cleaned
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

    try {
        return JSON.parse(cleaned);
    } catch (_) {}

    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");

    if (first !== -1 && last !== -1 && last > first) {
        const possibleJson = cleaned.slice(first, last + 1);

        try {
            return JSON.parse(possibleJson);
        } catch (_) {}
    }

    throw new Error(
        "O Gemini retornou uma resposta que não pôde ser interpretada como JSON."
    );
}

async function callGemini(contents) {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        const error = new Error(
            "GEMINI_API_KEY não está configurada na Vercel."
        );

        error.code = "MISSING_API_KEY";
        throw error;
    }

    const url =
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

    const response = await fetch(url, {
        method: "POST",

        headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey
        },

        body: JSON.stringify({
            contents,

            generationConfig: {
                responseMimeType: "application/json",
                maxOutputTokens: 6000
            }
        })
    });

    const raw = await response.text();

    let data;

    try {
        data = raw ? JSON.parse(raw) : {};
    } catch (_) {
        data = {
            error: {
                message: raw || "Resposta inválida do Google."
            }
        };
    }

    if (!response.ok) {
        console.error("========== ERRO GEMINI ==========");
        console.error("HTTP:", response.status);
        console.error("Resposta:", JSON.stringify(data, null, 2));
        console.error("=================================");

        const message =
            data?.error?.message ||
            data?.message ||
            raw ||
            "O Gemini recusou a solicitação.";

        const error = new Error(message);

        error.status = response.status;
        error.code =
            data?.error?.status ||
            data?.error?.code ||
            "GEMINI_ERROR";

        throw error;
    }

    const text =
        data?.candidates?.[0]?.content?.parts
            ?.map(part => part?.text || "")
            .join("")
            .trim();

    if (!text) {
        throw new Error(
            "O Gemini não retornou conteúdo para esta solicitação."
        );
    }

    return extractJson(text);
}


// ============================================================
// TEMA GERADO POR IA
// ============================================================

async function generateTheme() {
    const prompt = `
Você é um especialista em elaboração de propostas de redação do ENEM.

Crie UM tema inédito de redação no padrão do ENEM brasileiro.

O tema deve:
- abordar uma questão social relevante;
- ser adequado ao contexto brasileiro;
- permitir diferentes pontos de vista;
- permitir argumentação consistente;
- permitir uma proposta de intervenção;
- possuir recorte temático claro;
- não copiar temas oficiais anteriores;
- não ser excessivamente amplo;
- não exigir conhecimento técnico especializado.

Crie também 3 textos motivadores curtos e informativos.

Retorne SOMENTE JSON válido neste formato:

{
  "tema": "Título completo do tema",
  "recorte": "Recorte temático explicado em uma frase",
  "contexto": "Breve contextualização do problema",
  "textosMotivadores": [
    {
      "titulo": "Texto motivador 1",
      "texto": "Texto curto"
    },
    {
      "titulo": "Texto motivador 2",
      "texto": "Texto curto"
    },
    {
      "titulo": "Texto motivador 3",
      "texto": "Texto curto"
    }
  ],
  "eixo": "Eixo temático principal",
  "proposta": "Proposta de redação no estilo ENEM"
}
`;

    return await callGemini([
        {
            role: "user",
            parts: [
                {
                    text: prompt
                }
            ]
        }
    ]);
}


// ============================================================
// AVALIAÇÃO DA REDAÇÃO MANUSCRITA
// ============================================================

async function evaluateEssay(body) {
    const studentName =
        typeof body.studentName === "string"
            ? body.studentName.trim()
            : "";

    const theme =
        typeof body.theme === "string"
            ? body.theme.trim()
            : "";

    const trainingMode =
        typeof body.trainingMode === "string"
            ? body.trainingMode
            : "Treino de escrita";

    const images = Array.isArray(body.images)
        ? body.images
        : [];

    if (!studentName) {
        throw new Error(
            "Digite seu nome antes de enviar a redação."
        );
    }

    if (!theme) {
        throw new Error(
            "Escolha ou gere um tema antes de enviar a redação."
        );
    }

    if (!images.length) {
        throw new Error(
            "Envie pelo menos uma foto da sua redação."
        );
    }

    let totalBase64 = 0;

    const imageParts = [];

    for (const image of images) {
        if (!image || typeof image !== "object") {
            continue;
        }

        const data = cleanBase64(image.data);

        if (!data) {
            continue;
        }

        totalBase64 += data.length;

        if (totalBase64 > MAX_IMAGE_BASE64) {
            throw new Error(
                "As imagens enviadas são muito grandes. Remova algumas fotos ou tente novamente com imagens menores."
            );
        }

        imageParts.push({
            inlineData: {
                mimeType: normalizeMimeType(image.mimeType),
                data
            }
        });
    }

    if (!imageParts.length) {
        throw new Error(
            "Não foi possível processar as fotos enviadas."
        );
    }

    const prompt = `
Você é um corretor especializado em redações do ENEM.

Você receberá fotografias de uma redação manuscrita escrita por um estudante.

ESTUDANTE:
${studentName}

MODO:
${trainingMode}

TEMA:
${theme}

Sua tarefa é analisar cuidadosamente as imagens da redação.

IMPORTANTE:
1. A redação está manuscrita.
2. Leia o texto diretamente das imagens.
3. Tente reconstruir o texto com a maior fidelidade possível.
4. Não invente trechos que não estejam visíveis.
5. Se alguma parte estiver ilegível, deixe isso claro.
6. Considere todas as páginas enviadas.
7. Avalie a redação segundo as 5 competências oficiais do ENEM.
8. As notas das competências devem obrigatoriamente ser 0, 40, 80, 120, 160 ou 200.
9. A nota final deve ser a soma das cinco competências.
10. A nota final deve ficar entre 0 e 1000.
11. Não dê uma nota apenas pela aparência da letra.
12. Não penalize o aluno simplesmente por escrever à mão.
13. Considere conteúdo, argumentação, linguagem, estrutura, coesão e proposta de intervenção.
14. Analise se o texto realmente responde ao tema proposto.
15. Verifique possíveis sinais de fuga ao tema.
16. Verifique repertório sociocultural.
17. Verifique autoria e desenvolvimento argumentativo.
18. Verifique conectivos e mecanismos de coesão.
19. Verifique a proposta de intervenção e seus elementos.
20. Seja rigoroso, mas explique claramente o motivo de cada avaliação.

COMPETÊNCIA I:
Domínio da modalidade escrita formal da língua portuguesa.

COMPETÊNCIA II:
Compreensão da proposta de redação e aplicação de conceitos de diferentes áreas do conhecimento para desenvolver o tema.

COMPETÊNCIA III:
Seleção, relação, organização e interpretação de informações, fatos, opiniões e argumentos em defesa de um ponto de vista.

COMPETÊNCIA IV:
Conhecimento dos mecanismos linguísticos necessários para a construção da argumentação.

COMPETÊNCIA V:
Elaboração de proposta de intervenção para o problema abordado, respeitando os direitos humanos.

Para cada competência, forneça:
- nota;
- justificativa;
- pontos fortes;
- melhorias.

Também forneça:
- resumo geral;
- diagnóstico;
- pontos fortes;
- prioridades de melhoria;
- uma reescrita sugerida de trechos problemáticos ou uma orientação prática de reescrita;
- observações importantes.

RETORNE SOMENTE JSON VÁLIDO, exatamente neste formato:

{
  "resumo": "Resumo geral da redação",
  "notaTotal": 0,
  "competencias": {
    "c1": {
      "nota": 0,
      "justificativa": "",
      "pontosFortes": [],
      "melhorias": []
    },
    "c2": {
      "nota": 0,
      "justificativa": "",
      "pontosFortes": [],
      "melhorias": []
    },
    "c3": {
      "nota": 0,
      "justificativa": "",
      "pontosFortes": [],
      "melhorias": []
    },
    "c4": {
      "nota": 0,
      "justificativa": "",
      "pontosFortes": [],
      "melhorias": []
    },
    "c5": {
      "nota": 0,
      "justificativa": "",
      "pontosFortes": [],
      "melhorias": []
    }
  },
  "diagnostico": "",
  "pontosFortes": [],
  "prioridades": [],
  "reescritaSugerida": "",
  "observacoes": ""
}
`;

    const contents = [
        {
            role: "user",
            parts: [
                {
                    text: prompt
                },
                ...imageParts
            ]
        }
    ];

    const result = await callGemini(contents);

    return normalizeEvaluation(result);
}


// ============================================================
// COMPATIBILIDADE COM O FRONTEND ANTIGO
// ============================================================

function detectLegacyAction(body) {
    if (body?.action) return body.action;

    if (Array.isArray(body?.contents)) {
        const hasImage = JSON.stringify(body.contents).includes(
            "inlineData"
        );

        return hasImage
            ? "evaluate"
            : "theme";
    }

    return null;
}


// ============================================================
// HANDLER VERCEL
// ============================================================

module.exports = async function handler(req, res) {

    // --------------------------------------------------------
    // HEALTH CHECK
    // --------------------------------------------------------

    if (req.method === "GET") {
        return send(res, 200, {
            ok: true,
            configured: Boolean(process.env.GEMINI_API_KEY),
            model: MODEL,
            message: "API Hey ENEM configurada corretamente."
        });
    }

    // --------------------------------------------------------
    // SOMENTE POST
    // --------------------------------------------------------

    if (req.method !== "POST") {
        res.setHeader("Allow", "GET, POST");

        return send(res, 405, {
            error: {
                message: "Método não permitido."
            }
        });
    }

    try {
        const body =
            req.body && typeof req.body === "object"
                ? req.body
                : {};

        const action = detectLegacyAction(body);

        // ----------------------------------------------------
        // GERAR TEMA
        // ----------------------------------------------------

        if (action === "theme") {

            const result = await generateTheme();

            return send(res, 200, {
                ok: true,
                type: "theme",
                data: result
            });
        }

        // ----------------------------------------------------
        // AVALIAR REDAÇÃO
        // ----------------------------------------------------

        if (action === "evaluate") {

            let evaluationBody = body;

            // Compatibilidade com estrutura antiga
            if (
                !body.action &&
                Array.isArray(body.contents)
            ) {
                const firstContent = body.contents[0];

                const parts =
                    firstContent?.parts || [];

                const images = parts
                    .filter(part => part?.inlineData)
                    .map(part => ({
                        mimeType:
                            part.inlineData.mimeType,
                        data:
                            part.inlineData.data
                    }));

                const text =
                    parts
                        .filter(part => part?.text)
                        .map(part => part.text)
                        .join("\n");

                evaluationBody = {
                    studentName: "Estudante",
                    theme:
                        body.theme ||
                        "Tema da redação",
                    trainingMode:
                        "Treino de escrita",
                    essayText: text,
                    images
                };
            }

            const result =
                await evaluateEssay(evaluationBody);

            return send(res, 200, {
                ok: true,
                type: "evaluation",
                data: result
            });
        }

        // ----------------------------------------------------
        // AÇÃO INVÁLIDA
        // ----------------------------------------------------

        return send(res, 400, {
            error: {
                message:
                    "Ação inválida. Use 'theme' ou 'evaluate'.",
                code: "INVALID_ACTION"
            }
        });

    } catch (error) {

        console.error("========== HEY ENEM ERROR ==========");
        console.error(error);
        console.error("====================================");

        const status =
            Number(error?.status) >= 400 &&
            Number(error?.status) < 600
                ? Number(error.status)
                : 500;

        return send(res, status, {
            error: {
                message:
                    error?.message ||
                    "Não foi possível concluir a solicitação.",
                code:
                    error?.code ||
                    "SERVER_ERROR",
                status,
                provider:
                    error?.code?.startsWith("GEMINI")
                        ? "google"
                        : undefined
            }
        });
    }
};
