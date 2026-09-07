import { parse } from "csv-parse/sync";

const SUPPORTED_DELIMITERS = [",", ";", "\t"];

function firstNonEmptyLine(text) {
  return String(text || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .find((line) => line.trim());
}

function isWrappedLegacyCsv(text) {
  const lines = String(text || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .slice(0, 2);

  return lines.length === 2 && lines.every((line) => {
    const value = line.trimEnd();
    return value.startsWith('"') && value.endsWith(";;");
  });
}

function parseLegacyCsvLine(line) {
  let value = line.replace(/^\uFEFF/, "").trimEnd();
  if (value.endsWith(";;")) value = value.slice(0, -2);
  if (value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1);
  }

  const fields = [];
  const field = [];
  let inFieldQuotes = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const nextChar = value[index + 1];

    if (char === '"' && nextChar === '"') {
      inFieldQuotes = !inFieldQuotes;
      index += 1;
      continue;
    }

    // Some values containing semicolons were exported with single quotes
    // around each semicolon-separated fragment. They are data, not CSV quotes.
    if (char === '"') continue;

    if (char === "," && !inFieldQuotes) {
      fields.push(field.join("").trim());
      field.length = 0;
      continue;
    }

    field.push(char);
  }

  fields.push(field.join("").trim());
  return fields;
}

function parseLegacyCsv(text) {
  const rows = String(text || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map(parseLegacyCsvLine);

  const headers = rows.shift() || [];
  return rows.map((values) => Object.fromEntries(
    headers.map((header, index) => [header, values[index] ?? ""])
  ));
}

function countDelimiterOutsideQuotes(line, delimiter) {
  let count = 0;
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiter) count += 1;
  }

  return count;
}

export function detectCsvDelimiter(text) {
  if (isWrappedLegacyCsv(text)) return ",";

  const header = firstNonEmptyLine(text);
  if (!header) return ",";

  return SUPPORTED_DELIMITERS
    .map((delimiter) => ({
      delimiter,
      count: countDelimiterOutsideQuotes(header, delimiter)
    }))
    .sort((left, right) => right.count - left.count)[0].delimiter;
}

export function parseCsvRecords(buffer, options = {}) {
  const rawText = buffer.toString("utf8");
  if (isWrappedLegacyCsv(rawText)) return parseLegacyCsv(rawText);

  const text = rawText;

  return parse(text, {
    bom: true,
    columns: true,
    delimiter: detectCsvDelimiter(text),
    skip_empty_lines: true,
    trim: true,
    ...options
  });
}
