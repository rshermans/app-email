import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import multer from "multer";
import nodemailer from "nodemailer";
import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { db, getCampaignWithDetails, listCampaigns, nowIso } from "./db/database.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { renderTemplate } from "./render.js";
import {
  isValidEmail,
  normalizeEmail,
  positiveInteger,
  publicSmtpSettings
} from "./validators.js";

const app = express();
const port = Number(process.env.PORT || 4000);
const globalMaxPerMinute = Number(process.env.GLOBAL_MAX_EMAILS_PER_MINUTE || 60);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }
});

const activeCampaigns = new Set();
const scheduledTimers = new Map();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 600,
    standardHeaders: true,
    legacyHeaders: false
  })
);

const campaignCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false
});

function asyncHandler(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function apiError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeHeader(header) {
  return String(header || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function pickField(row, aliases) {
  const normalizedAliases = aliases.map(normalizeHeader);
  const entry = Object.entries(row).find(([key]) =>
    normalizedAliases.includes(normalizeHeader(key))
  );
  return entry ? String(entry[1] ?? "").trim() : "";
}

function parseContactsCsv(buffer) {
  const records = parse(buffer.toString("utf8"), {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true
  });

  const existingEmails = new Set(
    db.prepare("SELECT lower(email) AS email FROM contacts").all().map((row) => row.email)
  );
  const seenEmails = new Set();
  const validContacts = [];
  const invalidRows = [];

  records.forEach((row, index) => {
    const name = pickField(row, ["name", "nome"]);
    const email = normalizeEmail(pickField(row, ["email", "e-mail", "mail"]));
    const company = pickField(row, ["company", "empresa", "companhia"]);
    const errors = [];

    if (!name) errors.push("Nome em falta");
    if (!email) errors.push("Email em falta");
    if (email && !isValidEmail(email)) errors.push("Email inválido");
    if (email && seenEmails.has(email)) errors.push("Email duplicado no CSV");
    if (email && existingEmails.has(email)) errors.push("Email já existe na lista");

    if (errors.length > 0) {
      invalidRows.push({
        row: index + 2,
        name,
        email,
        company,
        errors
      });
      return;
    }

    seenEmails.add(email);
    validContacts.push({ name, email, company });
  });

  return {
    validContacts,
    invalidRows,
    summary: {
      totalRows: records.length,
      valid: validContacts.length,
      invalid: invalidRows.length
    }
  };
}

function getStoredSmtpSettings() {
  return db.prepare("SELECT * FROM smtp_settings WHERE id = 1").get();
}

function createTransport(settings, password) {
  return nodemailer.createTransport({
    host: settings.host,
    port: Number(settings.port),
    secure: Boolean(settings.secure),
    auth: {
      user: settings.from_email,
      pass: password
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000
  });
}

function logSmtp(campaignId, jobId, level, message) {
  db.prepare(`
    INSERT INTO smtp_logs (campaign_id, job_id, level, message)
    VALUES (?, ?, ?, ?)
  `).run(campaignId || null, jobId || null, level, String(message).slice(0, 2000));
}

function refreshCampaignStats(campaignId) {
  const stats = db.prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END), 0) AS sent,
      COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
      COALESCE(SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END), 0) AS queued
    FROM email_jobs
    WHERE campaign_id = ?
  `).get(campaignId);

  db.prepare(`
    UPDATE campaigns
    SET total = ?, sent = ?, failed = ?, queued = ?, updated_at = ?
    WHERE id = ?
  `).run(stats.total, stats.sent, stats.failed, stats.queued, nowIso(), campaignId);

  return stats;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function runCampaign(campaignId) {
  if (activeCampaigns.has(campaignId)) return;

  activeCampaigns.add(campaignId);
  scheduledTimers.delete(campaignId);

  try {
    const campaign = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(campaignId);
    if (!campaign) return;

    const smtp = getStoredSmtpSettings();
    if (!smtp) throw apiError("SMTP não configurado", 400);

    const password = decryptSecret(smtp.password_encrypted);
    const transporter = createTransport(smtp, password);
    const startedAt = nowIso();

    db.prepare(`
      UPDATE campaigns
      SET status = 'running',
          started_at = COALESCE(started_at, ?),
          updated_at = ?
      WHERE id = ?
    `).run(startedAt, startedAt, campaignId);

    const jobs = db.prepare(`
      SELECT *
      FROM email_jobs
      WHERE campaign_id = ? AND status = 'queued'
      ORDER BY id ASC
    `).all(campaignId);

    const intervalMs = Number(campaign.interval_seconds || 5) * 1000;
    const rateMs = Math.ceil(60000 / Number(campaign.max_per_minute || 1));
    const delayMs = Math.max(intervalMs, rateMs);

    for (let index = 0; index < jobs.length; index += 1) {
      const job = jobs[index];
      const rendered = renderTemplate(
        {
          subject: campaign.template_subject,
          body_text: campaign.template_body_text,
          body_html: campaign.template_body_html
        },
        {
          name: job.recipient_name,
          email: job.recipient_email,
          company: job.recipient_company
        }
      );

      try {
        await transporter.sendMail({
          from: smtp.from_email,
          to: job.recipient_email,
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html || undefined
        });

        db.prepare(`
          UPDATE email_jobs
          SET status = 'sent', error = NULL, sent_at = ?, updated_at = ?
          WHERE id = ?
        `).run(nowIso(), nowIso(), job.id);
      } catch (error) {
        db.prepare(`
          UPDATE email_jobs
          SET status = 'failed', error = ?, updated_at = ?
          WHERE id = ?
        `).run(String(error.message || error).slice(0, 2000), nowIso(), job.id);

        logSmtp(campaignId, job.id, "error", error.message || error);
      }

      refreshCampaignStats(campaignId);

      if (index < jobs.length - 1) {
        await sleep(delayMs);
      }
    }

    const stats = refreshCampaignStats(campaignId);
    const finishedAt = nowIso();
    const status = stats.failed > 0 ? "completed_with_errors" : "completed";

    db.prepare(`
      UPDATE campaigns
      SET status = ?, completed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(status, finishedAt, finishedAt, campaignId);
  } catch (error) {
    logSmtp(campaignId, null, "error", error.message || error);
    db.prepare(`
      UPDATE campaigns
      SET status = 'failed', updated_at = ?
      WHERE id = ?
    `).run(nowIso(), campaignId);
  } finally {
    activeCampaigns.delete(campaignId);
  }
}

