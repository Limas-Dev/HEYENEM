module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método não permitido' });
    }

    try {
        const apiKey = process.env.GEMINI_API_KEY; 
        
        if (!apiKey) {
            return res.status(500).json({ error: 'Chave da API ausente na Vercel.' });
        }

        // USANDO O MODELO E A URL EXATA DO SEU EXEMPLO
        const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent";

        const response = await fetch(url, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey // Usando o cabeçalho conforme seu curl
            },
            body: JSON.stringify(req.body)
        });

        const data = await response.json();
        
        if (!response.ok) {
            console.error("Erro Google:", data);
            return res.status(response.status).json(data);
        }
        
        res.status(200).json(data);
        
    } catch (error) {
        res.status(500).json({ error: 'Erro no servidor da Vercel.' });
    }
}
