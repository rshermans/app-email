# APP-EMAIL (Smart Outreach Mailer)

**Criado por:** Rômulo Shermans (2026)

O **APP-EMAIL** (Smart Outreach Mailer) é uma mini plataforma desenvolvida para gerir o envio de campanhas de e-mails personalizados através de um servidor SMTP próprio. A aplicação permite a importação de listas de contactos, a criação de templates dinâmicos (com variáveis) e o agendamento e envio massivo de e-mails, garantindo respeito pelos limites de envio do servidor (rate-limiting).

---

## 🌟 Principais Funcionalidades

- **Gestão de Contactos via CSV**: Upload de ficheiros CSV com pré-visualização, validação de endereços de e-mail e bloqueio automático de duplicados.
- **Templates Dinâmicos**: Criação e edição de templates de e-mail em formato HTML e Texto Simples. Suporta as variáveis: `{{name}}`, `{{email}}`, e `{{company}}`.
- **Configuração SMTP Segura**: Introduza as credenciais do seu servidor SMTP. As palavras-passe são guardadas de forma cifrada (AES) na base de dados SQLite. Funcionalidade de teste de ligação incluída.
- **Campanhas e Agendamento**: Lance campanhas imediatas ou agende para envio no futuro.
- **Controlo de Fluxo (Rate Limiting)**: Defina o limite máximo de e-mails por minuto e o intervalo de pausa entre cada envio para evitar que o seu e-mail seja classificado como spam.
- **Monitorização e Logs**: Histórico detalhado de envios e registo de erros (SMTP) acessível na base de dados.

---

## 🚀 Como Utilizar

### 1. Importar Contactos
Na secção "Contactos", faça o upload de um ficheiro CSV. O sistema procura pelas colunas:
- `Nome` ou `Name`
- `Email`, `E-mail` ou `Mail`
- `Company`, `Empresa` ou `Companhia`

*Existe um ficheiro de exemplo em `samples/contacts.csv`.*

### 2. Criar Templates
Na secção "Templates", crie as suas mensagens. Pode redigir o corpo em HTML (recomendado para e-mails profissionais e com design) ou apenas em texto simples. Não se esqueça de usar as variáveis dinâmicas (ex: `Olá {{name}}`).

### 3. Configurar Servidor (SMTP)
Na secção "Definições SMTP", insira os dados do seu fornecedor de e-mail (Host, Porta, E-mail, Password). Faça o **Teste de Ligação** para garantir que as credenciais estão corretas.

### 4. Lançar a Campanha
Selecione o Template, o limite de envios por minuto e carregue em "Enviar Agora".

---

## 💻 Requisitos Técnicos

- **Node.js** (versão 24 ou superior)
- **NPM** (Node Package Manager)

## 🛠 Como Executar Localmente

### Usando o NPM (Modo de Desenvolvimento)

Instale as dependências:
```bash
npm install
```

Inicie o servidor (Backend + Frontend em modo watch):
```bash
npm run dev
```

- **Frontend (Interface)**: [http://localhost:5173](http://localhost:5173)
- **API (Backend)**: [http://localhost:4000](http://localhost:4000)

*Nota para utilizadores de Windows PowerShell*: Caso o `npm` esteja bloqueado por políticas de execução, utilize:
```powershell
npm.cmd install
npm.cmd run dev
```

### Executar em Ambiente de Produção

Construa a aplicação web (Frontend):
```bash
npm run build
```

E inicie o servidor:
```bash
npm start
```
A aplicação ficará inteiramente disponível em [http://localhost:4000](http://localhost:4000).

### Usando Docker (Recomendado)

Se preferir não instalar o Node.js localmente, use o Docker:
```bash
docker compose up --build
```
Aceda em: [http://localhost:4000](http://localhost:4000)

---

## 🔐 Configuração e Variáveis de Ambiente

Antes de usar o projeto em produção, copie o ficheiro `.env.example` para `.env` e ajuste as variáveis necessárias:

- `PORT`: Porta onde o backend irá escutar (por defeito `4000`).
- `DATA_DIR`: Diretoria onde será guardada a base de dados SQLite.
- `APP_SECRET`: **Muito Importante**. Esta chave (secreta e aleatória) é usada para cifrar a password SMTP na base de dados. Se perder ou alterar esta chave, todas as passwords de SMTP previamente guardadas deixarão de poder ser decifradas.
- `GLOBAL_MAX_EMAILS_PER_MINUTE`: Limite máximo absoluto de e-mails que o sistema tentará enviar por minuto (salvaguarda de segurança).