function scheduleCampaign(campaignId, scheduledAt) {
  if (scheduledTimers.has(campaignId)) {
    clearTimeout(scheduledTimers.get(campaignId));
  }

  const targetTime = scheduledAt ? new Date(scheduledAt).getTime() : Date.now();
  const delay = Math.max(0, targetTime - Date.now());
  const timer = setTimeout(() => {
    runCampaign(campaignId);
  }, delay);

  scheduledTimers.set(campaignId, timer);
}

function resumePendingCampaigns() {
  const pendingCampaigns = db.prepare(`
    SELECT id, scheduled_at
    FROM campaigns
    WHERE status IN ('scheduled', 'queued', 'running')
  `).all();

  pendingCampaigns.forEach((campaign) => {
    scheduleCampaign(campaign.id, campaign.scheduled_at);
  });
}

app.get("/api/health", (request, response) => {
  response.json({ ok: true, db: "sqlite", time: nowIso() });
});

app.get("/api/contacts", (request, response) => {
  const contacts = db.prepare(`
    SELECT *
    FROM contacts
    ORDER BY lower(name) ASC, id ASC
  `).all();

  response.json({ contacts });
});

app.post(
  "/api/contacts/preview",
  upload.single("file"),
  asyncHandler(async (request, response) => {
    if (!request.file) throw apiError("Envie um ficheiro CSV", 400);

    const preview = parseContactsCsv(request.file.buffer);
    response.json(preview);
  })
);

