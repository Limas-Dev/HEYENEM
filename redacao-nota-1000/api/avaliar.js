/**
 * Hey ENEM!
 * API de avaliação de redação
 *
 * Vercel Serverless Function
 */

module.exports = async function handler(req, res) {

  /* =========================================================
     CORS / MÉTODO
  ========================================================== */

  if (req.method !== "POST") {

    return res.status(405).json({
      error: "Método não permitido."
    });

  }

  /* =========================================================
     HEADERS
  ========================================================== */

  res.setHeader(
    "Cache-Control",
    "no-store"
  );

  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  /* =========================================================
     OPTIONS
  ========================================================== */

  if (req.method === "OPTIONS") {

    return res.status(204).end();

  }

  /* =========================================================
     API KEY
  ========================================================== */

  const apiKey =
    process.env.GEMINI_API_KEY;

  if (!apiKey) {

    console.error(
      "GEMINI_API_KEY não configurada."
    );

    return res.status(500).json({
      error:
        "A chave da IA não está configurada no servidor."
    });

  }

  /* =========================================================
     MODEL
  ========================================================== */

  const model =
    process.env.GEMINI_MODEL ||
    "gemini-2.5-flash";

  try {

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body;

    if (!body) {

      return res.status(400).json({
        error: "Requisição vazia."
      });

    }

    const action =
      body.action;

    /* =======================================================
       GERAR TEMA
    ======================================================== */

    if (action === "generate_theme") {

      const prompt = `

Você é um especialista em elaboração de propostas de redação
para o Exame Nacional do Ensino Médio (ENEM).

Crie UM único tema de redação.

Requisitos:

- Deve abordar uma problemática social brasileira.
- Deve ser relevante para a realidade contemporânea.
- Deve permitir discussão de causas, consequências e soluções.
- Deve possibilitar o uso de repertório sociocultural.
- Não copie temas oficiais anteriores.
- Evite temas excessivamente genéricos.
- O tema deve ter potencial para uma redação dissertativo-argumentativa.
- Escreva somente o enunciado do tema.
- Não explique o tema.
- Não coloque aspas.
- Não coloque título.
- Não use markdown.

Exemplo de formato:

Os desafios para a democratização do acesso à cultura científica no Brasil

Agora gere um tema inédito.

`;

      const response =
        await callGemini(
          apiKey,
          model,
          [
            {
              text: prompt
            }
          ]
        );

      const theme =
        extractText(response)
          .replace(/^["']|["']$/g, "")
          .trim();

      if (!theme) {

        throw new Error(
          "A IA não retornou um tema válido."
        );

      }

      return res.status(200).json({
        success: true,
        theme
      });

    }

    /* =======================================================
       AVALIAR REDAÇÃO
    ======================================================== */

    if (action === "evaluate") {

      const studentName =
        String(
          body.studentName || ""
        ).trim();

      const theme =
        String(
          body.theme || ""
        ).trim();

      const essayType =
        String(
          body.essayType || "treino"
        ).trim();

      const image =
        body.image;

      /* -------------------------------------------------------
         VALIDAÇÃO
      ------------------------------------------------------- */

      if (!studentName) {

        return res.status(400).json({
          error:
            "Nome do estudante não informado."
        });

      }

      if (!theme) {

        return res.status(400).json({
          error:
            "Tema da redação não informado."
        });

      }

      if (!image) {

        return res.status(400).json({
          error:
            "Imagem da redação não enviada."
        });

      }

      if (
        typeof image !== "string" ||
        !image.startsWith("data:image/")
      ) {

        return res.status(400).json({
          error:
            "Formato de imagem inválido."
        });

      }

      /* -------------------------------------------------------
         EXTRAIR MIME TYPE
      ------------------------------------------------------- */

      const match =
        image.match(
          /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/
        );

      if (!match) {

        return res.status(400).json({
          error:
            "Não foi possível processar a imagem."
        });

      }

      const mimeType =
        match[1];

      const base64Data =
        match[2];

      /* -------------------------------------------------------
         PROMPT DO CORRETOR
      ------------------------------------------------------- */

      const prompt = buildEvaluationPrompt({
        studentName,
        theme,
        essayType
      });

      /* -------------------------------------------------------
         CHAMADA GEMINI
      ------------------------------------------------------- */

      const response =
        await callGemini(
          apiKey,
          model,
          [
            {
              text: prompt
            },

            {
              inlineData: {
                mimeType,
                data: base64Data
              }
            }
          ],
          true
        );

      /* -------------------------------------------------------
         TEXTO
      ------------------------------------------------------- */

      const rawText =
        extractText(response);

      if (!rawText) {

        throw new Error(
          "A IA não retornou uma avaliação."
        );

      }

      /* -------------------------------------------------------
         JSON
      ------------------------------------------------------- */

      const result =
        parseGeminiJSON(
          rawText
        );

      /* -------------------------------------------------------
         NORMALIZAÇÃO
      ------------------------------------------------------- */

      const normalized =
        normalizeResult(
          result
        );

      return res.status(200).json({

        success: true,

        result: normalized

      });

    }

    /* =======================================================
       AÇÃO DESCONHECIDA
    ======================================================== */

    return res.status(400).json({

      error:
        "Ação inválida. Use generate_theme ou evaluate."

    });

  } catch (error) {

    console.error(
      "Hey ENEM API Error:",
      error
    );

    return res.status(500).json({

      error:
        getFriendlyError(error)

    });

  }

};


/* =============================================================
   GEMINI REQUEST
============================================================= */

async function callGemini(
  apiKey,
  model,
  parts,
  jsonMode = false
) {

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const generationConfig = {

    temperature:
      jsonMode
        ? 0.15
        : 0.8,

    topP:
      jsonMode
        ? 0.85
        : 0.95,

    maxOutputTokens:
      jsonMode
        ? 6000
        : 500

  };

  if (jsonMode) {

    generationConfig.responseMimeType =
      "application/json";

  }

  const payload = {

    contents: [

      {
        role: "user",

        parts

      }

    ],

    generationConfig

  };

  const response =
    await fetch(
      url,
      {

        method: "POST",

        headers: {

          "Content-Type":
            "application/json",

          "x-goog-api-key":
            apiKey

        },

        body:
          JSON.stringify(
            payload
          )

      }
    );

  const data =
    await response.json();

  if (!response.ok) {

    console.error(
      "Gemini error:",
      data
    );

    const message =
      data?.error?.message ||
      `Gemini HTTP ${response.status}`;

    throw new Error(
      message
    );

  }

  return data;

}


/* =============================================================
   PROMPT DE AVALIAÇÃO
============================================================= */

function buildEvaluationPrompt({
  studentName,
  theme,
  essayType
}) {

  return `

# PAPEL

Você é um corretor especialista em redação do ENEM.

Sua função NÃO é simplesmente dizer se a redação é boa ou ruim.

Você deve realizar um diagnóstico educacional detalhado,
criterioso e útil para que o estudante consiga melhorar
sua próxima redação.

# ESTUDANTE

Nome: ${studentName}

# TEMA

${theme}

# TIPO DE TREINO

${essayType}

# TAREFA

A imagem anexada contém a redação manuscrita ou digitada
do estudante.

Primeiro:

1. Leia cuidadosamente toda a redação.
2. Reconstrua mentalmente o texto.
3. Identifique introdução, desenvolvimento e conclusão.
4. Considere exatamente o tema fornecido.
5. Analise a redação segundo os critérios utilizados
   na correção do ENEM.

Não invente trechos que não estejam visíveis.

Se alguma parte da imagem estiver ilegível, considere
isso na análise e informe a limitação.

# COMPETÊNCIA 1 — C1

Avalie o domínio da modalidade escrita formal da língua portuguesa.

Observe:

- ortografia;
- acentuação;
- pontuação;
- concordância;
- regência;
- colocação pronominal;
- construção sintática;
- escolha vocabular;
- períodos excessivamente longos;
- fragmentação sintática;
- inadequações da norma-padrão.

Não penalize estilo pessoal quando ele não configurar
erro da modalidade formal.

# COMPETÊNCIA 2 — C2

Avalie:

- compreensão do tema;
- atendimento ao recorte temático;
- desenvolvimento do tema;
- estrutura dissertativo-argumentativa;
- presença e qualidade do repertório sociocultural;
- pertinência do repertório;
- produtividade do repertório;
- relação entre repertório e argumento.

Verifique também se existe tangenciamento ou fuga ao tema.

# COMPETÊNCIA 3 — C3

Avalie:

- seleção de argumentos;
- organização das ideias;
- progressão argumentativa;
- relação causa/consequência;
- profundidade;
- capacidade de explicar os argumentos;
- consistência das informações;
- projeto de texto.

Não confunda simplesmente "ter dois argumentos"
com desenvolver bem os argumentos.

# COMPETÊNCIA 4 — C4

Avalie:

- coesão;
- conectivos;
- encadeamento lógico;
- referenciação;
- repetição excessiva;
- progressão entre períodos;
- progressão entre parágrafos;
- relação entre as partes do texto.

# COMPETÊNCIA 5 — C5

Avalie a proposta de intervenção.

Verifique a presença e qualidade de:

- agente;
- ação;
- meio/modo;
- finalidade;
- detalhamento.

Verifique também:

- relação com a problemática;
- viabilidade;
- respeito aos direitos humanos;
- coerência com os argumentos desenvolvidos.

# NOTA

Atribua uma pontuação de 0 a 200 para cada competência.

Utilize somente múltiplos de 40:

0, 40, 80, 120, 160 ou 200.

A nota total deve ser a soma das cinco competências.

Não arredonde arbitrariamente.

# PRINCÍPIO EDUCACIONAL

O objetivo é ajudar o estudante a evoluir.

Portanto:

- explique o problema;
- mostre por que ele prejudica a nota;
- indique como corrigir;
- dê exemplos curtos de melhoria quando apropriado;
- priorize os problemas que mais impactam a nota.

Não reescreva a redação inteira.

Não produza uma "redação nota 1000" completa para o estudante copiar.

# FORMATO OBRIGATÓRIO

Retorne SOMENTE JSON válido.

Não use markdown.

Não escreva comentários antes ou depois do JSON.

Use exatamente esta estrutura:

{
  "total_score": 0,

  "general_feedback": "",

  "competencies": {

    "c1": {
      "score": 0,
      "max": 200,
      "feedback": ""
    },

    "c2": {
      "score": 0,
      "max": 200,
      "feedback": ""
    },

    "c3": {
      "score": 0,
      "max": 200,
      "feedback": ""
    },

    "c4": {
      "score": 0,
      "max": 200,
      "feedback": ""
    },

    "c5": {
      "score": 0,
      "max": 200,
      "feedback": ""
    }

  },

  "strengths": [
    "",
    "",
    ""
  ],

  "weaknesses": [
    "",
    "",
    ""
  ],

  "argumentation": [
    "",
    "",
    ""
  ],

  "language": [
    "",
    "",
    ""
  ],

  "structure": {

    "introduction": "",

    "development": "",

    "conclusion": ""

  },

  "action_plan": [
    "",
    "",
    "",
    ""
  ]

}

# REGRAS IMPORTANTES

- total_score precisa ser a soma de c1+c2+c3+c4+c5.
- Cada competência deve estar entre 0 e 200.
- Use somente 0, 40, 80, 120, 160 ou 200.
- Não invente informações ausentes.
- Não elogie excessivamente.
- Seja rigoroso, mas pedagógico.
- Não penalize o aluno duas vezes pelo mesmo problema sem justificativa.
- Diferencie erro linguístico de escolha estilística.
- Diferencie repertório citado de repertório efetivamente produtivo.
- Uma proposta de intervenção genérica não deve receber pontuação máxima.
- Se houver fuga ou tangenciamento ao tema, isso deve ser claramente indicado.
- A avaliação deve ser compatível com os critérios oficiais do ENEM.

`;

}


/* =============================================================
   EXTRACT TEXT
============================================================= */

function extractText(data) {

  return (
    data
      ?.candidates?.[0]
      ?.content?.parts
      ?.map(part => part.text || "")
      ?.join("") ||
    ""
  ).trim();

}


/* =============================================================
   PARSE JSON
============================================================= */

function parseGeminiJSON(text) {

  let clean =
    String(text)
      .trim();

  /* -----------------------------------------------------------
     Remove markdown fences
  ----------------------------------------------------------- */

  clean =
    clean
      .replace(
        /^```json\s*/i,
        ""
      )
      .replace(
        /^```\s*/i,
        ""
      )
      .replace(
        /\s*```$/i,
        ""
      )
      .trim();

  /* -----------------------------------------------------------
     Primeira tentativa
  ----------------------------------------------------------- */

  try {

    return JSON.parse(
      clean
    );

  } catch (_) {}

  /* -----------------------------------------------------------
     Tentar localizar objeto JSON
  ----------------------------------------------------------- */

  const first =
    clean.indexOf("{");

  const last =
    clean.lastIndexOf("}");

  if (
    first !== -1 &&
    last !== -1 &&
    last > first
  ) {

    const possibleJSON =
      clean.slice(
        first,
        last + 1
      );

    try {

      return JSON.parse(
        possibleJSON
      );

    } catch (_) {}

  }

  throw new Error(
    "A IA retornou uma resposta em formato inválido."
  );

}


/* =============================================================
   NORMALIZAÇÃO
============================================================= */

function normalizeResult(result) {

  const allowedScores =
    [0, 40, 80, 120, 160, 200];

  const normalizeScore =
    value => {

      let score =
        Number(value);

      if (!Number.isFinite(score)) {

        score = 0;

      }

      score =
        Math.round(score / 40) * 40;

      if (
        !allowedScores.includes(score)
      ) {

        score =
          Math.min(
            200,
            Math.max(
              0,
              score
            )
          );

      }

      return score;

    };

  const normalizeCompetency =
    code => {

      const item =
        result?.competencies?.[code] ||
        {};

      return {

        score:
          normalizeScore(
            item.score
          ),

        max: 200,

        feedback:
          String(
            item.feedback ||
            "Sem comentário."
          )

      };

    };

  const competencies = {

    c1:
      normalizeCompetency("c1"),

    c2:
      normalizeCompetency("c2"),

    c3:
      normalizeCompetency("c3"),

    c4:
      normalizeCompetency("c4"),

    c5:
      normalizeCompetency("c5")

  };

  const totalScore =
    competencies.c1.score +
    competencies.c2.score +
    competencies.c3.score +
    competencies.c4.score +
    competencies.c5.score;

  return {

    total_score:
      totalScore,

    general_feedback:
      String(
        result.general_feedback ||
        ""
      ),

    competencies,

    strengths:
      normalizeArray(
        result.strengths
      ),

    weaknesses:
      normalizeArray(
        result.weaknesses
      ),

    argumentation:
      normalizeArray(
        result.argumentation
      ),

    language:
      normalizeArray(
        result.language
      ),

    structure: {

      introduction:
        String(
          result?.structure?.introduction ||
          ""
        ),

      development:
        String(
          result?.structure?.development ||
          ""
        ),

      conclusion:
        String(
          result?.structure?.conclusion ||
          ""
        )

    },

    action_plan:
      normalizeArray(
        result.action_plan
      )

  };

}


/* =============================================================
   ARRAY NORMALIZER
============================================================= */

function normalizeArray(value) {

  if (!Array.isArray(value)) {

    return [];

  }

  return value

    .map(
      item =>
        String(item || "").trim()
    )

    .filter(Boolean)

    .slice(0, 8);

}


/* =============================================================
   FRIENDLY ERRORS
============================================================= */

function getFriendlyError(error) {

  const message =
    String(
      error?.message ||
      ""
    );

  if (
    message.includes("API key") ||
    message.includes("API_KEY")
  ) {

    return (
      "A configuração da IA está incorreta. " +
      "Verifique a GEMINI_API_KEY na Vercel."
    );

  }

  if (
    message.includes("429")
  ) {

    return (
      "A IA recebeu muitas solicitações. " +
      "Aguarde alguns segundos e tente novamente."
    );

  }

  if (
    message.includes("413")
  ) {

    return (
      "A imagem enviada é muito grande."
    );

  }

  if (
    message.includes("SAFETY") ||
    message.includes("blocked")
  ) {

    return (
      "A análise foi bloqueada pelo sistema de segurança da IA."
    );

  }

  if (
    message.includes("invalid")
  ) {

    return (
      "A imagem ou solicitação não pôde ser processada."
    );

  }

  return (
    "Não foi possível concluir a análise. " +
    "Tente novamente em alguns instantes."
  );

}
