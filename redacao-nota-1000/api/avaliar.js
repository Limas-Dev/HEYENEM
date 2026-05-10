export default async function handler(req, res) {
    // Apenas aceitar pedidos POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método não permitido' });
    }

    try {
        // A sua chave secreta virá das Variáveis de Ambiente da Vercel
        const apiKey = process.env.GEMINI_API_KEY; 
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;

        // Faz o pedido à API da Google com os dados que vieram do Frontend
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body)
        });

        const data = await response.json();
        
        // Devolve o resultado ao frontend
        res.status(200).json(data);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao processar a avaliação' });
    }
}