export default async function handler(req, res) {
    // Para aceitar uploads maiores, o Vercel pode precisar configurar o `api` na config, 
    // mas o limite padrão já é de cerca de 4.5MB para o Payload body.
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método não permitido' });
    }

    try {
        const { theme, image } = req.body;

        if (!image || !image.mimeType || !image.base64Data) {
            return res.status(400).json({ error: 'Dados da imagem incompletos.' });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        
        const promptText = `Atue como um corretor especialista da redação do ENEM (Exame Nacional do Ensino Médio).
> Em anexo, estou enviando uma fotografia de uma redação escrita à mão. O tema desta redação é: ${theme}.
Sua tarefa é ler a imagem, transcrever o texto (para que eu saiba que você leu corretamente) e avaliá-la rigorosamente com base nas diretrizes oficiais do INEP.

PASSO 1: VERIFICAÇÃO DE ANULAÇÃO (NOTA ZERO)
Antes de iniciar a correção, verifique se a redação se enquadra em algum critério de anulação imediata:
- Fuga total do tema.
- Menos de 7 linhas escritas.
- Presença de desenhos, sinais gráficos sem função ou mensagens ofensivas.
- Cópia integral de textos motivadores.
Se algum destes critérios for atendido, encerre a correção aqui, explique o motivo e dê a nota final ZERO.

PASSO 2: AVALIAÇÃO DAS 5 COMPETÊNCIAS
Se o texto for válido, avalie-o atribuindo uma nota de 0 a 200 pontos para cada uma das 5 competências abaixo.
Justifique a nota de cada uma apontando os erros e acertos no texto do aluno:
Competência 1 (C1) - Domínio da norma culta: Avalie ortografia, acentuação, gramática, concordância, regência, pontuação e escolha de vocabulário (modalidade escrita formal).
Competência 2 (C2) - Compreensão do tema e áreas do conhecimento: Verifique se o texto atende ao modelo dissertativo-argumentativo, se não tangencia o tema e se utiliza repertório sociocultural produtivo e legitimado.
Competência 3 (C3) - Organização das ideias: Avalie o "projeto de texto". O aluno conseguiu selecionar, relacionar, interpretar e organizar informações e argumentos de forma coerente em defesa de um ponto de vista?
Competência 4 (C4) - Conhecimento linguístico: Analise a coesão textual. Verifique a presença, a diversidade e o uso correto de conectivos e operadores argumentativos entre os parágrafos e dentro das frases.
Competência 5 (C5) - Proposta de intervenção: Avalie a solução para o problema abordado. Ela respeita os direitos humanos? Identifique se a proposta contém os 5 elementos obrigatórios: Agente, Ação, Meio/Modo, Efeito e Detalhamento.

PASSO 3: FORMATO DA SUA RESPOSTA
Entregue sua análise exatamente nesta estrutura:
Transcrição do Texto: (Escreva aqui o que você conseguiu ler da imagem. Se alguma palavra estiver ilegível, marque como [ilegível]).
Comentários Gerais: (Um breve resumo dos pontos fortes e fracos).
Notas por Competência:
C1: [Nota] - [Justificativa e erros apontados]
C2: [Nota] - [Justificativa]
C3: [Nota] - [Justificativa]
C4: [Nota] - [Justificativa]
C5: [Nota] - [Justificativa indicando os 5 elementos se existirem]
NOTA FINAL: [Soma total das competências, de 0 a 1000].`;

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                contents: [{
                    role: "user",
                    parts: [
                        { text: promptText },
                        { inlineData: { mimeType: image.mimeType, data: image.base64Data } }
                    ]
                }]
            })
        });

        const data = await response.json();
        
        if (data.error) {
            return res.status(500).json({ error: data.error.message });
        }

        const feedbackText = data.candidates?.[0]?.content?.parts?.[0]?.text || "Erro ao gerar feedback.";
        
        return res.status(200).json({ feedback: feedbackText });

    } catch (error) {
        return res.status(500).json({ error: "Erro interno ao processar a avaliação." });
    }
}