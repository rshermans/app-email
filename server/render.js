const tokenPattern = /\{\{\s*([\p{L}\p{N}_ -]+?)\s*\}\}/gu;

export function normalizeVariableKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function extractVariables(template = {}) {
  const variables = new Set();
  [template.subject, template.body_text, template.body_html].forEach((input) => {
    for (const match of String(input || "").matchAll(tokenPattern)) {
      const key = normalizeVariableKey(match[1]);
      if (key) variables.add(key);
    }
  });
  return [...variables].sort();
}

export function buildMergeData(contact = {}, eventFields = {}, globals = {}) {
  const data = {};

  [eventFields, globals].forEach((source) => {
    Object.entries(source || {}).forEach(([key, value]) => {
      const normalizedKey = normalizeVariableKey(key);
      if (normalizedKey) data[normalizedKey] = value ?? "";
    });
  });

  Object.entries(contact || {}).forEach(([key, value]) => {
    if (key === "fields" || key === "fields_json") return;
    const normalizedKey = normalizeVariableKey(key);
    if (normalizedKey) data[normalizedKey] = value ?? "";
  });

  const name = contact.name ?? contact.nome ?? data.NOME ?? data.NAME ?? "";
  const email = contact.email ?? data.EMAIL ?? "";
  const company =
    contact.company ?? contact.empresa ?? data.EMPRESA ?? data.COMPANY ?? "";

  data.NOME = name;
  data.NAME = name;
  data.EMAIL = email;
  data.MAIL = email;
  data.EMPRESA = company;
  data.COMPANY = company;
  data.COMPANHIA = company;

  return data;
}

function replaceVariables(input, values, escapeValues) {
  return String(input || "").replace(tokenPattern, (match, rawKey) => {
    const key = normalizeVariableKey(rawKey);
    if (!Object.hasOwn(values, key) || values[key] === "") return match;
    return escapeValues ? escapeHtml(values[key]) : String(values[key] ?? "");
  });
}

export function renderTemplate(template, contact = {}, eventFields = {}, globals = {}) {
  const values = buildMergeData(contact, eventFields, globals);
  const usedVariables = extractVariables(template);
  const missingVariables = usedVariables.filter(
    (key) => !Object.hasOwn(values, key) || values[key] === ""
  );

  return {
    subject: replaceVariables(template.subject, values, false),
    text: replaceVariables(template.body_text, values, false),
    html: template.body_html
      ? replaceVariables(template.body_html, values, true)
      : "",
    usedVariables,
    missingVariables
  };
}

export function availableVariables(extraKeys = []) {
  return [
    "NOME",
    "EMAIL",
    "EMPRESA",
    "GRUPO",
    "TOTAL",
    "MENCAO",
    "CADERNO",
    "PASSO",
    "PRESENCAS",
    "MULTIMODAL",
    "FEEDBACK",
    "ASSINATURA",
    ...extraKeys.map(normalizeVariableKey)
  ]
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index)
    .map((key) => `{{${key}}}`);
}
