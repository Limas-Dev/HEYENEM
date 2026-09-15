const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const MAX_TOTAL_IMAGE_CHARS = 3500000;

const ALLOWED_MIMES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp"
]);

function send(res, status, data) {
    res.status(status);
    res.setHeader(
        "Content-Type",
        "application/json; charset=utf-8"
    );

    return res.json(data);
}


function extractGeminiText(data) {

    return (
        data?.candidates?.[0]?.content?.parts
            ?.map(part => part?.text || "")
            .join("")
            .trim() || ""
    );
}


function parseJSON(text) {

    if (!text) {
        throw new Error(
            "O Gemini não retornou conteúdo."
        );
    }

    let cleaned = text.trim();

    cleaned = cleaned
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

    try {
        return JSON.parse(cleaned);
    } catch {

        const start = cleaned.indexOf("{");
        const end = cleaned.lastIndexOf("}");

        if (start !== -1 && end !== -1) {

            try {
                return JSON.parse(
                    cleaned.slice(start, end + 1)
                );
            } catch {}
        }

        throw new Error(
            "O Gemini respondeu, mas o JSON retornado é inválido."
        );
    }
}


async function callGemini(parts, maxOutputTokens = 7000) {

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {

        const error = new Error(
            "GEMINI_API_KEY não está configurada na Vercel."
        );

        error.code = "MISSING_API_KEY";
        error.status = 500;

        throw error;
    }


    const url =
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;


    const payload = {

        contents: [
            {
                role: "user",
                parts
            }
        ],

        generationConfig: {
            responseMimeType: "application/json",
            maxOutputTokens
        }
    };


    let response;

    try {

        response = await fetch(url, {

            method: "POST",

            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": apiKey
            },

            body: JSON.stringify(payload)
        });

    } catch (networkError) {

        const error = new Error(
            "Não foi possível conectar à API do Gemini."
        );

        error.code = "GEMINI_NETWORK_ERROR";
        error.status = 502;

        throw error;
    }


    const raw = await response.text();

    let data;

    try {
        data = JSON.parse(raw);
    } catch {
        data = {
            raw
        };
    }


    if (!response.ok) {

        console.error(
            "[Gemini]",
            response.status,
            data?.error?.message || raw
        );


        const status = response.status;

        let message =
            data?.error?.message ||
            "A API do Gemini recusou a solicitação.";

        let code = "GEMINI_ERROR";


        if (status === 400) {

            code = "GEMINI_BAD_REQUEST";

            message =
                "O Gemini considerou a solicitação inválida.";
        }


        if (status === 401 || status === 403) {

            code = "GEMINI_AUTH_ERROR";

            message =
                "A chave da API Gemini foi rejeitada. Verifique a chave e o projeto no Google AI Studio.";
        }


        if (status === 404) {

            code = "GEMINI_MODEL_NOT_FOUND";

            message =
                `O modelo "${MODEL}" não foi encontrado ou não está disponível para esta API.`;
        }


        if (status === 429) {

            code = "GEMINI_QUOTA";

            message =
                "O limite de uso da API Gemini foi atingido.";
        }


        if (status >= 500) {

            code = "GEMINI_SERVER_ERROR";

            message =
                "O servidor do Gemini apresentou um erro temporário.";
        }


        const error = new Error(message);

        error.status = status;
        error.code = code;

        throw error;
    }


    const text = extractGeminiText(data);


    if (!text) {

        const error = new Error(
            "O Gemini não retornou uma resposta utilizável."
        );

        error.status = 502;
        error.code = "EMPTY_GEMINI_RESPONSE";

        throw error;
    }


    return parseJSON(text);
}


// ============================================================
// PROMPT DE TEMA
// ============================================================

function themePrompt() {

    return `
Você é especialista em redação do ENEM.

Crie UM único tema de redação no estilo oficial do ENEM.

O tema deve:

- ser relevante para a sociedade brasileira;
- permitir diferentes pontos de vista;
- exigir argumentação;
- possuir um recorte específico;
- não ser excessivamente genérico;
- ser adequado para uma redação dissertativo-argumentativa;
- não copiar literalmente temas oficiais anteriores.

Retorne SOMENTE JSON:

{
    "tema": "",
    "recorte": "",
    "por_que": ""
}
`;
}