app.post(
  "/api/contacts/import",
  asyncHandler(async (request, response) => {
    const contacts = Array.isArray(request.body.contacts) ? request.body.contacts : [];
    if (contacts.length === 0) throw apiError("Não há contactos válidos para importar", 400);

    const insert = db.prepare(`
      INSERT OR IGNORE INTO contacts (name, email, company)
      VALUES (?, ?, ?)
    `);

    let imported = 0;
    let skipped = 0;

    db.exec("BEGIN IMMEDIATE");
    try {
      contacts.forEach((contact) => {
        const name = String(contact.name || "").trim();
        const email = normalizeEmail(contact.email);
        const company = String(contact.company || "").trim();

        if (!name || !isValidEmail(email)) {
          skipped += 1;
          return;
        }

        const result = insert.run(name, email, company);
        if (result.changes > 0) imported += 1;
        else skipped += 1;
      });

      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    response.json({ imported, skipped });
  })
);

app.delete("/api/contacts", (request, response) => {
  const result = db.prepare("DELETE FROM contacts").run();
  response.json({ deleted: result.changes });
});

app.post(
  "/api/contacts",
  asyncHandler(async (request, response) => {
    const name = String(request.body.name || "").trim();
    const email = normalizeEmail(request.body.email || "");
    const company = String(request.body.company || "").trim();

    if (!name) throw apiError("Nome é obrigatório", 400);
    if (!email) throw apiError("Email é obrigatório", 400);
    if (!isValidEmail(email)) throw apiError("Email inválido", 400);

    const existing = db.prepare("SELECT id FROM contacts WHERE lower(email) = ?").get(email.toLowerCase());
    if (existing) throw apiError("Este email já existe na lista", 400);

    const result = db.prepare(`
      INSERT INTO contacts (name, email, company)
      VALUES (?, ?, ?)
    `).run(name, email, company || null);

    const contact = db.prepare("SELECT * FROM contacts WHERE id = ?").get(result.lastInsertRowid);
    response.status(201).json({ contact });
  })
);


app.get("/api/templates", (request, response) => {
  const templates = db.prepare(`
    SELECT *
    FROM templates
    ORDER BY datetime(updated_at) DESC, id DESC
  `).all();

  response.json({ templates });
});

app.post(
  "/api/templates",
  asyncHandler(async (request, response) => {
    const name = String(request.body.name || "").trim();
    const subject = String(request.body.subject || "").trim();
    const bodyText = String(request.body.body_text || "").trim();
    const bodyHtml = String(request.body.body_html || "").trim();

    if (!name || !subject || !bodyText) {
      throw apiError("Nome, assunto e texto são obrigatórios", 400);
    }

    const result = db.prepare(`
      INSERT INTO templates (name, subject, body_text, body_html)
      VALUES (?, ?, ?, ?)
    `).run(name, subject, bodyText, bodyHtml);

    const template = db.prepare("SELECT * FROM templates WHERE id = ?").get(result.lastInsertRowid);
    response.status(201).json({ template });
  })
);

app.put(
  "/api/templates/:id",
  asyncHandler(async (request, response) => {
    const id = Number(request.params.id);
    const name = String(request.body.name || "").trim();
    const subject = String(request.body.subject || "").trim();
    const bodyText = String(request.body.body_text || "").trim();
    const bodyHtml = String(request.body.body_html || "").trim();

    if (!name || !subject || !bodyText) {
      throw apiError("Nome, assunto e texto são obrigatórios", 400);
    }

    const result = db.prepare(`
      UPDATE templates
      SET name = ?, subject = ?, body_text = ?, body_html = ?, updated_at = ?
      WHERE id = ?
    `).run(name, subject, bodyText, bodyHtml, nowIso(), id);

    if (result.changes === 0) throw apiError("Template não encontrado", 404);

    const template = db.prepare("SELECT * FROM templates WHERE id = ?").get(id);
    response.json({ template });
  })
);

app.delete("/api/templates/:id", (request, response) => {
  const result = db.prepare("DELETE FROM templates WHERE id = ?").run(Number(request.params.id));
  response.json({ deleted: result.changes });
});

app.post("/api/templates/preview", (request, response) => {
  const sampleContact = request.body.contact || {
    name: "João Silva",
    email: "joao@email.com",
    company: "Empresa Demo"
  };

  const rendered = renderTemplate(
    {
      subject: request.body.subject,
      body_text: request.body.body_text,
      body_html: request.body.body_html
    },
    sampleContact
  );

  response.json({ rendered });
});

app.get("/api/smtp-settings", (request, response) => {
  response.json({ settings: publicSmtpSettings(getStoredSmtpSettings()) });
});

app.post(
  "/api/smtp-settings",
  asyncHandler(async (request, response) => {
    const existing = getStoredSmtpSettings();
    const host = String(request.body.host || "").trim();
    const portValue = positiveInteger(request.body.port, 0);
    const fromEmail = normalizeEmail(request.body.from_email || request.body.fromEmail);
    const password = String(request.body.password || "");
    const secure = request.body.secure === true || request.body.secure === 1;
    const maxPerMinute = positiveInteger(request.body.max_per_minute, 30);

    if (!host) throw apiError("SMTP Host é obrigatório", 400);
    if (!portValue) throw apiError("Porta SMTP inválida", 400);
    if (!isValidEmail(fromEmail)) throw apiError("Email remetente inválido", 400);
    if (maxPerMinute > globalMaxPerMinute) {
      throw apiError(`O limite máximo é ${globalMaxPerMinute} emails/min`, 400);
    }

    const passwordEncrypted = password
      ? encryptSecret(password)
      : existing?.password_encrypted;

    if (!passwordEncrypted) throw apiError("Password SMTP é obrigatória", 400);

    if (existing) {
      db.prepare(`
        UPDATE smtp_settings
        SET host = ?, port = ?, from_email = ?, password_encrypted = ?, secure = ?,
            max_per_minute = ?, updated_at = ?
        WHERE id = 1
      `).run(host, portValue, fromEmail, passwordEncrypted, secure ? 1 : 0, maxPerMinute, nowIso());
    } else {
      db.prepare(`
        INSERT INTO smtp_settings
          (id, host, port, from_email, password_encrypted, secure, max_per_minute)
        VALUES (1, ?, ?, ?, ?, ?, ?)
      `).run(host, portValue, fromEmail, passwordEncrypted, secure ? 1 : 0, maxPerMinute);
    }

    response.json({ settings: publicSmtpSettings(getStoredSmtpSettings()) });
  })
);

app.post(
  "/api/smtp-settings/test",
  asyncHandler(async (request, response) => {
    const existing = getStoredSmtpSettings();
    const host = String(request.body.host || existing?.host || "").trim();
    const portValue = positiveInteger(request.body.port || existing?.port, 0);
    const fromEmail = normalizeEmail(request.body.from_email || request.body.fromEmail || existing?.from_email);
    const secure = request.body.secure === undefined ? Boolean(existing?.secure) : Boolean(request.body.secure);
    const password = request.body.password
      ? String(request.body.password)
      : existing
        ? decryptSecret(existing.password_encrypted)
        : "";

    if (!host || !portValue || !isValidEmail(fromEmail) || !password) {
      throw apiError("Preencha SMTP Host, porta, email e password antes de testar", 400);
    }

    const transporter = createTransport(
      { host, port: portValue, from_email: fromEmail, secure },
      password
    );

    await transporter.verify();
    response.json({ ok: true, message: "Ligação SMTP validada" });
  })
);

app.get("/api/campaigns", (request, response) => {
  response.json({ campaigns: listCampaigns() });
});

app.get("/api/campaigns/:id", (request, response) => {
  const campaign = getCampaignWithDetails(Number(request.params.id));
  if (!campaign) {
    response.status(404).json({ error: "Campanha não encontrada" });
    return;
  }

  response.json({ campaign });
});

app.post(
  "/api/campaigns",
  campaignCreateLimiter,
  asyncHandler(async (request, response) => {
    if (request.body.confirm !== true) {
      throw apiError("Confirmação obrigatória antes de enviar", 400);
    }

    const templateId = Number(request.body.templateId || request.body.template_id);
    const intervalSeconds = Math.min(3600, positiveInteger(request.body.intervalSeconds, 5));
    const requestedMaxPerMinute = positiveInteger(request.body.maxPerMinute, 30);
    const scheduledAt = request.body.scheduledAt ? new Date(request.body.scheduledAt) : null;
    const campaignName = String(request.body.name || `Campanha ${new Date().toLocaleString("pt-PT")}`).trim();

    if (requestedMaxPerMinute > globalMaxPerMinute) {
      throw apiError(`O limite máximo global é ${globalMaxPerMinute} emails/min`, 400);
    }

    const template = db.prepare("SELECT * FROM templates WHERE id = ?").get(templateId);
    if (!template) throw apiError("Template não encontrado", 404);

    const smtp = getStoredSmtpSettings();
    if (!smtp) throw apiError("Configure SMTP antes de enviar", 400);
    if (requestedMaxPerMinute > smtp.max_per_minute) {
      throw apiError(`Este SMTP está limitado a ${smtp.max_per_minute} emails/min`, 400);
    }

    const ids = Array.isArray(request.body.contactIds)
      ? request.body.contactIds.map(Number).filter((id) => Number.isInteger(id) && id > 0)
      : [];

    let contacts;
    if (ids.length > 0) {
      const placeholders = ids.map(() => "?").join(",");
      contacts = db.prepare(`
        SELECT *
        FROM contacts
        WHERE id IN (${placeholders})
        ORDER BY id ASC
      `).all(...ids);
    } else {
      contacts = db.prepare("SELECT * FROM contacts ORDER BY id ASC").all();
    }

    if (contacts.length === 0) throw apiError("Importe contactos antes de enviar", 400);

    const status = scheduledAt && scheduledAt.getTime() > Date.now() ? "scheduled" : "queued";
    const scheduledAtIso = status === "scheduled" ? scheduledAt.toISOString() : null;
    let campaignId;

    db.exec("BEGIN IMMEDIATE");
    try {
      const campaignResult = db.prepare(`
        INSERT INTO campaigns (
          name, template_id, template_name, template_subject, template_body_text,
          template_body_html, smtp_from_email, scheduled_at, status, total, queued,
          interval_seconds, max_per_minute
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        campaignName,
        template.id,
        template.name,
        template.subject,
        template.body_text,
        template.body_html,
        smtp.from_email,
        scheduledAtIso,
        status,
        contacts.length,
        contacts.length,
        intervalSeconds,
        requestedMaxPerMinute
      );

      campaignId = Number(campaignResult.lastInsertRowid);

      const insertJob = db.prepare(`
        INSERT OR IGNORE INTO email_jobs (
          campaign_id, contact_id, recipient_name, recipient_email, recipient_company
        )
        VALUES (?, ?, ?, ?, ?)
      `);

      contacts.forEach((contact) => {
        insertJob.run(
          campaignId,
          contact.id,
          contact.name,
          contact.email,
          contact.company
        );
      });

      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    refreshCampaignStats(campaignId);
    scheduleCampaign(campaignId, scheduledAtIso);

    response.status(201).json({ campaign: getCampaignWithDetails(campaignId) });
  })
);

const distDir = path.resolve("dist");
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.use((request, response, next) => {
    if (request.method !== "GET" || request.path.startsWith("/api")) {
      next();
      return;
    }

    response.sendFile(path.join(distDir, "index.html"));
  });
}

app.use((error, request, response, next) => {
  if (error instanceof multer.MulterError) {
    response.status(400).json({ error: error.message });
    return;
  }

  const status = error.status || 500;
  if (status >= 500) {
    console.error(error);
  }

  response.status(status).json({
    error: error.message || "Erro interno"
  });
});

resumePendingCampaigns();

app.listen(port, () => {
  console.log(`Smart Outreach Mailer API ready on http://localhost:${port}`);
});
