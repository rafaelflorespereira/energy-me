# energy-me

App de check-in emocional baseado nos sentimentos da Medicina Tradicional Chinesa (raiva, frustração, preocupação, alegria, tristeza, culpa e medo), com resumo e acompanhamento por semana e mês.

- [`web/`](web/README.md): app web mobile first
- [`infra/`](infra/README.md): infraestrutura AWS CDK para a API de check-ins (GET/PUT de check-ins, usada pelo web app quando `VITE_CHECKINS_API_URL` está configurada)
- [`docs/design/prototipo-telas.html`](docs/design/prototipo-telas.html): protótipo visual das duas telas
- [`docs/ios-port.md`](docs/ios-port.md): guia para a versão iOS, que virá em um diretório próprio
- [`docs/checkin-persistence.md`](docs/checkin-persistence.md): proposta de persistência dos check-ins com Cognito, API e DynamoDB
- [`docs/backlog.md`](docs/backlog.md): próximas melhorias de produto, incluindo cenários visuais por sentimento no resumo
- [`aws-cognito-template/`](aws-cognito-template/README.md): template de autenticação para uso futuro