// ============================================================
// PROMPT DE CORREÇÃO
// ============================================================

function evaluationPrompt({
    studentName,
    theme,
    trainingMode,
    essayText
}) {

    return `
Você é o corretor virtual de redações do ENEM da plataforma Hey ENEM!.

Faça uma análise extremamente detalhada, rigorosa e pedagógica.

IMPORTANTE:

- A nota é uma ESTIMATIVA educacional.
- Não diga que a nota é oficial.
- O ENEM possui 5 competências.
- Cada competência vale de 0 a 200.
- Utilize somente 0, 40, 80, 120, 160 ou 200.
- A nota total máxima é 1000.
- Não invente erros.
- Não invente repertórios.
- Não invente trechos.
- Se algo estiver ilegível, informe.
- Explique o motivo de cada nota.
- Dê orientações práticas.
- Seja exigente, mas didático.

ALUNO:
${studentName || "Estudante"}

MODO:
${trainingMode || "Treino completo"}

TEMA:
${theme || "Não informado. Tente identificar o tema pela redação."}

${
    essayText
        ? `
TEXTO DA REDAÇÃO:

${essayText}
`
        : `
A redação foi enviada em imagem.

Leia cuidadosamente todas as páginas.
Não invente palavras que não estejam visíveis.
`
}

ANALISE:

COMPETÊNCIA 1:
Domínio da modalidade escrita formal da língua portuguesa.

COMPETÊNCIA 2:
Compreensão da proposta, desenvolvimento do tema e adequação ao tipo textual.

COMPETÊNCIA 3:
Seleção, organização e interpretação de informações, fatos, opiniões e argumentos.

COMPETÊNCIA 4:
Mecanismos linguísticos necessários para construir a argumentação.

COMPETÊNCIA 5:
Proposta de intervenção para o problema abordado, respeitando os direitos humanos.

Também analise:

- introdução;
- desenvolvimento 1;
- desenvolvimento 2;
- conclusão;
- repertório sociocultural;
- argumentação;
- conectivos;
- coesão;
- proposta de intervenção;
- pontos fortes;
- problemas;
- trechos que precisam ser corrigidos;
- plano de estudo de 7 dias;
- principal mudança necessária para aumentar a nota.

Retorne SOMENTE JSON válido:

{
    "status": "ok",
    "nota_total": 0,

    "competencias": [
        {
            "id": 1,
            "nome": "Domínio da modalidade escrita formal",
            "nota": 0,
            "max": 200,
            "nivel": 0,
            "diagnostico": "",
            "pontos_fortes": [],
            "problemas": [],
            "como_melhorar": []
        },
        {
            "id": 2,
            "nome": "Compreensão da proposta e desenvolvimento do tema",
            "nota": 0,
            "max": 200,
            "nivel": 0,
            "diagnostico": "",
            "pontos_fortes": [],
            "problemas": [],
            "como_melhorar": []
        },
        {
            "id": 3,
            "nome": "Seleção e organização dos argumentos",
            "nota": 0,
            "max": 200,
            "nivel": 0,
            "diagnostico": "",
            "pontos_fortes": [],
            "problemas": [],
            "como_melhorar": []
        },
        {
            "id": 4,
            "nome": "Coesão e mecanismos linguísticos",
            "nota": 0,
            "max": 200,
            "nivel": 0,
            "diagnostico": "",
            "pontos_fortes": [],
            "problemas": [],
            "como_melhorar": []
        },
        {
            "id": 5,
            "nome": "Proposta de intervenção",
            "nota": 0,
            "max": 200,
            "nivel": 0,
            "diagnostico": "",
            "pontos_fortes": [],
            "problemas": [],
            "como_melhorar": []
        }
    ],

    "diagnostico_geral": "",

    "pontos_fortes_gerais": [],

    "problemas_prioritarios": [],

    "prioridade_1": {
        "titulo": "",
        "explicacao": "",
        "exercicio": ""
    },

    "prioridade_2": {
        "titulo": "",
        "explicacao": "",
        "exercicio": ""
    },

    "estrutura": {
        "introducao": "",
        "desenvolvimento1": "",
        "desenvolvimento2": "",
        "conclusao": ""
    },

    "repertorio": {
        "usado": [],
        "qualidade": "",
        "sugestoes": []
    },

    "coesao": {
        "conectivos_bons": [],
        "conectivos_a_melhorar": []
    },

    "proposta_intervencao": {
        "agente": "",
        "acao": "",
        "meio": "",
        "finalidade": "",
        "detalhamento": "",
        "completa": false,
        "diagnostico": ""
    },

    "trechos_para_revisar": [],

    "plano_7_dias": [],

    "texto_extraido": "",

    "resumo_aluno": ""
}
`;
}


