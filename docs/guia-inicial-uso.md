# Guia inicial de uso — LifeInternet Mail Studio

## 1. Visão geral

O LifeInternet Mail Studio é uma aplicação para organizar campanhas de email por evento, gerir público, associar templates, configurar SMTP e disparar mensagens com controle de qualidade.

A proposta da ferramenta é reduzir fricção operacional e ajudar o utilizador a lançar campanhas com confiança, sem depender de ferramentas dispersas.

## 2. Primeiros passos

### 2.1 Requisitos
- Node.js 24 ou superior
- npm
- acesso ao servidor SMTP do cliente ou fornecedor
- arquivo CSV do público
- templates HTML prontos ou importados

### 2.2 Instalação local

```bash
npm install
npm run dev
```

A aplicação fica disponível em:
- Frontend: http://localhost:5173
- Backend: http://localhost:4000

Se estiver em PowerShell:

```powershell
npm.cmd install
npm.cmd run dev
```

## 3. Fluxo recomendado de uso

### Passo 1 — Criar um evento
Na área de eventos, crie um novo evento com nome, descrição e contexto do público. Cada evento mantém o seu próprio conjunto de contactos, templates e campanhas.

### Passo 2 — Importar público
Aceda à secção Público e importe um CSV.

Colunas reconhecidas automaticamente:
- Nome / Name
- Email / E-mail / Mail
- Company / Empresa / Companhia
- Grupo / Group / Segmento
- Modelo / template

O sistema preserva as colunas adicionais e as transforma em variáveis como:
- {{NOME}}
- {{EMPRESA}}
- {{TOTAL}}
- {{FEEDBACK}}

### Passo 3 — Validar dados
Antes de enviar, confirme:
- todos os emails estão válidos
- não existem entradas duplicadas
- cada pessoa está ligada ao evento correto
- os segmentos estão bem identificados

### Passo 4 — Criar ou importar template
Na secção Templates:
- importe um HTML
- edite o assunto e o corpo
- valide o preview em desktop/mobile
- teste com um destinatário real ou fictício

### Passo 5 — Configurar SMTP
Na área de Definições:
- introduza host
- escolha a porta
- insira email e password
- faça teste de ligação

A password é guardada de forma cifrada na base de dados.

### Passo 6 — Preparar campanha
Escolha:
- template
- destinatários selecionados
- limite de envios por minuto
- agendamento ou envio imediato

### Passo 7 — Enviar e monitorizar
Depois do envio, acompanhe:
- entregues
- falhas
- logs de SMTP
- histórico da campanha

## 4. Boas práticas

### Qualidade do público
- Use colunas bem nomeadas
- Evite emails duplicados
- Separe segmentos por público, comportamento ou evento

### Qualidade dos templates
- Use HTML limpo
- Evite conteúdo muito pesado
- Teste sempre antes do envio em massa
- Prefira mensagens em linguagem clara e objetiva

### Qualidade do envio
- Ajuste o limite de envios por minuto para evitar reputação negativa
- Faça testes pequenos antes de campanhas grandes
- Não use listas sem consentimento válido
- Mantenha a mensagem relevante para o segmento

## 5. Checklist de envio seguro

Antes de pressionar Enviar Agora, confirme:
- [ ] evento criado
- [ ] público importado
- [ ] emails validados
- [ ] template atribuído
- [ ] servidor SMTP configurado
- [ ] ligação testada
- [ ] destino correto
- [ ] limite de velocidade definido
- [ ] campanha revisada

## 6. Troubleshooting

### SMTP não funciona
- verifique host e porta
- confirme se o servidor aceita mails externos
- valide as credenciais
- teste a ligação antes do envio

### CSV não é reconhecido
- confirme cabeçalhos em inglês ou português
- verifique se existem colunas duplicadas
- remova espaços e caracteres estranhos nos nomes das colunas

### Template não aparece corretamente
- confirme que o HTML está válido
- verifique variáveis do template
- teste em preview antes do envio

### Campanha sem destinatários
- confirme se pelo menos um contacto está selecionado
- revise os filtros de segmento
- verifique se o evento tem público associado

## 7. Regras de uso responsável

- Não envie campanhas a pessoas que não tenham consentimento explícito
- Use nomes e endereços corretos no remetente
- Evite conteúdo enganoso
- Mantenha log e historial para auditoria
- Respeite as regras do fornecedor SMTP

## 8. Próximo passo recomendado

Para aquele que está a começar, o melhor caminho é:
1. criar um evento
2. importar um CSV pequeno
3. criar um template simples
4. testar SMTP
5. enviar uma campanha de teste
6. analisar resultados e repetir com segurança

Este fluxo reduz erros e aumenta a confiança do utilizador desde o primeiro envio.
