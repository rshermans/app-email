# Smart Outreach Mailer

Mini plataforma para enviar emails personalizados através de SMTP próprio.

## Requisitos

- Node.js 24+
- npm

## Arranque local

```bash
npm install
npm run dev
```

Frontend: http://localhost:5173  
API: http://localhost:4000

No PowerShell, se `npm` estiver bloqueado por Execution Policy, use:

```powershell
npm.cmd install
npm.cmd run dev
```

## Docker

```bash
docker compose up --build
```

App: http://localhost:4000

## Variáveis

Crie `.env` a partir de `.env.example` antes de produção.

`APP_SECRET` é usado para cifrar a password SMTP em SQLite. Se este valor mudar, passwords já guardadas deixam de poder ser decifradas.

## CSV

Campos aceites:

- `Nome` ou `Name`
- `Email`
- `Company`, `Empresa` ou `Companhia`

Existe um exemplo em `samples/contacts.csv`.

## MVP incluído

- Upload CSV com preview, validação e bloqueio de duplicados.
- Templates reutilizáveis em texto e HTML.
- Variáveis `{{name}}`, `{{email}}`, `{{company}}`.
- Configuração SMTP com password cifrada.
- Teste de ligação SMTP.
- Campanhas imediatas ou agendadas.
- Intervalo entre emails e limite por minuto.
- Confirmação obrigatória antes de enviar.
- Monitorização, logs de erro SMTP e histórico.
