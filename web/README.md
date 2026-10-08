# Quem sou eu como energia · Web

App web mobile first para registrar como a pessoa se sente (sentimentos da MTC) e acompanhar a evolução por semana e por mês. React + TypeScript + Vite, com Google SSO via Amazon Cognito. Os registros ficam no `localStorage` do aparelho, separados por conta. Com `VITE_CHECKINS_API_URL` configurada (o output `CheckInsApiUrl` do [`infra/`](../infra/README.md)), eles passam a ser lidos e salvos na API; nesse modo os dados de exemplo e o "Apagar histórico" ficam ocultos, e registros que já estavam no aparelho não são enviados automaticamente.

## Rodar

```bash
cd web
npm install
cp .env.example .env.local  # preencher com os dados do Cognito
npm run dev        # http://localhost:5173
npm test           # lógica, autenticação e isolamento entre contas
npm run build      # checagem de tipos + build de produção em dist/
```

Em telas largas o app aparece em uma coluna de celular centralizada. O `manifest.webmanifest` permite adicionar à tela inicial.

## Google SSO

1. No Google Cloud, configure a tela de consentimento OAuth e crie um cliente OAuth do tipo **Web application**. Durante o modo de teste, adicione os usuários de teste. Registre `https://SEU-DOMINIO-COGNITO/oauth2/idpresponse` como **Authorized redirect URI**. Este endereço pertence ao Cognito, não ao app web.
2. No Cognito User Pool, adicione o provedor **Google** com o client ID e o client secret do Google. Use os escopos `openid email profile` e mapeie `email` e `name` para os atributos correspondentes do pool. Guarde o secret somente no Cognito, nunca no app ou nas variáveis `VITE_*`.
3. Configure um domínio de managed login/Hosted UI no Cognito. Crie um app client público para SPA, **sem client secret**, habilite Google como provedor e habilite **Authorization code grant**, com os escopos `openid email profile`. Habilite a emissão de refresh tokens. O cliente web usa PKCE automaticamente.
4. Registre `http://localhost:5173/auth/callback` nas **Allowed callback URLs** e `http://localhost:5173/` nas **Allowed sign-out URLs**. Os endereços precisam corresponder exatamente, incluindo porta e barra final. Adicione também as URLs HTTPS da implantação.
5. Preencha `.env.local` a partir de `.env.example` e reinicie o Vite. `VITE_COGNITO_ISSUER` é a URL do User Pool (`https://cognito-idp.REGIAO.amazonaws.com/POOL_ID`), `VITE_COGNITO_CLIENT_ID` é o ID do app client, e `VITE_COGNITO_DOMAIN` é a origem HTTPS do managed login, sem `/login` ou outro caminho.

A variável opcional `VITE_CHECKINS_API_URL` liga o app à API de check-ins; sem ela, tudo continua local. As variáveis opcionais `VITE_COGNITO_REDIRECT_URI` e `VITE_COGNITO_LOGOUT_URI` devem usar a mesma origem do app. Se omitidas, são calculadas a partir da origem atual, com `/auth/callback` e `/`. Ao usar outra porta local, registre os novos endereços no Cognito e atualize ou omita essas variáveis. Todas as variáveis `VITE_*` são públicas e incorporadas ao build; não inclua segredos.

Na implantação, configure o servidor estático para devolver `index.html` em `/auth/callback` (fallback de SPA) e use HTTPS. Sem configuração, o app mostra o login indisponível e não libera os registros.

### Sessão e dados

- O cliente OIDC valida o estado do callback e usa Authorization Code + PKCE. Os tokens e o estado OAuth ficam em `sessionStorage`, não em `localStorage`; a sessão é restaurada ao recarregar a mesma aba e renovada com refresh token. Fechar a aba remove esse armazenamento. Proteja a implantação contra XSS: tokens no navegador não substituem uma sessão de backend com cookie HttpOnly.
- Sair remove a sessão local e encerra a sessão do Cognito. Não encerra a sessão global do Google; um próximo login pode reutilizar a conta Google já conectada.
- Check-ins são locais e separados pelo `sub` do Cognito. Trocar de conta desmonta a tela anterior antes de carregar os registros da nova conta. Não há sincronização entre dispositivos nem criptografia dos registros locais.
- Registros anônimos antigos são preservados na chave original, mas não são atribuídos automaticamente a nenhuma conta. Isso evita expor dados de outra pessoa que tenha usado o mesmo navegador.
- Os testes automatizados cobrem a configuração, callbacks aceitos e rejeitados, renovação, logout e isolamento de dados. Para validar o SSO real, entre com um usuário de teste Google, recarregue a página, saia e entre com outra conta.

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
├── auth.ts   # Cognito OIDC, Google SSO, callback, renovação e logout
└── App.tsx
```

## Decisões de produto

- Check-in por toques: quatro círculos por sentimento (leve, moderada, forte, intensa). O que não é tocado conta como "não sinto".
- Um registro por dia. Registrar de novo no mesmo dia atualiza o de hoje.
- Resumo abre com a análise do período escolhido (semana = 7 dias, mês = 30 dias) comparada ao período anterior de mesmo tamanho. Para alegria, subir é melhora; para os demais, descer é melhora.
- Cores e órgãos seguem os Cinco Elementos. Culpa está ligada ao Rim (Água), a confirmar.
