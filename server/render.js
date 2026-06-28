const allowedVariables = new Set(["name", "email", "company"]);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeContact(contact = {}) {
  return {
    name: contact.name || "",
    email: contact.email || "",
    company: contact.company || ""
  };
}

function replaceVariables(input, contact, escapeValues) {
  const values = normalizeContact(contact);

  return String(input || "").replace(/{{\s*([a-zA-Z]+)\s*}}/g, (match, key) => {
    const normalizedKey = key.toLowerCase();
    if (!allowedVariables.has(normalizedKey)) return match;

    const value = values[normalizedKey];
    return escapeValues ? escapeHtml(value) : String(value ?? "");
  });
}

export function renderTemplate(template, contact) {
  return {
    subject: replaceVariables(template.subject, contact, false),
    text: replaceVariables(template.body_text, contact, false),
    html: template.body_html ? replaceVariables(template.body_html, contact, true) : ""
  };
}

export function availableVariables() {
  return ["{{name}}", "{{email}}", "{{company}}"];
}
