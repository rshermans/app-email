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
