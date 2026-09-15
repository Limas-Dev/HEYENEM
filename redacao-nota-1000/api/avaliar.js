// ============================================================
// HEY ENEM! — API DE AVALIAÇÃO
// Gemini 3.6 Flash
// ============================================================

const MODEL = "gemini-3.6-flash";
const GEMINI_URL =
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;


// ============================================================
// UTILITÁRIOS
// ============================================================

function sendJSON(res, status, data) {
    res.status(status);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.json(data);
}


function cleanJSON(text) {
    if (!text) {
        throw new Error("O Gemini não retornou conteúdo.");
    }

    let value = text.trim();

    // Remove possíveis blocos ```json ... ```
    value = value
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

    // Tenta JSON direto
    try {
        return JSON.parse(value);
    } catch (_) {}

    // Procura primeiro objeto JSON
    const firstBrace = value.indexOf("{");
    const lastBrace = value.lastIndexOf("}");

    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const possibleJSON = value.slice(firstBrace, lastBrace + 1);

        try {
            return JSON.parse(possibleJSON);
        } catch (_) {}
    }

    throw new Error(
        "O Gemini retornou uma resposta que não pôde ser convertida em JSON."
    );
}


function normalizeScore(value) {
    let number = Number(value);

    if (!Number.isFinite(number)) {
        return 0;
    }

    // ENEM trabalha em múltiplos de 40
    number = Math.round(number / 40) * 40;

    return Math.max(0, Math.min(200, number));
}


function normalizeCompetencia(data, numero) {
    const source =
        data?.[`competencia${numero}`] ||
        data?.[`c${numero}`] ||
        {};

    return {
        nota: normalizeScore(source.nota),
        titulo:
            source.titulo ||
            `Competência ${numero}`,
        avaliacao:
            source.avaliacao ||
            source.comentario ||
            "Não foi fornecida uma avaliação.",
        pontosFortes:
            Array.isArray(source.pontosFortes)
                ? source.pontosFortes
                : [],
        melhorias:
            Array.isArray(source.melhorias)
                ? source.melhorias
                : []
    };
}


function normalizeEvaluation(data) {
    const competencias = {
        competencia1: normalizeCompetencia(data, 1),
        competencia2: normalizeCompetencia(data, 2),
        competencia3: normalizeCompetencia(data, 3),
        competencia4: normalizeCompetencia(data, 4),
        competencia5: normalizeCompetencia(data, 5)
    };

    const total =
        competencias.competencia1.nota +
        competencias.competencia2.nota +
        competencias.competencia3.nota +
        competencias.competencia4.nota +
        competencias.competencia5.nota;

    return {
        ...competencias,

        notaTotal: total,

        nota:
            data?.nota !== undefined
                ? Number(data.nota) || total
                : total,

        resumoGeral:
            data?.resumoGeral ||
            data?.resumo ||
            "Avaliação concluída.",

        pontosFortesGerais:
            Array.isArray(data?.pontosFortesGerais)
                ? data.pontosFortesGerais
                : [],

        prioridades:
            Array.isArray(data?.prioridades)
                ? data.prioridades
                : [],

        repertorios:
            Array.isArray(data?.repertorios)
                ? data.repertorios
                : [],

        planoMelhoria:
            data?.planoMelhoria ||
            "Revise os pontos indicados em cada competência e reescreva os trechos necessários."
    };
}


// ============================================================
// CHAMADA AO GEMINI
// ============================================================

