export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método não permitido' });
    }

    try {
        const apiKey = process.env.GEMINI_API_KEY;
        const promptText = `Atue como a banca elaboradora da prova de redação do ENEM (INEP). > Crie uma frase-tema inédita, atual e realista para uma redação do ENEM, focada em um problema social, ambiental ou tecnológico brasileiro contemporâneo (seguindo o formato clássico, como "Desafios para...", "Caminhos para combater...", "Os impactos de...").\nREGRA RESTRITA: Você deve responder apenas e unicamente com a frase do tema gerado. Não inclua textos motivadores, não use aspas, não dê explicações, introduções, saudações ou qualquer outra palavra adicional. A sua resposta deve ser estritamente a frase do tema.`;

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: promptText }] }]
            })
        });

        const data = await response.json();
        
        if (data.error) {
            return res.status(500).json({ error: data.error.message });
        }

        if (data.candidates && data.candidates.length > 0) {
            let tema = data.candidates[0].content.parts[0].text.trim();
            tema = tema.replace(/^["']|["']$/g, '');
            return res.status(200).json({ tema: tema });
        } else {
            return res.status(500).json({ error: "Formato de resposta inesperado da API." });
        }

    } catch (error) {
        return res.status(500).json({ error: "Erro interno no servidor." });
    }
}