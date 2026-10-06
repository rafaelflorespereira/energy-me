# Guia para a versão iOS

A versão iOS deve se comportar como a web. Tudo que não é tela está em `web/src/domain/` e tem testes em `web/src/domain/domain.test.ts`, que servem como casos de teste para reproduzir em Swift.

## O que portar

| Web | iOS (sugestão) |
| --- | --- |
| `domain/feelings.ts` | `enum Feeling` com nome, órgão, elemento, `isPositive` |
| `domain/checkins.ts` | `struct CheckIn { date, values }`, um por dia; leitura que descarta dado inválido |
| `domain/stats.ts` | `periodStats`, `analyze`, `series` |
| `domain/dates.ts` | `Calendar.current` com `DateComponents` (dia local, não UTC) |
| `storage.ts` (`localStorage`) | SwiftData ou arquivo JSON no app |
| `ui/` | SwiftUI: tela de check-in, tela de resumo, Swift Charts para barras e linha |

## Regras que precisam ficar idênticas

- Escala 0–4: não sinto, leve, moderada, forte, intensa.
- Janela de período: 7 dias (semana) ou 30 dias (mês) terminando hoje, inclusive. O período anterior é a janela do mesmo tamanho logo antes.
- Média por sentimento considera só os dias com check-in.
- "Carga" = média dos seis sentimentos difíceis (todos menos alegria). Tendência: mais leve ou mais pesada quando a carga varia mais de 5% em relação ao período anterior; senão, parecida. Sem período anterior, não há comparação.
- Melhorou/piorou por sentimento: variação de média maior que 0,15 (alegria subir = melhora). Mostrar até 2 melhoras e 1 piora.
- Sentimento "mais presente" = difícil com maior média no período.

## Fora do escopo por enquanto

Contas e login (existe um template Cognito em `aws-cognito-template/` para quando houver), sincronização entre aparelhos e notificações.
