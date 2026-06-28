const fs = require("fs");

const filePath = "D:/TECMINHO/plan/WEBINAR/webinar/A _ Verde-email-convite.html";
let html = fs.readFileSync(filePath, "utf8");

html = html
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/data:[^"']+/g, " ")
  .replace(/<br\s*\/?\s*>/gi, "\n")
  .replace(/<\/(p|div|h1|h2|h3|li|td|tr|span)>/gi, "\n")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/&quot;/g, '"')
  .replace(/&#039;/g, "'")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">");

const lines = html
  .split(/\n+/)
  .map((line) => line.replace(/\s+/g, " ").trim())
  .filter((line) => line.length > 2 && !line.startsWith("--pdw"));

console.log([...new Set(lines)].slice(0, 240).join("\n"));
