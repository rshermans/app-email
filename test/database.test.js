import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("cria o esquema orientado por eventos e o evento legado", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lifeinternet-mail-"));
  const previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tempDir;

  const moduleUrl = new URL("../server/db/database.js", import.meta.url);
  moduleUrl.searchParams.set("test", String(Date.now()));
  const database = await import(moduleUrl.href);

  const tables = database.db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name);
  assert.ok(tables.includes("events"));
  assert.ok(tables.includes("event_contacts"));
  const eventContactColumns = database.db
    .prepare("PRAGMA table_info(event_contacts)")
    .all()
    .map((column) => column.name);
  assert.ok(eventContactColumns.includes("selected_for_email"));

  const events = database.listEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].name, "Dados anteriores");
  assert.equal(events[0].template_count, 1);

  const campaignColumns = database.db
    .prepare("PRAGMA table_info(campaigns)")
    .all()
    .map((column) => column.name);
  assert.ok(campaignColumns.includes("event_id"));
  assert.ok(campaignColumns.includes("template_mode"));

  database.db.close();
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("mantém participantes isolados entre eventos", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lifeinternet-mail-"));
  const previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tempDir;

  const moduleUrl = new URL("../server/db/database.js", import.meta.url);
  moduleUrl.searchParams.set("isolation", String(Date.now()));
  const database = await import(moduleUrl.href);
  const now = database.nowIso();
  const firstEvent = database.db.prepare("INSERT INTO events (name, status) VALUES (?, 'active') RETURNING id").get("Evento A");
  const secondEvent = database.db.prepare("INSERT INTO events (name, status) VALUES (?, 'active') RETURNING id").get("Evento B");
  const contact = database.db.prepare("INSERT INTO contacts (name, email) VALUES (?, ?)").run("Pessoa", "pessoa@example.com");
  const addMembership = database.db.prepare(`
    INSERT INTO event_contacts (event_id, contact_id, selected_for_email, fields_json, created_at, updated_at)
    VALUES (?, ?, 1, '{}', ?, ?)
  `);
  addMembership.run(firstEvent.id, contact.lastInsertRowid, now, now);
  addMembership.run(secondEvent.id, contact.lastInsertRowid, now, now);

  database.db.prepare("DELETE FROM event_contacts WHERE event_id = ?").run(firstEvent.id);
  assert.equal(database.listEventContacts(firstEvent.id).length, 0);
  assert.equal(database.listEventContacts(secondEvent.id).length, 1);
  assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM contacts").get().count, 1);

  database.db.close();
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("permite actualizar o mesmo email no próprio contacto e bloqueia outro contacto", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lifeinternet-mail-"));
  const previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tempDir;

  const moduleUrl = new URL("../server/db/database.js", import.meta.url);
  moduleUrl.searchParams.set("contact-update", String(Date.now()));
  const database = await import(moduleUrl.href);

  const firstContact = database.db.prepare(
    "INSERT INTO contacts (name, email) VALUES (?, ?)"
  ).run("Dicxita Vijendra", "dvijendra@unisced.edu.mz");

  const sameOwner = database.db.prepare(
    "SELECT id FROM contacts WHERE lower(email) = lower(?) AND id <> ?"
  ).get("dvijendra@unisced.edu.mz", firstContact.lastInsertRowid);
  assert.equal(sameOwner, undefined);

  database.db.prepare(
    "UPDATE contacts SET email = ? WHERE id = ?"
  ).run("dvijendra@unisced.edu.mz", firstContact.lastInsertRowid);

  const secondContact = database.db.prepare(
    "INSERT INTO contacts (name, email) VALUES (?, ?)"
  ).run("Outra Pessoa", "outro@exemplo.com");

  const conflictingOwner = database.db.prepare(
    "SELECT id FROM contacts WHERE lower(email) = lower(?) AND id <> ?"
  ).get("dvijendra@unisced.edu.mz", secondContact.lastInsertRowid);
  assert.ok(conflictingOwner);

  database.db.close();
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  fs.rmSync(tempDir, { recursive: true, force: true });
});
