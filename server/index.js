import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import multer from "multer";
import nodemailer from "nodemailer";
import fs from "node:fs";
import path from "node:path";
import {
  db,
  getCampaignWithDetails,
  getEvent,
  listCampaigns,
  listEventContacts,
  listEvents,
  nowIso
} from "./db/database.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import {
  availableVariables,
  extractVariables,
  normalizeVariableKey,
  renderTemplate
} from "./render.js";
import {
  isValidEmail,
  normalizeEmail,
  positiveInteger,
  publicSmtpSettings
} from "./validators.js";
import { nextScheduleDelay } from "./scheduling.js";
import { parseCsvRecords } from "./csv.js";

const app = express();
const port = Number(process.env.PORT || 4000);
const globalMaxPerMinute = Number(process.env.GLOBAL_MAX_EMAILS_PER_MINUTE || 60);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 21 }
});

const activeCampaigns = new Set();
const scheduledTimers = new Map();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: "12mb" }));
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

function apiError(message, status = 400, details = null) {
  const error = new Error(message);
  error.status = status;
  error.details = details;
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

function parseJson(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

const reservedFieldKeys = new Set([
  "NOME",
  "NAME",
  "EMAIL",
  "MAIL",
  "EMPRESA",
  "COMPANY",
  "COMPANHIA",
  "GRUPO",
  "ASSINATURA"
]);

function normalizeFields(row) {
  const fields = {};
  Object.entries(row || {}).forEach(([key, value]) => {
    const normalized = normalizeVariableKey(key);
    if (!normalized || reservedFieldKeys.has(normalized)) return;
    fields[normalized] = String(value ?? "").trim();
  });
  return fields;
}

function normalizeContactFields(fields, { name, email, company, groupName }) {
  const nextFields = { ...fields };
  Object.keys(nextFields).forEach((key) => {
    if (reservedFieldKeys.has(normalizeVariableKey(key))) delete nextFields[key];
  });
  if (name) nextFields.NOME = String(name).trim();
  if (email) nextFields.EMAIL = normalizeEmail(email);
  if (company) nextFields.EMPRESA = String(company).trim();
  if (groupName) nextFields.GRUPO = String(groupName).trim();
  return nextFields;
}

function htmlToText(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|div|h1|h2|h3|li|td|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

function templateFromUpload(file) {
  const html = file.buffer.toString("utf8");
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch
    ? htmlToText(titleMatch[1])
    : file.originalname.replace(/\.html?$/i, "").replaceAll("_", " ");
  return {
    name: file.originalname.replace(/\.html?$/i, "").replaceAll("_", " "),
    source_filename: file.originalname,
    subject: title,
    body_text: htmlToText(html),
    body_html: html,
    variables: extractVariables({
      subject: title,
      body_text: "",
      body_html: html
    })
  };
}

function parseEventCsv(buffer, eventId) {
  const records = parseCsvRecords(buffer, {
    relax_column_count: true
  });
  const seenEmails = new Set();
  const existingMemberships = new Set(
    db
      .prepare(`
        SELECT lower(c.email) AS email
        FROM event_contacts ec
        JOIN contacts c ON c.id = ec.contact_id
        WHERE ec.event_id = ?
      `)
      .all(eventId)
      .map((row) => row.email)
  );
  const contacts = [];
  const invalidRows = [];

  records.forEach((row, index) => {
    const fields = normalizeFields(row);
    const name = pickField(row, ["name", "nome"]);
    const email = normalizeEmail(pickField(row, ["email", "e-mail", "mail"]));
    const company = pickField(row, ["company", "empresa", "companhia"]);
    const groupName = pickField(row, ["grupo", "group", "segmento"]);
    const templateKey = pickField(row, [
      "modelo_email",
      "modelo email",
      "template",
      "template_file"
    ]);
    const errors = [];
    const warnings = [];

    if (!name) errors.push("Nome em falta");
    if (!email) errors.push("Email em falta");
    if (email && !isValidEmail(email)) errors.push("Email inválido");
    if (email && seenEmails.has(email)) errors.push("Email duplicado no CSV");
    if (email && existingMemberships.has(email)) {
      warnings.push("Participação existente; os dados serão atualizados");
    }

    const candidate = {
      row: index + 2,
      name,
      email,
      company,
      group_name: groupName,
      template_key: templateKey,
      fields,
      warnings
    };

    if (errors.length > 0) {
      invalidRows.push({ ...candidate, errors });
      return;
    }

    seenEmails.add(email);
    contacts.push(candidate);
  });

  const groups = Object.entries(
    [...contacts, ...invalidRows].reduce((counts, contact) => {
      const key = contact.group_name || "Sem grupo";
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {})
  ).map(([name, count]) => ({ name, count }));

  return {
    contacts,
    invalidRows,
    columns: records[0] ? Object.keys(records[0]) : [],
    groups,
    summary: {
      totalRows: records.length,
      valid: contacts.length,
      invalid: invalidRows.length,
      existing: contacts.filter((contact) => contact.warnings.length > 0).length
    }
  };
}

function parseContactsCsv(buffer) {
  const records = parseCsvRecords(buffer);

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
    family: 4,
    tls: {
      rejectUnauthorized: false
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
      const mergeData = parseJson(job.merge_data_json);
      const rendered = renderTemplate(
        {
          subject: job.template_subject || campaign.template_subject,
          body_text: job.template_body_text || campaign.template_body_text,
          body_html: job.template_body_html || campaign.template_body_html
        },
        {
          name: job.recipient_name,
          email: job.recipient_email,
          company: job.recipient_company
        },
        mergeData
      );

      if (rendered.missingVariables.length > 0) {
        db.prepare(`
          UPDATE email_jobs
          SET status = 'failed', error = ?, updated_at = ?
          WHERE id = ?
        `).run(
          `Campos em falta: ${rendered.missingVariables.join(", ")}`,
          nowIso(),
          job.id
        );
        logSmtp(
          campaignId,
          job.id,
          "error",
          `Envio bloqueado por campos em falta: ${rendered.missingVariables.join(", ")}`
        );
        refreshCampaignStats(campaignId);
        continue;
      }

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

  const { targetTime, delay } = nextScheduleDelay(scheduledAt);
  const timer = setTimeout(() => {
    if (targetTime > Date.now()) {
      scheduleCampaign(campaignId, scheduledAt);
    } else {
      runCampaign(campaignId);
    }
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

app.get("/api/events", (request, response) => {
  response.json({ events: listEvents() });
});

app.post(
  "/api/events",
  asyncHandler(async (request, response) => {
    const name = String(request.body.name || "").trim();
    const description = String(request.body.description || "").trim();
    const eventDate = request.body.event_date
      ? String(request.body.event_date)
      : null;
    const defaultVariables = request.body.default_variables || {};

    if (!name) throw apiError("Dê um nome ao evento", 400);

    const result = db.prepare(`
      INSERT INTO events (
        name, description, event_date, status, default_variables_json
      )
      VALUES (?, ?, ?, 'active', ?)
    `).run(
      name,
      description || null,
      eventDate,
      JSON.stringify(defaultVariables)
    );

    response.status(201).json({ event: getEvent(Number(result.lastInsertRowid)) });
  })
);

app.get("/api/events/:id", (request, response) => {
  const eventId = Number(request.params.id);
  const event = getEvent(eventId);
  if (!event) {
    response.status(404).json({ error: "Evento não encontrado" });
    return;
  }
  const templates = db.prepare(`
    SELECT * FROM templates
    WHERE event_id = ?
    ORDER BY datetime(updated_at) DESC, id DESC
  `).all(eventId);
  response.json({
    event: {
      ...event,
      templates,
      campaigns: listCampaigns(eventId)
    }
  });
});

app.put(
  "/api/events/:id",
  asyncHandler(async (request, response) => {
    const eventId = Number(request.params.id);
    const current = getEvent(eventId);
    if (!current) throw apiError("Evento não encontrado", 404);

    const name = String(request.body.name ?? current.name).trim();
    const description = String(
      request.body.description ?? current.description ?? ""
    ).trim();
    const eventDate =
      request.body.event_date === undefined
        ? current.event_date
        : request.body.event_date || null;
    const defaultVariables =
      request.body.default_variables ?? current.default_variables;

    if (!name) throw apiError("Dê um nome ao evento", 400);

    db.prepare(`
      UPDATE events
      SET name = ?, description = ?, event_date = ?,
        default_variables_json = ?, updated_at = ?
      WHERE id = ?
    `).run(
      name,
      description || null,
      eventDate,
      JSON.stringify(defaultVariables || {}),
      nowIso(),
      eventId
    );

    response.json({ event: getEvent(eventId) });
  })
);

app.post("/api/events/:id/archive", (request, response) => {
  const eventId = Number(request.params.id);
  const result = db.prepare(`
    UPDATE events
    SET status = 'archived', updated_at = ?
    WHERE id = ?
  `).run(nowIso(), eventId);
  if (result.changes === 0) {
    response.status(404).json({ error: "Evento não encontrado" });
    return;
  }
  response.json({ event: getEvent(eventId) });
});

app.post(
  "/api/events/:id/import/preview",
  upload.fields([
    { name: "file", maxCount: 1 },
    { name: "templates", maxCount: 20 }
  ]),
  asyncHandler(async (request, response) => {
    const eventId = Number(request.params.id);
    if (!getEvent(eventId)) throw apiError("Evento não encontrado", 404);

    const csvFile = request.files?.file?.[0];
    if (!csvFile) throw apiError("Escolha um ficheiro CSV", 400);

    const preview = parseEventCsv(csvFile.buffer, eventId);
    const templates = (request.files?.templates || [])
      .filter((file) => /\.html?$/i.test(file.originalname))
      .map(templateFromUpload);
    const templateNames = new Set(
      templates.map((template) => template.source_filename.toLowerCase())
    );

    const addTemplateMatch = (contact) => ({
      ...contact,
      template_matched:
        !contact.template_key ||
        templateNames.has(contact.template_key.toLowerCase()) ||
        Boolean(
          db
            .prepare(`
              SELECT id FROM templates
              WHERE event_id = ? AND lower(source_filename) = lower(?)
            `)
            .get(eventId, contact.template_key)
        )
    });
    preview.contacts = preview.contacts.map(addTemplateMatch);
    preview.invalidRows = preview.invalidRows.map(addTemplateMatch);

    response.json({ ...preview, templates });
  })
);

app.post(
  "/api/events/:id/import",
  asyncHandler(async (request, response) => {
    const eventId = Number(request.params.id);
    if (!getEvent(eventId)) throw apiError("Evento não encontrado", 404);

    const contacts = Array.isArray(request.body.contacts)
      ? request.body.contacts
      : [];
    const templates = Array.isArray(request.body.templates)
      ? request.body.templates
      : [];
    if (contacts.length === 0) {
      throw apiError("Não há destinatários válidos para importar", 400);
    }

    let imported = 0;
    let updated = 0;
    let templateCount = 0;
    const templateMap = new Map();
    let currentContact = null;

    db.exec("BEGIN IMMEDIATE");
    try {
      templates.forEach((template) => {
        const filename = String(template.source_filename || "").trim();
        const name = String(template.name || filename || "Modelo importado").trim();
        const subject = String(template.subject || name).trim();
        const bodyText = String(
          template.body_text || htmlToText(template.body_html)
        ).trim();
        const bodyHtml = String(template.body_html || "").trim();
        if (!filename || !bodyHtml) return;

        const existing = db.prepare(`
          SELECT id FROM templates
          WHERE event_id = ? AND lower(source_filename) = lower(?)
        `).get(eventId, filename);
        let templateId;
        if (existing) {
          db.prepare(`
            UPDATE templates
            SET name = ?, subject = ?, body_text = ?, body_html = ?,
              updated_at = ?
            WHERE id = ?
          `).run(name, subject, bodyText, bodyHtml, nowIso(), existing.id);
          templateId = existing.id;
        } else {
          const result = db.prepare(`
            INSERT INTO templates (
              event_id, source_filename, name, subject, body_text, body_html
            )
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(eventId, filename, name, subject, bodyText, bodyHtml);
          templateId = Number(result.lastInsertRowid);
          templateCount += 1;
        }
        templateMap.set(filename.toLowerCase(), templateId);
      });

      db.prepare(`
        SELECT id, source_filename FROM templates
        WHERE event_id = ? AND source_filename IS NOT NULL
      `).all(eventId).forEach((template) => {
        templateMap.set(template.source_filename.toLowerCase(), template.id);
      });

      const findContact = db.prepare(
        "SELECT id FROM contacts WHERE lower(email) = lower(?)"
      );
      const insertContact = db.prepare(`
        INSERT INTO contacts (name, email, company)
        VALUES (?, ?, ?)
      `);
      const findMembership = db.prepare(`
        SELECT id FROM event_contacts WHERE event_id = ? AND contact_id = ?
      `);
      const insertMembership = db.prepare(`
        INSERT INTO event_contacts (
          event_id, contact_id, name, email, company, group_name, template_key, template_id,
          selected_for_email, fields_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `);
      const updateMembership = db.prepare(`
        UPDATE event_contacts
        SET name = ?, email = ?, company = ?, group_name = ?, template_key = ?, template_id = ?,
          selected_for_email = 1, fields_json = ?, updated_at = ?
        WHERE id = ?
      `);

      contacts.forEach((contact) => {
        currentContact = contact;
        const name = String(contact.name || "").trim();
        const email = normalizeEmail(contact.email);
        const company = String(contact.company || "").trim();
        if (!name || !isValidEmail(email)) return;

        let contactRow = findContact.get(email);
        if (!contactRow) {
          const result = insertContact.run(name, email, company || null);
          contactRow = { id: Number(result.lastInsertRowid) };
        }

        const templateKey = String(contact.template_key || "").trim();
        const templateId = templateKey
          ? templateMap.get(templateKey.toLowerCase()) || null
          : null;
        const fields = normalizeFields(contact.fields || {});
        const groupName = String(contact.group_name || "").trim();
        const membership = findMembership.get(eventId, contactRow.id);

        if (membership) {
          updateMembership.run(
            name,
            email,
            company || null,
            groupName || null,
            templateKey || null,
            templateId,
            JSON.stringify(fields),
            nowIso(),
            membership.id
          );
          updated += 1;
        } else {
          insertMembership.run(
            eventId,
            contactRow.id,
            name,
            email,
            company || null,
            groupName || null,
            templateKey || null,
            templateId,
            JSON.stringify(fields)
          );
          imported += 1;
        }
      });

      db.prepare("UPDATE events SET updated_at = ? WHERE id = ?").run(
        nowIso(),
        eventId
      );
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // The transaction may already have been closed by SQLite.
      }

      const contactLabel = currentContact
        ? ` para ${String(currentContact.name || currentContact.email || "um contacto")}`
        : "";
      throw apiError(
        `Não foi possível concluir a importação${contactLabel}: ${error.message || error}`,
        400
      );
    }

    response.json({
      imported,
      updated,
      templatesImported: templateCount
    });
  })
);

app.put(
  "/api/events/:id/contacts/:eventContactId/template",
  asyncHandler(async (request, response) => {
    const eventId = Number(request.params.id);
    const eventContactId = Number(request.params.eventContactId);
    const templateId = request.body.templateId
      ? Number(request.body.templateId)
      : null;
    if (templateId) {
      const template = db.prepare(`
        SELECT id FROM templates WHERE id = ? AND event_id = ?
      `).get(templateId, eventId);
      if (!template) throw apiError("Modelo não pertence a este evento", 400);
    }
    const result = db.prepare(`
      UPDATE event_contacts
      SET template_key = NULL, template_id = ?, updated_at = ?
      WHERE id = ? AND event_id = ?
    `).run(templateId, nowIso(), eventContactId, eventId);
    if (result.changes === 0) throw apiError("Destinatário não encontrado", 404);
    response.json({ contacts: listEventContacts(eventId) });
  })
);

app.post(
  "/api/events/:id/contacts/bulk",
  asyncHandler(async (request, response) => {
    const eventId = Number(request.params.id);
    const action = String(request.body.action || "");
    const event = getEvent(eventId);
    if (!event) throw apiError("Evento não encontrado", 404);

    if (action === "clear_all") {
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("DELETE FROM event_contacts WHERE event_id = ?").run(eventId);
        db.prepare("UPDATE events SET updated_at = ? WHERE id = ?").run(nowIso(), eventId);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      response.json({ event: getEvent(eventId) });
      return;
    }

    const eventContactIds = Array.isArray(request.body.eventContactIds)
      ? [...new Set(request.body.eventContactIds.map(Number).filter(Number.isInteger))]
      : [];
    if (eventContactIds.length === 0) throw apiError("Selecione pelo menos um participante", 400);

    const placeholders = eventContactIds.map(() => "?").join(", ");
    const memberships = db.prepare(`
      SELECT id FROM event_contacts
      WHERE event_id = ? AND id IN (${placeholders})
    `).all(eventId, ...eventContactIds);
    if (memberships.length !== eventContactIds.length) {
      throw apiError("Um ou mais participantes não pertencem a este evento", 400);
    }

    let result;
    db.exec("BEGIN IMMEDIATE");
    try {
      if (action === "delete") {
        result = db.prepare(`DELETE FROM event_contacts WHERE event_id = ? AND id IN (${placeholders})`)
          .run(eventId, ...eventContactIds);
      } else if (action === "set_selected") {
        const selected = request.body.selected ? 1 : 0;
        result = db.prepare(`UPDATE event_contacts SET selected_for_email = ?, updated_at = ? WHERE event_id = ? AND id IN (${placeholders})`)
          .run(selected, nowIso(), eventId, ...eventContactIds);
      } else if (action === "assign_template") {
        const templateId = request.body.templateId ? Number(request.body.templateId) : null;
        if (!templateId) throw apiError("Escolha um modelo", 400);
        const template = db.prepare("SELECT id FROM templates WHERE id = ? AND event_id = ?").get(templateId, eventId);
        if (!template) throw apiError("Modelo não pertence a este evento", 400);
        result = db.prepare(`UPDATE event_contacts SET template_key = NULL, template_id = ?, updated_at = ? WHERE event_id = ? AND id IN (${placeholders})`)
          .run(templateId, nowIso(), eventId, ...eventContactIds);
      } else {
        throw apiError("Ação em massa inválida", 400);
      }
      db.prepare("UPDATE events SET updated_at = ? WHERE id = ?").run(nowIso(), eventId);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    response.json({ affected: result.changes, event: getEvent(eventId) });
  })
);

app.post(
  "/api/events/:id/contacts",
  asyncHandler(async (request, response) => {
    const eventId = Number(request.params.id);
    if (!getEvent(eventId)) throw apiError("Evento não encontrado", 404);

    const name = String(request.body.name || "").trim();
    const email = normalizeEmail(request.body.email || "");
    const company = String(request.body.company || "").trim();
    const groupName = String(request.body.group_name || request.body.groupName || "").trim();
    const templateId = request.body.templateId || request.body.template_id
      ? Number(request.body.templateId || request.body.template_id)
      : null;
    const selectedForEmail = request.body.selected_for_email === false ? 0 : 1;
    const fields = normalizeContactFields(normalizeFields(request.body.fields || {}), {
      name,
      email,
      company,
      groupName
    });

    if (!name) throw apiError("Nome é obrigatório", 400);
    if (!email) throw apiError("Email é obrigatório", 400);
    if (!isValidEmail(email)) throw apiError("Email inválido", 400);
    if (templateId) {
      const template = db.prepare(`
        SELECT id FROM templates WHERE id = ? AND event_id = ?
      `).get(templateId, eventId);
      if (!template) throw apiError("Modelo não pertence a este evento", 400);
    }

    let eventContactId;
    db.exec("BEGIN IMMEDIATE");
    try {
      // Validar email único POR EVENTO (não globalmente)
      const emailOwner = db.prepare(`
        SELECT id FROM event_contacts WHERE lower(email) = lower(?) AND event_id = ?
      `).get(email, eventId);
      if (emailOwner) throw apiError("Este email já está usado neste evento", 400);

      // Procurar ou criar contacto em contacts (tabela de identidade global)
      const existingContact = db
        .prepare("SELECT id FROM contacts WHERE lower(email) = lower(?)")
        .get(email);
      let contactId = existingContact?.id;
      if (!contactId) {
        const result = db.prepare(`
          INSERT INTO contacts (name, email, company)
          VALUES (?, ?, ?)
        `).run(name, email, company || null);
        contactId = Number(result.lastInsertRowid);
      }

      const membership = db.prepare(`
        SELECT id FROM event_contacts WHERE event_id = ? AND contact_id = ?
      `).get(eventId, contactId);

      if (membership) {
        // Atualizar com dados isolados por evento
        db.prepare(`
          UPDATE event_contacts
          SET name = ?, email = ?, company = ?, group_name = ?, template_key = NULL, template_id = ?, 
              selected_for_email = ?, fields_json = ?, updated_at = ?
          WHERE id = ?
        `).run(
          name,
          email,
          company || null,
          groupName || null,
          templateId,
          selectedForEmail,
          JSON.stringify(fields),
          nowIso(),
          membership.id
        );
        eventContactId = membership.id;
      } else {
        // Criar novo event_contacts com dados isolados
        const result = db.prepare(`
          INSERT INTO event_contacts (
            event_id, contact_id, name, email, company, group_name, template_id,
            selected_for_email, fields_json
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          eventId,
          contactId,
          name,
          email,
          company || null,
          groupName || null,
          templateId,
          selectedForEmail,
          JSON.stringify(fields)
        );
        eventContactId = Number(result.lastInsertRowid);
      }

      db.prepare("UPDATE events SET updated_at = ? WHERE id = ?").run(nowIso(), eventId);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    response.status(201).json({
      contact: listEventContacts(eventId).find(
        (contact) => contact.event_contact_id === eventContactId
      ),
      contacts: listEventContacts(eventId)
    });
  })
);

app.put(
  "/api/events/:id/contacts/:eventContactId",
  asyncHandler(async (request, response) => {
    const eventId = Number(request.params.id);
    const eventContactId = Number(request.params.eventContactId);
    const membership = db.prepare(`
      SELECT ec.* FROM event_contacts ec
      WHERE ec.id = ? AND ec.event_id = ?
    `).get(eventContactId, eventId);
    if (!membership) throw apiError("Destinatário não encontrado", 404);

    const name = String(request.body.name || "").trim();
    const email = normalizeEmail(request.body.email || "");
    const company = String(request.body.company || "").trim();
    const groupName = String(request.body.group_name || request.body.groupName || "").trim();
    const templateId = request.body.templateId || request.body.template_id
      ? Number(request.body.templateId || request.body.template_id)
      : null;
    const selectedForEmail = request.body.selected_for_email === false ? 0 : 1;
    const fields = normalizeContactFields(normalizeFields(request.body.fields || {}), {
      name,
      email,
      company,
      groupName
    });

    if (!name) throw apiError("Nome é obrigatório", 400);
    if (!email) throw apiError("Email é obrigatório", 400);
    if (!isValidEmail(email)) throw apiError("Email inválido", 400);
    if (templateId) {
      const template = db.prepare(`
        SELECT id FROM templates WHERE id = ? AND event_id = ?
      `).get(templateId, eventId);
      if (!template) throw apiError("Modelo não pertence a este evento", 400);
    }

    // Validar email único POR EVENTO (não globalmente)
    const emailOwner = db.prepare(`
      SELECT id FROM event_contacts WHERE lower(email) = lower(?) AND event_id = ? AND id <> ?
    `).get(email, eventId, eventContactId);
    if (emailOwner) throw apiError("Este email já está usado neste evento", 400);

    db.exec("BEGIN IMMEDIATE");
    try {
      // Atualizar dados isolados em event_contacts (não em contacts)
      db.prepare(`
        UPDATE event_contacts
        SET name = ?, email = ?, company = ?, group_name = ?, template_key = NULL, template_id = ?, 
            selected_for_email = ?, fields_json = ?, updated_at = ?
        WHERE id = ? AND event_id = ?
      `).run(
        name,
        email,
        company || null,
        groupName || null,
        templateId,
        selectedForEmail,
        JSON.stringify(fields),
        nowIso(),
        eventContactId,
        eventId
      );

      db.prepare("UPDATE events SET updated_at = ? WHERE id = ?").run(nowIso(), eventId);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    response.json({
      contact: listEventContacts(eventId).find(
        (contact) => contact.event_contact_id === eventContactId
      ),
      contacts: listEventContacts(eventId)
    });
  })
);

app.delete(
  "/api/events/:id/contacts/:eventContactId",
  asyncHandler(async (request, response) => {
    const eventId = Number(request.params.id);
    const eventContactId = Number(request.params.eventContactId);
    const result = db.prepare(`
      DELETE FROM event_contacts
      WHERE id = ? AND event_id = ?
    `).run(eventContactId, eventId);
    if (result.changes === 0) throw apiError("Destinatário não encontrado", 404);
    db.prepare("UPDATE events SET updated_at = ? WHERE id = ?").run(nowIso(), eventId);
    response.json({ deleted: result.changes, contacts: listEventContacts(eventId) });
  })
);

app.get("/api/contacts", (request, response) => {
  const eventId = Number(request.query.eventId || 0);
  if (eventId) {
    response.json({ contacts: listEventContacts(eventId) });
    return;
  }
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
  const eventId = Number(request.query.eventId || 0);
  const templates = eventId
    ? db.prepare(`
        SELECT * FROM templates
        WHERE event_id = ?
        ORDER BY datetime(updated_at) DESC, id DESC
      `).all(eventId)
    : db.prepare(`
        SELECT * FROM templates
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
    const eventId = Number(request.body.event_id || request.body.eventId || 0) || null;
    const sourceFilename = String(request.body.source_filename || "").trim() || null;

    if (!name || !subject || !bodyText) {
      throw apiError("Nome, assunto e texto são obrigatórios", 400);
    }
    if (eventId && !getEvent(eventId)) throw apiError("Evento não encontrado", 404);

    const result = db.prepare(`
      INSERT INTO templates (
        event_id, source_filename, name, subject, body_text, body_html
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(eventId, sourceFilename, name, subject, bodyText, bodyHtml);

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
    const eventId = Number(request.body.event_id || request.body.eventId || 0) || null;

    if (!name || !subject || !bodyText) {
      throw apiError("Nome, assunto e texto são obrigatórios", 400);
    }

    const result = db.prepare(`
      UPDATE templates
      SET event_id = COALESCE(?, event_id), name = ?, subject = ?,
        body_text = ?, body_html = ?, updated_at = ?
      WHERE id = ?
    `).run(eventId, name, subject, bodyText, bodyHtml, nowIso(), id);

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
  const eventId = Number(request.body.eventId || request.body.event_id || 0);
  const eventContactId = Number(request.body.eventContactId || 0);
  const event = eventId ? getEvent(eventId) : null;
  const eventContact = eventContactId
    ? event?.contacts.find(
        (contact) => contact.event_contact_id === eventContactId
      )
    : null;
  const sampleContact = eventContact || request.body.contact || {
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
    sampleContact,
    eventContact?.fields || request.body.fields || {},
    {
      ...(event?.default_variables || {}),
      ...(request.body.globals || {})
    }
  );

  const fieldKeys = event?.contacts.flatMap((contact) =>
    Object.keys(contact.fields || {})
  ) || [];
  response.json({
    rendered,
    variables: availableVariables(fieldKeys)
  });
});

app.post(
  "/api/events/:id/templates/import",
  upload.array("templates", 20),
  asyncHandler(async (request, response) => {
    const eventId = Number(request.params.id);
    if (!getEvent(eventId)) throw apiError("Evento não encontrado", 404);
    const files = (request.files || []).filter((file) =>
      /\.html?$/i.test(file.originalname)
    );
    if (files.length === 0) throw apiError("Escolha pelo menos um ficheiro HTML", 400);

    const templates = files.map(templateFromUpload).map((template) => {
      const existing = db.prepare(`
        SELECT id FROM templates
        WHERE event_id = ? AND lower(source_filename) = lower(?)
      `).get(eventId, template.source_filename);
      if (existing) {
        db.prepare(`
          UPDATE templates
          SET name = ?, subject = ?, body_text = ?, body_html = ?, updated_at = ?
          WHERE id = ?
        `).run(
          template.name,
          template.subject,
          template.body_text,
          template.body_html,
          nowIso(),
          existing.id
        );
        return db.prepare("SELECT * FROM templates WHERE id = ?").get(existing.id);
      }
      const result = db.prepare(`
        INSERT INTO templates (
          event_id, source_filename, name, subject, body_text, body_html
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        eventId,
        template.source_filename,
        template.name,
        template.subject,
        template.body_text,
        template.body_html
      );
      return db.prepare("SELECT * FROM templates WHERE id = ?").get(result.lastInsertRowid);
    });

    response.status(201).json({ templates });
  })
);

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
  const eventId = Number(request.query.eventId || 0);
  response.json({ campaigns: listCampaigns(eventId || null) });
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

    const eventId = Number(request.body.eventId || request.body.event_id || 0) || null;
    const templateId = Number(request.body.templateId || request.body.template_id || 0) || null;
    const templateMode =
      request.body.templateMode === "assigned" ? "assigned" : "single";
    const intervalSeconds = Math.min(3600, positiveInteger(request.body.intervalSeconds, 5));
    const requestedMaxPerMinute = positiveInteger(request.body.maxPerMinute, 30);
    const scheduledAt = request.body.scheduledAt ? new Date(request.body.scheduledAt) : null;
    const campaignName = String(request.body.name || `Campanha ${new Date().toLocaleString("pt-PT")}`).trim();
    if (scheduledAt && Number.isNaN(scheduledAt.getTime())) {
      throw apiError("A data de agendamento não é válida", 400);
    }

    if (requestedMaxPerMinute > globalMaxPerMinute) {
      throw apiError(`O limite máximo global é ${globalMaxPerMinute} emails/min`, 400);
    }

    const smtp = getStoredSmtpSettings();
    if (!smtp) throw apiError("Configure SMTP antes de enviar", 400);
    if (requestedMaxPerMinute > smtp.max_per_minute) {
      throw apiError(`Este SMTP está limitado a ${smtp.max_per_minute} emails/min`, 400);
    }

    const ids = Array.isArray(request.body.contactIds)
      ? request.body.contactIds.map(Number).filter((id) => Number.isInteger(id) && id > 0)
      : [];
    const groups = Array.isArray(request.body.groups)
      ? request.body.groups.map((group) => String(group))
      : [];
    const requestedGlobals = normalizeFields(request.body.globals || {});
    if (request.body.signature) {
      requestedGlobals.ASSINATURA = String(request.body.signature).trim();
    }

    let event = null;
    let contacts = [];
    let globals = requestedGlobals;
    if (eventId) {
      event = getEvent(eventId);
      if (!event) throw apiError("Evento não encontrado", 404);
      globals = {
        ...normalizeFields(event.default_variables || {}),
        ...requestedGlobals
      };
      contacts = event.contacts.filter((contact) => {
        const idMatch = ids.length === 0 || ids.includes(contact.id);
        const groupMatch =
          groups.length === 0 || groups.includes(contact.group_name || "Sem grupo");
        return contact.selected_for_email && idMatch && groupMatch;
      });
    } else {
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
    }

    if (contacts.length === 0) {
      throw apiError("Selecione pelo menos um destinatário para esta campanha", 400);
    }

    const templates = new Map(
      db.prepare("SELECT * FROM templates").all().map((template) => [
        template.id,
        template
      ])
    );
    const singleTemplate = templateId ? templates.get(templateId) : null;
    if (templateMode === "single" && !singleTemplate) {
      throw apiError("Escolha um modelo para a campanha", 400);
    }

    const candidates = contacts.map((contact) => {
      const selectedTemplate =
        templateMode === "assigned"
          ? templates.get(Number(contact.template_id))
          : singleTemplate;
      const mergeFields = {
        ...(contact.fields || {}),
        ...globals,
        GRUPO: contact.group_name || contact.fields?.GRUPO || ""
      };
      const rendered = selectedTemplate
        ? renderTemplate(selectedTemplate, contact, mergeFields)
        : null;
      return {
        contact,
        template: selectedTemplate,
        mergeFields,
        missing: selectedTemplate
          ? rendered.missingVariables
          : ["MODELO_EMAIL"]
      };
    });

    const invalidCandidates = candidates
      .filter((candidate) => !candidate.template || candidate.missing.length > 0)
      .map((candidate) => ({
        name: candidate.contact.name,
        email: candidate.contact.email,
        template: candidate.template?.name || candidate.contact.template_key || "Sem modelo",
        missing: candidate.missing
      }));
    if (invalidCandidates.length > 0) {
      throw apiError(
        `O envio foi bloqueado: ${invalidCandidates.length} destinatário(s) têm campos ou modelos em falta`,
        400,
        { invalidRecipients: invalidCandidates.slice(0, 100) }
      );
    }

    const status = scheduledAt && scheduledAt.getTime() > Date.now() ? "scheduled" : "queued";
    const scheduledAtIso = status === "scheduled" ? scheduledAt.toISOString() : null;
    const representativeTemplate = candidates[0].template;
    const campaignTemplateName =
      templateMode === "assigned" ? "Vários modelos atribuídos" : representativeTemplate.name;
    let campaignId;

    db.exec("BEGIN IMMEDIATE");
    try {
      const campaignResult = db.prepare(`
        INSERT INTO campaigns (
          name, template_id, template_name, template_subject, template_body_text,
          template_body_html, smtp_from_email, scheduled_at, status, total, queued,
          interval_seconds, max_per_minute, event_id, template_mode,
          global_variables_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        campaignName,
        templateMode === "single" ? representativeTemplate.id : null,
        campaignTemplateName,
        representativeTemplate.subject,
        representativeTemplate.body_text,
        representativeTemplate.body_html,
        smtp.from_email,
        scheduledAtIso,
        status,
        candidates.length,
        candidates.length,
        intervalSeconds,
        requestedMaxPerMinute,
        eventId,
        templateMode,
        JSON.stringify(globals)
      );

      campaignId = Number(campaignResult.lastInsertRowid);

      const insertJob = db.prepare(`
        INSERT OR IGNORE INTO email_jobs (
          campaign_id, contact_id, recipient_name, recipient_email,
          recipient_company, template_id, template_name, template_subject,
          template_body_text, template_body_html, merge_data_json, group_name
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      candidates.forEach(({ contact, template, mergeFields }) => {
        insertJob.run(
          campaignId,
          contact.id,
          contact.name,
          contact.email,
          contact.company,
          template.id,
          template.name,
          template.subject,
          template.body_text,
          template.body_html,
          JSON.stringify(mergeFields),
          contact.group_name || null
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
    error: error.message || "Erro interno",
    ...(error.details ? { details: error.details } : {})
  });
});

resumePendingCampaigns();

app.listen(port, () => {
  console.log(`LifeInternet Mail Studio API ready on http://localhost:${port}`);
});
