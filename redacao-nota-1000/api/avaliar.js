module.exports = async function handler(req, res) {
    // 1. Verifica se é POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método não permitido' });
    }

    try {
        const apiKey = process.env.GEMINI_API_KEY; 
        
        // 2. Proteção: Verifica se a chave foi carregada pela Vercel
        if (!apiKey) {
            console.error("ERRO: A chave da API não foi encontrada nas variáveis de ambiente!");
            return res.status(500).json({ error: 'Chave da API ausente no servidor.' });
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

        // 3. Faz a requisição à Google (usando o fetch nativo do Node.js 18+)
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body)
        });

        const data = await response.json();
        
        // 4. Se a API do Google reclamar de algo, avisa o frontend
        if (!response.ok) {
            console.error("Erro da Google API:", JSON.stringify(data, null, 2));
            return res.status(response.status).json(data);
        }
        
        // 5. Sucesso! Envia a resposta final para a sua tela
        res.status(200).json(data);
        
    } catch (error) {
        console.error("Erro interno no servidor da Vercel:", error);
        res.status(500).json({ error: 'Erro no servidor ao tentar falar com a IA.' });
    }
}
