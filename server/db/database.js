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

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    event_date TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    default_variables_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS event_contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    contact_id INTEGER NOT NULL,
    group_name TEXT,
    template_key TEXT,
    template_id INTEGER,
    selected_for_email INTEGER NOT NULL DEFAULT 1,
    fields_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
    FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE SET NULL,
    UNIQUE (event_id, contact_id)
  );

  CREATE INDEX IF NOT EXISTS event_contacts_event_idx
    ON event_contacts (event_id, group_name);
  CREATE INDEX IF NOT EXISTS event_contacts_template_idx
    ON event_contacts (event_id, template_id);
`);

function columnExists(table, column) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => row.name === column);
}

function addColumn(table, definition) {
  const [column] = definition.trim().split(/\s+/, 1);
  if (!columnExists(table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}

addColumn("templates", "event_id INTEGER");
addColumn("templates", "source_filename TEXT");
addColumn("campaigns", "event_id INTEGER");
addColumn("campaigns", "template_mode TEXT NOT NULL DEFAULT 'single'");
addColumn("campaigns", "global_variables_json TEXT NOT NULL DEFAULT '{}'");
addColumn("email_jobs", "template_id INTEGER");
addColumn("email_jobs", "template_name TEXT");
addColumn("email_jobs", "template_subject TEXT");
addColumn("email_jobs", "template_body_text TEXT");
addColumn("email_jobs", "template_body_html TEXT");
addColumn("email_jobs", "merge_data_json TEXT NOT NULL DEFAULT '{}'");
addColumn("email_jobs", "group_name TEXT");
addColumn("event_contacts", "selected_for_email INTEGER NOT NULL DEFAULT 1");
addColumn("event_contacts", "email TEXT COLLATE NOCASE");
addColumn("event_contacts", "name TEXT");
addColumn("event_contacts", "company TEXT");

// Migração: copiar dados de contacts para event_contacts (isolamento por evento)
function migrateContactsData() {
  // Verificar se os dados já foram migrados (se email já existe em event_contacts)
  const hasMigratedData = db
    .prepare("SELECT COUNT(*) AS count FROM event_contacts WHERE email IS NOT NULL")
    .get().count > 0;
  
  if (!hasMigratedData) {
    console.log("[DB] Migrando dados de contactos para isolamento por evento...");
    db.exec("BEGIN IMMEDIATE");
    try {
      // Copiar dados de contacts para event_contacts
      db.exec(`
        UPDATE event_contacts
        SET 
          email = (SELECT lower(c.email) FROM contacts c WHERE c.id = event_contacts.contact_id),
          name = (SELECT c.name FROM contacts c WHERE c.id = event_contacts.contact_id),
          company = (SELECT c.company FROM contacts c WHERE c.id = event_contacts.contact_id)
        WHERE email IS NULL
      `);
      
      // Criar índice UNIQUE para email por evento (se não existir)
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS event_contacts_event_email_idx
          ON event_contacts(event_id, email)
      `);
      
      db.exec("COMMIT");
      console.log("[DB] ✓ Migração concluída com sucesso");
    } catch (error) {
      db.exec("ROLLBACK");
      console.error("[DB] ✗ Erro na migração:", error.message);
      throw error;
    }
  } else {
    console.log("[DB] Dados já foram migrados, criando índice se não existir...");
    try {
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS event_contacts_event_email_idx
          ON event_contacts(event_id, email)
      `);
    } catch {
      // Índice já pode existir, ignorar
    }
  }
}

migrateContactsData();

const templateCount = db.prepare("SELECT COUNT(*) AS count FROM templates").get().count;

if (templateCount === 0) {
  db.prepare(`
    INSERT INTO templates (name, subject, body_text, body_html)
    VALUES (?, ?, ?, ?)
  `).run(
    "Inquérito final – Escrita Académica com IA",
    "Lembrete: submissão do inquérito final do curso de Escrita Académica com IA",
    "Caro(a) {{name}},\n\nEscrevo-lhe individualmente porque o seu caso merece uma nota, e não um lembrete automático.\n\nA classificação do curso depende da submissão do inquérito final. O inquérito documenta o percurso; não o julga pela sua completude.\n\nCom estima,\n{{ASSINATURA}} — Equipa de formação, PhD4Moz",
    "<p>Caro(a) <strong>{{name}}</strong>,</p><p>Escrevo-lhe individualmente porque o seu caso merece uma nota, e não um lembrete automático.</p><p>A classificação do curso depende da submissão do inquérito final. O inquérito documenta o percurso; não o julga pela sua completude.</p><p>Com estima,<br><strong>{{ASSINATURA}}</strong> — Equipa de formação, PhD4Moz</p>"
  );
}

let legacyEvent = db
  .prepare("SELECT * FROM events ORDER BY id ASC LIMIT 1")
  .get();

if (!legacyEvent) {
  const result = db.prepare(`
    INSERT INTO events (name, description, status, default_variables_json)
    VALUES (?, ?, 'active', '{}')
  `).run(
    "Dados anteriores",
    "Contactos, modelos e campanhas existentes antes da organização por eventos."
  );
  legacyEvent = db.prepare("SELECT * FROM events WHERE id = ?").get(result.lastInsertRowid);
}

db.prepare("UPDATE templates SET event_id = ? WHERE event_id IS NULL").run(legacyEvent.id);
db.prepare("UPDATE campaigns SET event_id = ? WHERE event_id IS NULL").run(legacyEvent.id);
db.prepare(`
  INSERT OR IGNORE INTO event_contacts (event_id, contact_id, fields_json)
  SELECT ?, id, '{}' FROM contacts
`).run(legacyEvent.id);

db.prepare(`
  UPDATE email_jobs
  SET
    template_id = COALESCE(template_id, (
      SELECT c.template_id FROM campaigns c WHERE c.id = email_jobs.campaign_id
    )),
    template_name = COALESCE(template_name, (
      SELECT c.template_name FROM campaigns c WHERE c.id = email_jobs.campaign_id
    )),
    template_subject = COALESCE(template_subject, (
      SELECT c.template_subject FROM campaigns c WHERE c.id = email_jobs.campaign_id
    )),
    template_body_text = COALESCE(template_body_text, (
      SELECT c.template_body_text FROM campaigns c WHERE c.id = email_jobs.campaign_id
    )),
    template_body_html = COALESCE(template_body_html, (
      SELECT c.template_body_html FROM campaigns c WHERE c.id = email_jobs.campaign_id
    ))
  WHERE template_subject IS NULL
`).run();

function parseJson(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

export function nowIso() {
  return new Date().toISOString();
}

export function listEvents() {
  return db.prepare(`
    SELECT
      e.*,
      (SELECT COUNT(*) FROM event_contacts ec WHERE ec.event_id = e.id) AS contact_count,
      (SELECT COUNT(*) FROM templates t WHERE t.event_id = e.id) AS template_count,
      (SELECT COUNT(*) FROM campaigns c WHERE c.event_id = e.id) AS campaign_count,
      (SELECT COUNT(DISTINCT COALESCE(ec.group_name, ''))
        FROM event_contacts ec WHERE ec.event_id = e.id) AS group_count
    FROM events e
    ORDER BY CASE e.status WHEN 'active' THEN 0 ELSE 1 END,
      datetime(e.updated_at) DESC, e.id DESC
  `).all().map((event) => ({
    ...event,
    default_variables: parseJson(event.default_variables_json)
  }));
}

export function getEvent(id) {
  const event = db.prepare("SELECT * FROM events WHERE id = ?").get(id);
  if (!event) return null;
  const contacts = listEventContacts(id);
  const groups = db.prepare(`
    SELECT COALESCE(group_name, 'Sem grupo') AS name, COUNT(*) AS count
    FROM event_contacts
    WHERE event_id = ?
    GROUP BY COALESCE(group_name, 'Sem grupo')
    ORDER BY count DESC, name ASC
  `).all(id);
  return {
    ...event,
    default_variables: parseJson(event.default_variables_json),
    contacts,
    groups
  };
}

export function listEventContacts(eventId) {
  return db.prepare(`
    SELECT
      ec.id AS event_contact_id,
      ec.event_id,
      ec.name,
      ec.email,
      ec.company,
      ec.group_name,
      ec.template_key,
      ec.template_id,
      ec.selected_for_email,
      ec.fields_json,
      ec.updated_at,
      c.id,
      t.name AS assigned_template_name
    FROM event_contacts ec
    LEFT JOIN contacts c ON c.id = ec.contact_id
    LEFT JOIN templates t ON t.id = ec.template_id
    WHERE ec.event_id = ?
    ORDER BY lower(ec.name), ec.id
  `).all(eventId).map((contact) => ({
    ...contact,
    selected_for_email: Boolean(contact.selected_for_email),
    fields: parseJson(contact.fields_json)
  }));
}

export function listCampaigns(eventId = null) {
  if (eventId) {
    return db.prepare(`
      SELECT * FROM campaigns
      WHERE event_id = ?
      ORDER BY datetime(created_at) DESC, id DESC
    `).all(eventId);
  }
  return db.prepare(`
    SELECT * FROM campaigns
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
  `).all(id).map((job) => ({
    ...job,
    merge_data: parseJson(job.merge_data_json)
  }));

  const logs = db.prepare(`
    SELECT *
    FROM smtp_logs
    WHERE campaign_id = ?
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT 100
  `).all(id);

  return {
    ...campaign,
    global_variables: parseJson(campaign.global_variables_json),
    jobs,
    logs
  };
}
