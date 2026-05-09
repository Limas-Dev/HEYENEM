export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Chave de API não configurada.' });

    const { image, theme } = req.body;

    const promptText = `Atue como um corretor especialista da redação do ENEM. O tema é: ${theme}. Transcreva o texto da imagem e avalie rigorosamente com notas de 0 a 200 nas 5 competências.`;

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { text: promptText },
                        { inlineData: { mimeType: image.mimeType, data: image.base64Data } }
                    ]
                }]
            })
        });
        const data = await response.json();
        
        // Desempacota o texto no servidor
        const textoFeedback = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!textoFeedback) {
            console.error("Erro na estrutura da IA:", data);
            return res.status(500).json({ error: 'A IA não conseguiu avaliar a imagem.' });
        }

        // Devolve apenas o texto da correção
        res.status(200).json({ feedback: textoFeedback });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao processar redação.' });
    }
}
