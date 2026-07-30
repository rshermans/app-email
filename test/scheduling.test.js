import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_SAFE_TIMEOUT,
  nextScheduleDelay
} from "../server/scheduling.js";

test("campanhas muito distantes são reagendadas sem exceder o limite do Node", () => {
  const now = Date.parse("2026-07-29T00:00:00.000Z");
  const schedule = nextScheduleDelay("2099-01-01T12:00:00.000Z", now);
  assert.equal(schedule.due, false);
  assert.equal(schedule.delay, MAX_SAFE_TIMEOUT);
});

test("campanhas vencidas ficam prontas para execução imediata", () => {
  const now = Date.parse("2026-07-29T00:00:00.000Z");
  const schedule = nextScheduleDelay("2026-07-28T12:00:00.000Z", now);
  assert.equal(schedule.due, true);
  assert.equal(schedule.delay, 0);
});
