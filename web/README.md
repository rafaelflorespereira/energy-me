# Quem sou eu como energia · Web

App web mobile first para registrar como a pessoa se sente (sentimentos da MTC) e acompanhar a evolução por semana e por mês. React + TypeScript + Vite, sem backend: os registros ficam no `localStorage` do aparelho.

## Rodar

```bash
cd web
npm install
npm run dev        # http://localhost:5173
npm test           # testes da lógica (src/domain)
npm run build      # checagem de tipos + build de produção em dist/
```

Em telas largas o app aparece em uma coluna de celular centralizada. O `manifest.webmanifest` permite adicionar à tela inicial.

## Estrutura

```text
src/
├── domain/   # Regras do app, sem React nem navegador (esta é a especificação para o iOS)
│   ├── feelings.ts   # 7 sentimentos, órgão/elemento, escala 0–4
│   ├── checkins.ts   # um registro por dia, leitura segura do armazenamento
│   ├── stats.ts      # médias por período, análise semana/mês, série para o gráfico
│   ├── sample.ts     # dados de exemplo determinísticos
│   └── dates.ts      # datas como AAAA-MM-DD no fuso local
├── ui/       # Telas e componentes React (check-in, resumo, gráficos, textos em português)
├── storage.ts
└── App.tsx
```

## Decisões de produto

- Check-in por toques: quatro círculos por sentimento (leve, moderada, forte, intensa). O que não é tocado conta como "não sinto".
- Um registro por dia. Registrar de novo no mesmo dia atualiza o de hoje.
- Resumo abre com a análise do período escolhido (semana = 7 dias, mês = 30 dias) comparada ao período anterior de mesmo tamanho. Para alegria, subir é melhora; para os demais, descer é melhora.
- Cores e órgãos seguem os Cinco Elementos. Culpa está ligada ao Rim (Água), a confirmar.