async function callGemini(contents, generationConfig = {}) {

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        throw new Error(
            "GEMINI_API_KEY não está configurada na Vercel."
        );
    }

    const response = await fetch(GEMINI_URL, {
        method: "POST",

        headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey
        },

        body: JSON.stringify({
            contents,

            generationConfig: {
                temperature: 0.4,
                responseMimeType: "application/json",
                ...generationConfig
            }
        })
    });

    const raw = await response.text();

    let data = {};

    try {
        data = raw ? JSON.parse(raw) : {};
    } catch (_) {
        data = {
            raw
        };
    }

    if (!response.ok) {

        console.error("========================================");
        console.error("ERRO GEMINI");
        console.error("HTTP:", response.status);
        console.error(
            "RESPOSTA:",
            JSON.stringify(data, null, 2)
        );
        console.error("========================================");

        const message =
            data?.error?.message ||
            data?.message ||
            raw ||
            `Erro HTTP ${response.status}.`;

        const error = new Error(message);

        error.status = response.status;
        error.googleStatus =
            data?.error?.status ||
            null;

        throw error;
    }

    const text =
        data?.candidates?.[0]?.content?.parts
            ?.map(part => part.text || "")
            .join("")
            .trim();

    if (!text) {
        console.error(
            "Resposta Gemini sem texto:",
            JSON.stringify(data, null, 2)
        );

        throw new Error(
            "O Gemini não retornou uma resposta válida."
        );
    }

    return cleanJSON(text);
}


// ============================================================
// GERAÇÃO DE TEMA
// ============================================================

