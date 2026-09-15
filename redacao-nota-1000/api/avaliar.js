const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const MAX_TOTAL_IMAGE_CHARS = 3500000;

const ALLOWED_MIMES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp"
]);

function send(res, status, data) {
    res.status(status);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
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
        throw new Error("O Gemini não retornou conteúdo.");
    }

    let cleaned = text.trim();

    // Remove ```json ... ```
    cleaned = cleaned
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

    try {
        return JSON.parse(cleaned);
    } catch {
        // Tenta encontrar o primeiro objeto JSON
        const start = cleaned.indexOf("{");
        const end = cleaned.lastIndexOf("}");

        if (start !== -1 && end !== -1 && end > start) {
            try {
                return JSON.parse(
                    cleaned.slice(start, end + 1)
                );
            } catch {}
        }

        throw new Error(
            "O Gemini respondeu, mas o formato da resposta não é válido."
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
        error.original = networkError;

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
            "[Gemini API]",
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
                "A solicitação enviada ao Gemini é inválida. Verifique o modelo e os dados enviados.";
        }

        if (status === 401 || status === 403) {
            code = "GEMINI_AUTH_ERROR";
            message =
                "A chave da API Gemini foi rejeitada. Verifique se a chave está correta, ativa e vinculada ao projeto correto.";
        }

        if (status === 404) {
            code = "GEMINI_MODEL_NOT_FOUND";
            message =
                `O modelo "${MODEL}" não está disponível para esta API/projeto.`;
        }

        if (status === 429) {
            code = "GEMINI_QUOTA";
            message =
                "O limite de uso da API Gemini foi atingido. Aguarde ou verifique a cota do projeto.";
        }

        if (status >= 500) {
            code = "GEMINI_SERVER_ERROR";
            message =
                "O servidor do Gemini apresentou um erro temporário. Tente novamente.";
        }

        const error = new Error(message);

        error.status = status;
        error.code = code;

        throw error;
    }

    const text = extractGeminiText(data);

    if (!text) {

        console.error(
            "[Gemini] Resposta sem texto:",
            JSON.stringify(data).slice(0, 3000)
        );

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
// HANDLER
// ============================================================

module.exports = async function handler(req, res) {

    // --------------------------------------------------------
    // HEALTH CHECK
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


    // --------------------------------------------------------
    // MÉTODO
    // --------------------------------------------------------

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

        const action = body.action;


        // ====================================================
        // GERAR TEMA
        // ====================================================

        if (action === "theme") {

            const prompt = `
Você é um especialista em temas de redação do ENEM.

Crie UM único tema de redação no padrão ENEM.

O tema deve:

- ser socialmente relevante;
- permitir diferentes pontos de vista;
- exigir argumentação;
- não depender de conhecimento extremamente específico;
- estar relacionado ao Brasil;
- possuir um recorte claro;
- evitar temas excessivamente genéricos;
- parecer plausível para uma prova oficial.

Não copie temas oficiais existentes.

Retorne SOMENTE JSON válido neste formato:

{
  "tema": "Desafios para ... no Brasil",
  "recorte": "Explique em uma frase qual é o problema central.",
  "por_que": "Explique brevemente por que o tema é relevante."
}
`;

            const result = await callGemini(
                [
                    {
                        text: prompt
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
        // AVALIAR REDAÇÃO
        // ====================================================

        if (action === "evaluate") {

            const essayText =
                typeof body.essayText === "string"
                    ? body.essayText.trim()
                    : "";

            const theme =
                typeof body.theme === "string"
                    ? body.theme.trim()
                    : "";

            const studentName =
                typeof body.studentName === "string"
                    ? body.studentName.trim()
                    : "Estudante";

            const trainingMode =
                typeof body.trainingMode === "string"
                    ? body.trainingMode
                    : "Treino completo";


            // ------------------------------------------------
            // IMAGENS
            // ------------------------------------------------

            let images = [];

            if (Array.isArray(body.images)) {
                images = body.images;
            } else if (typeof body.imageData === "string") {
                images = [body.imageData];
            }

            images = images.filter(Boolean);


            if (!essayText && images.length === 0) {

                return send(res, 400, {
                    ok: false,
                    error: {
                        code: "EMPTY_ESSAY",
                        message:
                            "Envie o texto da redação ou pelo menos uma imagem."
                    }
                });
            }


            // ------------------------------------------------
            // VALIDAÇÃO DO TEXTO
            // ------------------------------------------------

            if (essayText.length > 30000) {

                return send(res, 400, {
                    ok: false,
                    error: {
                        code: "TEXT_TOO_LARGE",
                        message:
                            "O texto enviado é grande demais."
                    }
                });
            }


            // ------------------------------------------------
            // PROCESSAMENTO DAS IMAGENS
            // ------------------------------------------------

            const imageParts = [];

            let totalImageChars = 0;

            for (const dataUrl of images) {

                if (
                    typeof dataUrl !== "string" ||
                    !dataUrl.startsWith("data:image/")
                ) {

                    return send(res, 400, {
                        ok: false,
                        error: {
                            code: "INVALID_IMAGE",
                            message:
                                "Uma das imagens enviadas não está em um formato válido."
                        }
                    });
                }


                const match = dataUrl.match(
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


                const mimeType = match[1];

                const base64 = match[2]
                    .replace(/\s/g, "");


                if (!ALLOWED_MIMES.has(mimeType)) {

                    return send(res, 400, {
                        ok: false,
                        error: {
                            code: "UNSUPPORTED_IMAGE",
                            message:
                                "Formato de imagem não suportado."
                        }
                    });
                }


                totalImageChars += dataUrl.length;


                imageParts.push({
                    inlineData: {
                        mimeType,
                        data: base64
                    }
                });
            }


            /*
             * A Vercel possui limite de aproximadamente 4,5 MB
             * para o payload da Function.
             *
             * Mantemos margem de segurança.
             */

            if (totalImageChars > MAX_TOTAL_IMAGE_CHARS) {

                return send(res, 413, {
                    ok: false,
                    error: {
                        code: "IMAGE_PAYLOAD_TOO_LARGE",
                        message:
                            "As imagens ficaram grandes demais. Comprima as fotos ou envie menos páginas."
                    }
                });
            }


            // =================================================
            // PROMPT
            // =================================================

            const prompt = `
Você é o corretor virtual especializado em redações do ENEM da plataforma Hey ENEM!.

Faça uma correção pedagógica, criteriosa e extremamente útil para um estudante brasileiro.

IMPORTANTE:

- Esta é uma ESTIMATIVA educacional.
- Não diga que a nota é oficial.
- O ENEM possui 5 competências.
- Cada competência deve receber uma nota entre 0 e 200.
- Use somente múltiplos de 40: 0, 40, 80, 120, 160 ou 200.
- A soma máxima é 1000.
- Não invente erros que não estejam presentes.
- Não invente repertórios que o aluno não utilizou.
- Não invente trechos da redação.
- Se uma imagem estiver ilegível, informe isso.
- Se determinada palavra estiver impossível de identificar, marque como "[ilegível]".
- Seja exigente, mas didático.
- Explique o PORQUÊ de cada nota.
- Mostre como o estudante pode melhorar.
- Priorize ações práticas.

ALUNO:
${studentName}

MODO:
${trainingMode}

TEMA INFORMADO PELO ALUNO:
${theme || "Não informado. Se possível, identifique o tema a partir da redação."}

${essayText
    ? `
TEXTO DIGITADO PELO ALUNO:

${essayText}
`
    : `
A redação foi enviada como imagem.

Leia cuidadosamente todas as imagens.
Reconstrua o texto apenas quando for possível identificá-lo.
Não invente palavras.
`
}

AVALIE:

COMPETÊNCIA 1:
Domínio da modalidade escrita formal da língua portuguesa.

COMPETÊNCIA 2:
Compreensão da proposta, desenvolvimento do tema e adequação ao tipo textual dissertativo-argumentativo.

COMPETÊNCIA 3:
Seleção, organização e interpretação de informações, fatos, opiniões e argumentos.

COMPETÊNCIA 4:
Conhecimento dos mecanismos linguísticos necessários para a construção da argumentação.

COMPETÊNCIA 5:
Elaboração de proposta de intervenção para o problema abordado, respeitando os direitos humanos.

Além da nota:

1. Faça um diagnóstico geral.
2. Liste pontos fortes.
3. Liste problemas prioritários.
4. Explique como melhorar.
5. Analise a introdução.
6. Analise os dois desenvolvimentos.
7. Analise a conclusão.
8. Analise o repertório sociocultural.
9. Analise os conectivos.
10. Analise a proposta de intervenção.
11. Se possível, mostre trechos reais que precisam de revisão.
12. Crie um plano de estudo de 7 dias.
13. Diga qual é a mudança que mais aumentaria a nota.
14. Crie exercícios práticos para o aluno.

Retorne SOMENTE JSON válido seguindo exatamente esta estrutura:

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

  "trechos_para_revisar": [
    {
      "trecho": "",
      "problema": "",
      "melhor_versao": "",
      "motivo": ""
    }
  ],

  "plano_7_dias": [
    {
      "dia": 1,
      "foco": "",
      "tarefa": ""
    },
    {
      "dia": 2,
      "foco": "",
      "tarefa": ""
    },
    {
      "dia": 3,
      "foco": "",
      "tarefa": ""
    },
    {
      "dia": 4,
      "foco": "",
      "tarefa": ""
    },
    {
      "dia": 5,
      "foco": "",
      "tarefa": ""
    },
    {
      "dia": 6,
      "foco": "",
      "tarefa": ""
    },
    {
      "dia": 7,
      "foco": "",
      "tarefa": ""
    }
  ],

  "texto_extraido": "",

  "resumo_aluno": ""
}
`;


            const parts = [
                ...imageParts,
                {
                    text: prompt
                }
            ];


            const result = await callGemini(
                parts,
                8000
            );


            if (
                result?.status === "imagem_ilegivel"
            ) {

                return send(res, 200, {
                    ok: true,
                    data: result
                });
            }


            if (
                !Array.isArray(result?.competencias)
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


            // Calcula a nota no servidor para evitar
            // inconsistências entre nota_total e competências.

            const notas = result.competencias
                .slice(0, 5)
                .map(comp => {

                    let nota = Number(comp?.nota) || 0;

                    nota = Math.max(
                        0,
                        Math.min(200, nota)
                    );

                    nota =
                        Math.round(nota / 40) * 40;

                    return nota;
                });


            result.nota_total =
                notas.reduce(
                    (total, nota) => total + nota,
                    0
                );


            result.competencias =
                result.competencias.map(
                    (comp, index) => ({
                        ...comp,
                        nota: notas[index] || 0,
                        max: 200
                    })
                );


            return send(res, 200, {
                ok: true,
                data: result
            });
        }


        // ====================================================
        // AÇÃO DESCONHECIDA
        // ====================================================

        return send(res, 400, {
            ok: false,
            error: {
                code: "INVALID_ACTION",
                message:
                    'Ação inválida. Use "theme" ou "evaluate".'
            }
        });

    } catch (error) {

        console.error(
            "[Hey ENEM API]",
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
