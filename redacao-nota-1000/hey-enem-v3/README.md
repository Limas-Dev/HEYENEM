# HeyENEM — V3

Corretor online de folhas de respostas de Natureza (questões 136–180), reestruturado a partir da planilha `.xlsx` fornecida.

## O que foi reproduzido da planilha

A planilha possui 45 questões, organizadas estatisticamente em:

- Física: 5 fáceis, 5 médias, 5 difíceis
- Química: 5 fáceis, 5 médias, 5 difíceis
- Biologia: 5 fáceis, 5 médias, 5 difíceis

A ordem estatística é a mesma das abas M1/M2/N1/N2.

### Gabarito

O gabarito da aba `Página2`, linha 3, foi incorporado em ordem numérica 136 → 180:

`ABC CBEACEEBCCCD...`

A interface começa com esse gabarito da planilha, mas também permite preencher tudo com A, limpar e colar um gabarito personalizado.

### Fórmulas

Para cada aluno, a planilha usa:

- `S = SUM(C:AU)` → soma dos 45 resultados binários.
- `F` → soma dos 15 itens classificados como F.
- `M` → soma dos 15 itens classificados como M.
- `D` → soma dos 15 itens classificados como D.
- `TRI = 400 + 900 * ((F + 1.5*M + 1.75*D) / 90)^1.14`

O arquivo `js/correctionEngine.js` implementa esses cálculos localmente e `js/tri.js` documenta a fórmula.

Também há estatísticas de turma (total por questão, média, moda, mediana, máximo e mínimo) em `calculateClassStatistics()`.

## Arquitetura

```text
Foto
 ↓
Gemini Vision
 ↓
45 respostas + confiança
 ↓
correctionEngine.js
 ↓
S / F / M / D / disciplinas / dificuldades
 ↓
tri.js
 ↓
dashboard
```

A IA não calcula a nota. Ela somente interpreta a imagem.

## Segurança

A chave da Gemini não fica no navegador. O frontend chama `/api/analyze`, e a função serverless usa `GEMINI_API_KEY`.

## Rodar localmente

Requer Node.js 20+ e Vercel CLI.

```bash
npm install -g vercel
vercel dev
```

Crie `.env.local`:

```env
GEMINI_API_KEY=sua_chave
GEMINI_MODEL=gemini-3.6-flash
```

Abra o endereço mostrado pelo `vercel dev`.

## Deploy

1. Suba o projeto para GitHub.
2. Importe o repositório na Vercel.
3. Em Settings → Environment Variables, adicione `GEMINI_API_KEY`.
4. Opcionalmente defina `GEMINI_MODEL`.
5. Faça o deploy.

## Observação sobre a TRI

A fórmula reproduzida é a fórmula matemática existente nas células AZ das abas da planilha. Isso não significa que seja a TRI oficial utilizada pelo ENEM/Inep; o HeyENEM apenas reproduz a transformação da planilha fornecida.
