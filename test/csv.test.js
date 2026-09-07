import assert from "node:assert/strict";
import test from "node:test";
import { detectCsvDelimiter, parseCsvRecords } from "../server/csv.js";

test("detecta ponto e virgula ignorando delimitadores dentro de aspas", () => {
  const csv = '"Nome";"Email";"Empresa"\n"Ana; Maria";"ana@example.org";"INS"';
  const records = parseCsvRecords(Buffer.from(csv, "utf8"));

  assert.equal(detectCsvDelimiter(csv), ";");
  assert.deepEqual(records, [
    {
      Nome: "Ana; Maria",
      Email: "ana@example.org",
      Empresa: "INS"
    }
  ]);
});

test("mantem compatibilidade com CSV separado por virgula", () => {
  const records = parseCsvRecords(
    Buffer.from('Nome,Email,Empresa\n"Ana, Maria",ana@example.org,INS', "utf8")
  );

  assert.deepEqual(records, [
    {
      Nome: "Ana, Maria",
      Email: "ana@example.org",
      Empresa: "INS"
    }
  ]);
});

test("aceita CSV separado por tabulacao", () => {
  const records = parseCsvRecords(
    Buffer.from("Nome\tEmail\tEmpresa\nAna\tana@example.org\tINS", "utf8")
  );

  assert.deepEqual(records, [
    {
      Nome: "Ana",
      Email: "ana@example.org",
      Empresa: "INS"
    }
  ]);
});

test("le o CSV legado exportado com aspas exteriores e ;; no fim", () => {
  const csv = [
    '"id_convite,""nome"",""primeiro_nome"",""email""";;',
    '"P4M-A2-0009,""Aida Anselmo João Matimba"",""Aida"",""aidajmatimba@gmail.com""";;',
    '"P4M-A2-0046,""António Bonifácio Companhia"",""António"",""antoniocompanhia2010@gmail.com""";;',
    '"P4M-A2-0057,""Atija Antonio Ussene Marcelino"",""Atija"",""atija.marcelino@ins.gov.mz""";;',
    '"P4M-A2-0064,""Bento Inácio Cambula"",""Bento"",""bcambula@gmail.com""";;',
    '"P4M-A2-0248,""Marcela Arão Guivala"",""Marcela"",""marcelaguivala@gmail.com""";;'
  ].join("\n");
  const records = parseCsvRecords(Buffer.from(csv, "utf8"), { relax_column_count: true });

  const expectedEmails = new Map([
    ["António Bonifácio Companhia", "antoniocompanhia2010@gmail.com"],
    ["Aida Anselmo João Matimba", "aidajmatimba@gmail.com"],
    ["Marcela Arão Guivala", "marcelaguivala@gmail.com"],
    ["Bento Inácio Cambula", "bcambula@gmail.com"],
    ["Atija Antonio Ussene Marcelino", "atija.marcelino@ins.gov.mz"]
  ]);

  for (const [name, email] of expectedEmails) {
    const record = records.find((row) => row.nome === name);
    assert.ok(record, `Registo não encontrado: ${name}`);
    assert.equal(record.email, email, `Email incorreto: ${name}`);
  }
});