async function generateTheme() {

    const prompt = `
Você é um especialista em redação do ENEM e elaboração de propostas
de temas contemporâneos para estudantes brasileiros.

Crie UM tema inédito de redação no estilo ENEM.

O tema deve:

- abordar um problema social brasileiro real;
- ser atual ou estruturalmente relevante;
- permitir discussão crítica;
- possibilitar o uso de repertório sociocultural;
- permitir a construção de uma proposta de intervenção;
- não depender de informações extremamente específicas;
- não ser excessivamente amplo;
- não repetir temas oficiais conhecidos;
- ter linguagem semelhante à utilizada nas propostas do ENEM.

O tema deve conter:

1. um título curto;
2. uma proposta temática formulada como frase;
3. uma breve contextualização;
4. 3 possíveis eixos de discussão;
5. 4 repertórios socioculturais que poderiam ser utilizados.

Retorne SOMENTE JSON válido.

Formato obrigatório:

{
  "titulo": "Título do tema",
  "tema": "A persistência de ... no Brasil",
  "contextualizacao": "Texto curto contextualizando o problema.",
  "eixos": [
    "Eixo 1",
    "Eixo 2",
    "Eixo 3"
  ],
  "repertorios": [
    {
      "nome": "Nome do repertório",
      "tipo": "filosofia",
      "comoUsar": "Como relacionar o repertório ao tema."
    },
    {
      "nome": "Nome do repertório",
      "tipo": "sociologia",
      "comoUsar": "Como relacionar o repertório ao tema."
    },
    {
      "nome": "Nome do repertório",
      "tipo": "literatura",
      "comoUsar": "Como relacionar o repertório ao tema."
    },
    {
      "nome": "Nome do repertório",
      "tipo": "atualidades",
      "comoUsar": "Como relacionar o repertório ao tema."
    }
  ]
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
// AVALIAÇÃO DA REDAÇÃO
// ============================================================

async function evaluateEssay(body) {

    const {
        studentName,
        theme,
        trainingMode,
        essayText,
        images
    } = body;

    if (!theme) {
        throw new Error(
            "O tema da redação não foi informado."
        );
    }

    if (
        (!essayText || !essayText.trim()) &&
        (!Array.isArray(images) || images.length === 0)
    ) {
        throw new Error(
            "Envie o texto da redação ou imagens das páginas."
        );
    }

    const parts = [];

    const prompt = `
Você é um avaliador especializado em redações do ENEM brasileiro.

Sua função é avaliar tecnicamente a redação de um estudante utilizando
as CINCO COMPETÊNCIAS oficiais da redação do ENEM.

IMPORTANTE:

- Não seja excessivamente generoso.
- Não seja excessivamente severo.
- Avalie somente o que está efetivamente presente no texto.
- Não invente erros.
- Não invente repertórios.
- Não atribua nota apenas pela impressão geral.
- Considere a relação entre tema, argumentação e proposta de intervenção.
- Identifique problemas concretos.
- Explique de maneira didática.
- Considere que o estudante está treinando.
- A nota de cada competência deve ser 0, 40, 80, 120, 160 ou 200.

DADOS DO ESTUDANTE

Nome:
${studentName || "Estudante"}

Modo:
${trainingMode || "Treino"}

TEMA DA REDAÇÃO:

${theme}

TEXTO TRANSCRITO PELO ESTUDANTE:

${essayText || "(A redação foi enviada por imagem. Leia as imagens.)"}

---

CRITÉRIOS

COMPETÊNCIA 1
Demonstrar domínio da modalidade escrita formal da língua portuguesa.

Analise:
- ortografia;
- acentuação;
- pontuação;
- concordância;
- regência;
- colocação pronominal;
- construção sintática;
- escolha vocabular;
- desvios gramaticais.

COMPETÊNCIA 2
Compreender a proposta de redação e aplicar conceitos de diferentes áreas
do conhecimento para desenvolver o tema dentro dos limites estruturais
do texto dissertativo-argumentativo.

Analise:
- compreensão do tema;
- fuga ou tangenciamento;
- repertório sociocultural;
- pertinência do repertório;
- produtividade do repertório;
- estrutura dissertativo-argumentativa.

COMPETÊNCIA 3
Selecionar, relacionar, organizar e interpretar informações, fatos,
opiniões e argumentos em defesa de um ponto de vista.

Analise:
- projeto de texto;
- tese;
- seleção de argumentos;
- progressão argumentativa;
- relação entre argumentos;
- consistência.

COMPETÊNCIA 4
Demonstrar conhecimento dos mecanismos linguísticos necessários para
a construção da argumentação.

Analise:
- coesão;
- conectivos;
- referenciação;
- progressão;
- relações lógico-semânticas;
- articulação entre períodos e parágrafos.

COMPETÊNCIA 5
Elaborar proposta de intervenção para o problema abordado, respeitando
os direitos humanos.

Analise:
- agente;
- ação;
- meio/modo;
- finalidade;
- detalhamento;
- relação com o problema;
- respeito aos direitos humanos.

---

FORMATO DA RESPOSTA

Retorne SOMENTE JSON válido.

Use exatamente esta estrutura:

{
  "competencia1": {
    "nota": 0,
    "titulo": "Domínio da norma-padrão",
    "avaliacao": "Avaliação detalhada.",
    "pontosFortes": [
      "Ponto forte."
    ],
    "melhorias": [
      "Melhoria concreta."
    ]
  },

  "competencia2": {
    "nota": 0,
    "titulo": "Compreensão da proposta",
    "avaliacao": "Avaliação detalhada.",
    "pontosFortes": [
      "Ponto forte."
    ],
    "melhorias": [
      "Melhoria concreta."
    ]
  },

  "competencia3": {
    "nota": 0,
    "titulo": "Argumentação",
    "avaliacao": "Avaliação detalhada.",
    "pontosFortes": [
      "Ponto forte."
    ],
    "melhorias": [
      "Melhoria concreta."
    ]
  },

  "competencia4": {
    "nota": 0,
    "titulo": "Coesão",
    "avaliacao": "Avaliação detalhada.",
    "pontosFortes": [
      "Ponto forte."
    ],
    "melhorias": [
      "Melhoria concreta."
    ]
  },

  "competencia5": {
    "nota": 0,
    "titulo": "Proposta de intervenção",
    "avaliacao": "Avaliação detalhada.",
    "pontosFortes": [
      "Ponto forte."
    ],
    "melhorias": [
      "Melhoria concreta."
    ]
  },

  "notaTotal": 0,

  "resumoGeral": "Resumo geral da redação.",

  "pontosFortesGerais": [
    "Ponto forte geral."
  ],

  "prioridades": [
    "Principal ponto que o estudante deve melhorar."
  ],

  "repertorios": [
    "Repertório que poderia fortalecer a argumentação."
  ],

  "planoMelhoria": "Plano prático de estudo para melhorar a redação."
}
`;

    parts.push({
        text: prompt
    });


    // ========================================================
    // IMAGENS
    // ========================================================

    if (Array.isArray(images)) {

        for (const image of images) {

            if (!image) continue;

            const mimeType =
                image.mimeType ||
                image.mime_type ||
                "image/jpeg";

            const data =
                image.data ||
                image.base64;

            if (!data) continue;

            parts.push({
                inlineData: {
                    mimeType,
                    data
                }
            });
        }
    }


    const result = await callGemini([
        {
            role: "user",
            parts
        }
    ]);

    return normalizeEvaluation(result);
}


// ============================================================
// COMPATIBILIDADE COM O FORMATO ANTIGO
// ============================================================

function convertLegacyRequest(body) {

    if (body.action) {
        return body;
    }

    // Frontend antigo enviava "contents"
    if (Array.isArray(body.contents)) {

        const firstMessage =
            body.contents[0];

        const parts =
            firstMessage?.parts || [];

        let prompt = "";
        const images = [];

        for (const part of parts) {

            if (part?.text) {
                prompt += part.text + "\n";
            }

            if (part?.inlineData) {

                images.push({
                    mimeType:
                        part.inlineData.mimeType,
                    data:
                        part.inlineData.data
                });
            }
        }

        // Se não houver imagem, provavelmente era geração de tema
        if (images.length === 0) {

            return {
                action: "theme"
            };
        }

        return {
            action: "evaluate",
            essayText: prompt,
            images
        };
    }

    return body;
}


// ============================================================
// HANDLER
// ============================================================

module.exports = async function handler(req, res) {

    // --------------------------------------------------------
    // HEALTH CHECK
    // --------------------------------------------------------

    if (req.method === "GET") {

        return sendJSON(res, 200, {
            ok: true,
            configured: Boolean(
                process.env.GEMINI_API_KEY
            ),
            model: MODEL,
            message:
                "API Hey ENEM configurada corretamente."
        });
    }


    // --------------------------------------------------------
    // MÉTODO
    // --------------------------------------------------------

    if (req.method !== "POST") {

        res.setHeader("Allow", "GET, POST");

        return sendJSON(res, 405, {
            ok: false,
            error: {
                message: "Método não permitido."
            }
        });
    }


    try {

        let body = req.body || {};

        // Alguns ambientes podem entregar body como string
        if (typeof body === "string") {

            try {
                body = JSON.parse(body);
            } catch (_) {

                return sendJSON(res, 400, {
                    ok: false,
                    error: {
                        message:
                            "O corpo da requisição não é um JSON válido."
                    }
                });
            }
        }


        body = convertLegacyRequest(body);


        // ----------------------------------------------------
        // ACTION
        // ----------------------------------------------------

        const action =
            body.action;


        // ----------------------------------------------------
        // TEMA
        // ----------------------------------------------------

        if (action === "theme") {

            const theme =
                await generateTheme();

            return sendJSON(res, 200, {
                ok: true,
                type: "theme",
                data: theme
            });
        }


        // ----------------------------------------------------
        // AVALIAÇÃO
        // ----------------------------------------------------

        if (action === "evaluate") {

            const result =
                await evaluateEssay(body);

            return sendJSON(res, 200, {
                ok: true,
                type: "evaluation",
                data: result
            });
        }


        // ----------------------------------------------------
        // ACTION INVÁLIDA
        // ----------------------------------------------------

        return sendJSON(res, 400, {
            ok: false,
            error: {
                message:
                    "Ação inválida. Use 'theme' ou 'evaluate'."
            }
        });

    } catch (error) {

        console.error(
            "ERRO FINAL DA API:",
            error
        );

        const status =
            Number(error?.status) >= 400 &&
            Number(error?.status) < 600
                ? Number(error.status)
                : 500;

        return sendJSON(res, status, {
            ok: false,

            error: {
                message:
                    error?.message ||
                    "Erro interno ao processar a solicitação.",

                status:
                    error?.googleStatus ||
                    null
            }
        });
    }
};
