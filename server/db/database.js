import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const dataDir = path.resolve(process.env.DATA_DIR || "./data");
fs.mkdirSync(dataDir, { recursive: true });

export const dbPath = path.join(dataDir, "smart-outreach-mailer.sqlite");
export const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    company TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    subject TEXT NOT NULL,
    body_text TEXT NOT NULL,
    body_html TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS smtp_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    from_email TEXT NOT NULL,
    password_encrypted TEXT NOT NULL,
    secure INTEGER NOT NULL DEFAULT 1,
    max_per_minute INTEGER NOT NULL DEFAULT 30,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    template_id INTEGER,
    template_name TEXT NOT NULL,
    template_subject TEXT NOT NULL,
    template_body_text TEXT NOT NULL,
    template_body_html TEXT,
    smtp_from_email TEXT NOT NULL,
    scheduled_at TEXT,
    started_at TEXT,
    completed_at TEXT,
    status TEXT NOT NULL,
    total INTEGER NOT NULL DEFAULT 0,
    sent INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    queued INTEGER NOT NULL DEFAULT 0,
    interval_seconds INTEGER NOT NULL DEFAULT 5,
    max_per_minute INTEGER NOT NULL DEFAULT 30,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS email_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL,
    contact_id INTEGER,
    recipient_name TEXT NOT NULL,
    recipient_email TEXT NOT NULL,
    recipient_company TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    error TEXT,
    sent_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    UNIQUE (campaign_id, recipient_email)
  );

  CREATE TABLE IF NOT EXISTS smtp_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER,
    job_id INTEGER,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY (job_id) REFERENCES email_jobs(id) ON DELETE SET NULL
  );
`);

const templateCount = db.prepare("SELECT COUNT(*) AS count FROM templates").get().count;

if (templateCount === 0) {
  db.prepare(`
    INSERT INTO templates (name, subject, body_text, body_html)
    VALUES (?, ?, ?, ?)
  `).run(
    "Primeiro contacto",
    "Olá {{name}}, podemos falar?",
    "Olá {{name}},\n\nVi que está associado a {{company}} e gostava de lhe apresentar uma proposta breve.\n\nCumprimentos,",
    "<p>Olá <strong>{{name}}</strong>,</p><p>Vi que está associado a {{company}} e gostava de lhe apresentar uma proposta breve.</p><p>Cumprimentos,</p>"
  );
}

export function asBoolean(value) {
  return value ? 1 : 0;
}

export function nowIso() {
  return new Date().toISOString();
}

export function listCampaigns() {
  return db.prepare(`
    SELECT *
    FROM campaigns
    ORDER BY datetime(created_at) DESC, id DESC
  `).all();
}

export function getCampaignWithDetails(id) {
  const campaign = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(id);
  if (!campaign) return null;

  const jobs = db.prepare(`
    SELECT *
    FROM email_jobs
    WHERE campaign_id = ?
    ORDER BY id ASC
  `).all(id);

  const logs = db.prepare(`
    SELECT *
    FROM smtp_logs
    WHERE campaign_id = ?
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT 100
  `).all(id);

  return { ...campaign, jobs, logs };
}
