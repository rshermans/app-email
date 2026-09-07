import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const appSource = fs.readFileSync(
  new URL("../src/App.jsx", import.meta.url),
  "utf8"
);
const stylesSource = fs.readFileSync(
  new URL("../src/styles.css", import.meta.url),
  "utf8"
);
const documentSource = fs.readFileSync(
  new URL("../index.html", import.meta.url),
  "utf8"
);

test("mantém os elementos estruturais de acessibilidade do Mail Studio", () => {
  assert.match(documentSource, /<html lang="pt-PT">/);
  assert.match(appSource, /className="skip-link"/);
  assert.match(appSource, /<nav className="primary-nav" aria-label=/);
  assert.match(appSource, /<main id="main-content"/);
  assert.match(appSource, /aria-live="polite"/);
  assert.match(appSource, /role="dialog" aria-modal="true"/);
  assert.match(appSource, /<caption id="audience-title">/);
});

test("isola o preview e mantém uma alternativa textual", () => {
  assert.match(appSource, /sandbox=""/);
  assert.match(appSource, /title={`Email renderizado/);
  assert.match(appSource, /Ler alternativa em texto simples/);
});

test("preserva foco visível, reflow e redução de movimento", () => {
  assert.match(stylesSource, /:focus-visible/);
  assert.match(stylesSource, /outline: 3px solid #0e7490/);
  assert.match(stylesSource, /@media \(max-width: 650px\)/);
  assert.match(stylesSource, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(stylesSource, /@media \(forced-colors: active\)/);
});

test("oferece ações em massa acessíveis para o público do evento", () => {
  assert.match(appSource, /aria-label="Ações para participantes selecionados"/);
  assert.match(appSource, /id="bulk-template"/);
  assert.match(appSource, /action, extra = \{\}/);
  assert.match(appSource, /action === "clear_all"/);
  assert.match(appSource, /Para limpar todos os participantes/);
  assert.match(stylesSource, /\.bulk-actions/);
});