// ============================================================
// CONVERTE O FORMATO ANTIGO DO FRONTEND
// ============================================================

function convertLegacyRequest(body) {

    const contents = Array.isArray(body?.contents)
        ? body.contents
        : [];

    let promptText = "";

    const images = [];


    for (const content of contents) {

        const parts = Array.isArray(content?.parts)
            ? content.parts
            : [];


        for (const part of parts) {

            if (typeof part?.text === "string") {
                promptText += part.text + "\n";
            }


            const image =
                part?.inlineData ||
                part?.inline_data;


            if (
                image?.data &&
                image?.mimeType
            ) {

                images.push({
                    mimeType: image.mimeType,
                    data: image.data
                });
            }
        }
    }


    return {
        promptText,
        images
    };
}


// ============================================================
// HANDLER
// ============================================================

module.exports = async function handler(req, res) {

    // --------------------------------------------------------
    // TESTE DA API
    // --------------------------------------------------------

    if (req.method === "GET") {

        const configured =
            Boolean(process.env.GEMINI_API_KEY);

        return send(res, 200, {

            ok: configured,

            configured,

            model: MODEL,

            message: configured
                ? "API Hey ENEM configurada corretamente."
                : "GEMINI_API_KEY não encontrada na Vercel."
        });
    }


    if (req.method !== "POST") {

        return send(res, 405, {

            ok: false,

            error: {
                code: "METHOD_NOT_ALLOWED",
                message: "Método não permitido."
            }
        });
    }


    try {

        const body = req.body || {};

        let action = body.action;


        // ====================================================
        // COMPATIBILIDADE COM SEU FRONTEND ANTIGO
        // ====================================================

        if (!action && Array.isArray(body.contents)) {

            const legacy =
                convertLegacyRequest(body);


            /*
             * Se existe imagem:
             * trata como avaliação.
             *
             * Se não existe imagem:
             * trata como geração de tema.
             */

            if (legacy.images.length > 0) {

                action = "legacy-evaluate";

            } else {

                action = "legacy-theme";
            }


            body.__legacy = legacy;
        }


        // ====================================================
        // GERAR TEMA
        // ====================================================

        if (
            action === "theme" ||
            action === "legacy-theme"
        ) {

            const result = await callGemini(

                [
                    {
                        text: themePrompt()
                    }
                ],

                1000
            );


            if (!result?.tema) {

                return send(res, 502, {

                    ok: false,

                    error: {
                        code: "INVALID_THEME_RESPONSE",
                        message:
                            "O Gemini não retornou um tema válido."
                    }
                });
            }


            return send(res, 200, {

                ok: true,

                type: "theme",

                data: result
            });
        }


        // ====================================================
        // AVALIAÇÃO
        // ====================================================

        if (
            action === "evaluate" ||
            action === "legacy-evaluate"
        ) {

            let essayText =
                typeof body.essayText === "string"
                    ? body.essayText.trim()
                    : "";


            let theme =
                typeof body.theme === "string"
                    ? body.theme.trim()
                    : "";


            let studentName =
                typeof body.studentName === "string"
                    ? body.studentName.trim()
                    : "Estudante";


            let trainingMode =
                typeof body.trainingMode === "string"
                    ? body.trainingMode
                    : "Treino completo";


            let imageObjects = [];


            // NOVO FRONTEND

            if (Array.isArray(body.images)) {

                for (const dataUrl of body.images) {

                    if (
                        typeof dataUrl !== "string"
                    ) {
                        continue;
                    }


                    const match =
                        dataUrl.match(
                            /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s
                        );


                    if (!match) {

                        return send(res, 400, {

                            ok: false,

                            error: {
                                code: "INVALID_IMAGE_FORMAT",
                                message:
                                    "Use imagens JPG, PNG ou WebP."
                            }
                        });
                    }


                    imageObjects.push({

                        mimeType: match[1],

                        data: match[2]
                            .replace(/\s/g, "")
                    });
                }
            }


            // COMPATIBILIDADE COM FRONTEND ANTIGO

            if (
                action === "legacy-evaluate" &&
                body.__legacy
            ) {

                imageObjects =
                    body.__legacy.images;

            }


            // Também aceita imageData antigo

            if (
                imageObjects.length === 0 &&
                typeof body.imageData === "string"
            ) {

                const match =
                    body.imageData.match(
                        /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s
                    );


                if (match) {

                    imageObjects.push({

                        mimeType: match[1],

                        data: match[2]
                            .replace(/\s/g, "")
                    });
                }
            }


            // ------------------------------------------------
            // LEGACY: extrai o prompt original se necessário
            // ------------------------------------------------

            if (
                action === "legacy-evaluate" &&
                !theme
            ) {

                /*
                 * Não usamos o prompt antigo como instrução.
                 * A nova IA recebe nossa instrução padronizada.
                 */
            }


            if (
                !essayText &&
                imageObjects.length === 0
            ) {

                return send(res, 400, {

                    ok: false,

                    error: {
                        code: "EMPTY_ESSAY",
                        message:
                            "Envie o texto da redação ou uma imagem."
                    }
                });
            }


            // ------------------------------------------------
            // LIMITE DAS IMAGENS
            // ------------------------------------------------

            let totalChars = 0;

            for (const image of imageObjects) {

                totalChars +=
                    image.data.length;

                if (
                    !ALLOWED_MIMES.has(
                        image.mimeType
                    )
                ) {

                    return send(res, 400, {

                        ok: false,

                        error: {
                            code: "UNSUPPORTED_IMAGE",
                            message:
                                "Formato de imagem não suportado."
                        }
                    });
                }
            }


            if (
                totalChars >
                MAX_TOTAL_IMAGE_CHARS
            ) {

                return send(res, 413, {

                    ok: false,

                    error: {
                        code: "IMAGE_PAYLOAD_TOO_LARGE",

                        message:
                            "As imagens ficaram grandes demais. Comprima as fotos ou envie menos páginas."
                    }
                });
            }


            // ------------------------------------------------
            // MONTA REQUEST GEMINI
            // ------------------------------------------------

            const parts = [];


            for (const image of imageObjects) {

                parts.push({

                    inlineData: {

                        mimeType:
                            image.mimeType,

                        data:
                            image.data
                    }
                });
            }


            parts.push({

                text:

                    evaluationPrompt({

                        studentName,

                        theme,

                        trainingMode,

                        essayText
                    })
            });


            const result = await callGemini(
                parts,
                8000
            );


            if (
                !Array.isArray(
                    result?.competencias
                )
            ) {

                return send(res, 502, {

                    ok: false,

                    error: {
                        code: "INVALID_EVALUATION",

                        message:
                            "O Gemini retornou uma avaliação incompleta."
                    }
                });
            }


            // ------------------------------------------------
            // NORMALIZA NOTAS
            // ------------------------------------------------

            const competencias =
                result.competencias
                    .slice(0, 5)
                    .map((comp, index) => {

                        let nota =
                            Number(comp?.nota) || 0;


                        nota = Math.max(
                            0,
                            Math.min(200, nota)
                        );


                        nota =
                            Math.round(
                                nota / 40
                            ) * 40;


                        return {

                            ...comp,

                            id:
                                comp?.id ||
                                index + 1,

                            nota,

                            max: 200
                        };
                    });


            result.competencias =
                competencias;


            result.nota_total =
                competencias.reduce(
                    (sum, comp) =>
                        sum + comp.nota,
                    0
                );


            return send(res, 200, {

                ok: true,

                data: result
            });
        }


        // ====================================================
        // AÇÃO INVÁLIDA
        // ====================================================

        return send(res, 400, {

            ok: false,

            error: {

                code: "INVALID_ACTION",

                message:
                    "A solicitação recebida pelo Hey ENEM não possui uma ação válida."
            }
        });


    } catch (error) {

        console.error(
            "[Hey ENEM]",
            error
        );


        return send(

            res,

            error.status || 500,

            {

                ok: false,

                error: {

                    code:
                        error.code ||
                        "INTERNAL_SERVER_ERROR",

                    message:
                        error.message ||
                        "Erro interno no servidor."
                }
            }
        );
    }
};
