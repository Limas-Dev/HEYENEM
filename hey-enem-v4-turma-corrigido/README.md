# HeyENEM — V4 Turma

Sistema web para correção em lote de cartões-resposta com 90 questões.

## Fluxo

1. Cadastre um gabarito oficial com exatamente 90 respostas (01–90).
2. Selecione várias fotos de cartões-resposta.
3. Cada foto é enviada individualmente para a função serverless de visão.
4. A IA extrai nome, documento, matrícula (quando visíveis) e as 90 marcações.
5. O motor local compara as marcações com o gabarito.
6. Ao final, a aba **Alunos** mostra cada estudante.
7. Clicar no nome abre o dashboard individual.
8. A aba **Dashboard da turma** consolida a turma inteira.

## Dificuldade das questões

A dificuldade não é mais definida por uma classificação fixa do arquivo original.

Para cada questão, considerando apenas respostas válidas (acerto ou erro):

- **Fácil:** número de acertos > número de erros.
- **Difícil:** número de erros > número de acertos.
- **Média:** número de acertos = número de erros.
- **Sem dados:** não houve resposta válida suficiente para comparação.

Brancos e leituras não identificadas ficam fora da disputa acerto × erro.

## Segurança

A chamada ao Gemini passa por `/api/analyze` e usa `GEMINI_API_KEY` na Vercel. Não coloque a chave real em `index.html`, `app.js` ou `.env.example`.

## Deploy

Crie a variável de ambiente na Vercel:

```env
GEMINI_API_KEY=sua_chave_real
GEMINI_MODEL=gemini-3.6-flash
```

## Execução local

```bash
npm install -g vercel
vercel dev
```

## Observação

Para manter exatamente 90 questões, a numeração da aplicação é **01–90**. Uma faixa literal 0–90 teria 91 posições.
