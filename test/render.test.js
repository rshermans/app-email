import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMergeData,
  extractVariables,
  normalizeVariableKey,
  renderTemplate
} from "../server/render.js";

test("normaliza cabeçalhos portugueses e mantém aliases legados", () => {
  assert.equal(normalizeVariableKey("Menção final"), "MENCAO_FINAL");
  const data = buildMergeData(
    { name: "Ana", email: "ana@example.org", company: "INS" },
    { TOTAL: "99,5" },
    { ASSINATURA: "Coordenação" }
  );
  assert.equal(data.NOME, "Ana");
  assert.equal(data.NAME, "Ana");
  assert.equal(data.TOTAL, "99,5");
  assert.equal(data.ASSINATURA, "Coordenação");
});

test("renderiza campos arbitrários e escapa valores no HTML", () => {
  const rendered = renderTemplate(
    {
      subject: "Resultado de {{NOME}}",
      body_text: "{{NOME}} — {{TOTAL}} — {{MENCAO}}",
      body_html: "<p>{{NOME}}: <strong>{{FEEDBACK}}</strong></p>"
    },
    { name: "Alice & Bob", email: "alice@example.org" },
    {
      TOTAL: "100,0",
      MENCAO: "Excelente",
      FEEDBACK: "<script>alert(1)</script>"
    }
  );

  assert.equal(rendered.subject, "Resultado de Alice & Bob");
  assert.equal(rendered.text, "Alice & Bob — 100,0 — Excelente");
  assert.match(rendered.html, /Alice &amp; Bob/);
  assert.doesNotMatch(rendered.html, /<script>/);
  assert.deepEqual(rendered.missingVariables, []);
});

test("ignora campos reservados no JSON para não sobrescrever o email principal do contacto", () => {
  const rendered = renderTemplate(
    {
      subject: "{{EMAIL}}",
      body_text: "{{EMAIL}}",
      body_html: "<p>{{EMAIL}}</p>"
    },
    { name: "Filipe Francisco Gerente Gustavo", email: "fgustavo@unisced.edu.mz" },
    { EMAIL: "fgustavo@unisced.edu" }
  );

  assert.equal(rendered.subject, "fgustavo@unisced.edu.mz");
  assert.equal(rendered.text, "fgustavo@unisced.edu.mz");
  assert.match(rendered.html, /fgustavo@unisced.edu.mz/);
});

test("identifica variáveis ausentes antes do envio", () => {
  const template = {
    subject: "{{NOME}}",
    body_text: "{{ASSINATURA}}",
    body_html: "<p>{{FEEDBACK}}</p>"
  };
  assert.deepEqual(extractVariables(template), [
    "ASSINATURA",
    "FEEDBACK",
    "NOME"
  ]);
  const rendered = renderTemplate(template, { name: "Marta" });
  assert.deepEqual(rendered.missingVariables, ["ASSINATURA", "FEEDBACK"]);
});
