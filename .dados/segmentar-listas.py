# -*- coding: utf-8 -*-
"""
Segmentar listas do Webinar PDW
===============================
Cruza o Excel de participantes Zoom com o CSV de inscrições.
Gera dois CSVs: grupo1-participantes.csv e grupo2-ausentes.csv
"""

import csv
import os
import sys

try:
    import openpyxl
except ImportError:
    print("ERRO: openpyxl não instalado. Execute: pip install openpyxl")
    sys.exit(1)

# ---------- Configuração ----------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
EXCEL_PARTICIPANTES = os.path.join(BASE_DIR, "2026-06-26_RS_Zoom_Webinar_participants_85469234422_2026_06_26.xlsx")
CSV_INSCRITOS = os.path.join(BASE_DIR, "inscricoes-todos.csv")
CSV_GRUPO1 = os.path.join(BASE_DIR, "grupo1-participantes.csv")
CSV_GRUPO2 = os.path.join(BASE_DIR, "grupo2-ausentes.csv")

# Mapeamentos manuais: email de inscrição → email usado no Zoom
# (para casos em que a pessoa usou email diferente no Zoom)
MANUAL_MAPPINGS = {
    "daniel.carvalho@ulsla.min-saude.pt": "daniel.gc.carvalho@gmail.com",
    "pdias@tecminho.uminho.pt": "a@a.pt",
    "b15497@2c2t.uminho.pt": "catarina.joao.cardoso.costa@gmail.com",
}

# Emails de speakers/host/staff a excluir do envio
EXCLUDED_EMAILS = {
    "ffelipesimoes@gmail.com",       # Speaker — Felipe Simões
    "rleite@tecminho.uminho.pt",     # Speaker — Rómulo Leite
    "nfernandes@tecminho.uminho.pt", # Speaker — Nuno Fernandes
    "formar@tecminho.uminho.pt",     # Host — Formar TecMinho
    "rmagalhaes@tecminho.uminho.pt", # Staff — Rómulo Magalhães
}

# ---------- 1. Ler participantes do Zoom ----------
def load_zoom_participants(path):
    """Retorna um set de emails (lowercase) dos participantes Zoom."""
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.active
    
    emails = set()
    header_found = False
    email_col = None
    
    for row in ws.iter_rows(values_only=True):
        if row is None:
            continue
        
        # Procurar a linha de cabeçalho
        if not header_found:
            row_str = [str(c).strip().lower() if c else "" for c in row]
            if "email" in row_str:
                email_col = row_str.index("email")
                header_found = True
            continue
        
        # Extrair email
        if email_col is not None and len(row) > email_col and row[email_col]:
            email = str(row[email_col]).strip().lower()
            if "@" in email:
                emails.add(email)
    
    wb.close()
    return emails


# ---------- 2. Ler inscritos do CSV ----------
def load_inscritos(path):
    """Retorna lista de dicionários {nome, email, organizacao} dos inscritos."""
    inscritos = []
    with open(path, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            inscritos.append({
                "nome": row.get("Nome", "").strip(),
                "email": row.get("Email", "").strip(),
                "organizacao": row.get("Organização", row.get("Organizaçao", "")).strip(),
            })
    return inscritos


# ---------- 3. Segmentar ----------
def segmentar(inscritos, zoom_emails):
    """Divide inscritos em grupo1 (participaram) e grupo2 (não participaram)."""
    grupo1 = []
    grupo2 = []
    
    for inscrito in inscritos:
        email_lower = inscrito["email"].lower()
        
        # Excluir speakers/host/staff
        if email_lower in EXCLUDED_EMAILS:
            print(f"  [EXCLUÍDO] {inscrito['nome']} ({email_lower}) — speaker/staff")
            continue
        
        # Verificar se participou (email direto ou mapeamento manual)
        zoom_email = MANUAL_MAPPINGS.get(email_lower, email_lower)
        
        if zoom_email in zoom_emails or email_lower in zoom_emails:
            grupo1.append(inscrito)
        else:
            grupo2.append(inscrito)
    
    return grupo1, grupo2


# ---------- 4. Escrever CSVs ----------
def write_csv(path, contacts, label):
    """Escreve um CSV com Nome,Email,Organização."""
    with open(path, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["Nome", "Email", "Organização"])
        for c in contacts:
            writer.writerow([c["nome"], c["email"], c["organizacao"]])
    print(f"\n✅ {label}: {len(contacts)} contactos → {os.path.basename(path)}")


# ---------- Main ----------
def main():
    print("=" * 60)
    print("📧 Segmentação de Listas — Webinar PDW")
    print("=" * 60)
    
    # Verificar ficheiros
    for path, label in [(EXCEL_PARTICIPANTES, "Excel participantes"), (CSV_INSCRITOS, "CSV inscritos")]:
        if not os.path.exists(path):
            print(f"❌ Ficheiro não encontrado: {path}")
            sys.exit(1)
        print(f"✓ {label}: {os.path.basename(path)}")
    
    # Carregar dados
    print("\n🔄 A carregar dados...")
    zoom_emails = load_zoom_participants(EXCEL_PARTICIPANTES)
    print(f"  → {len(zoom_emails)} emails únicos no Zoom")
    
    inscritos = load_inscritos(CSV_INSCRITOS)
    print(f"  → {len(inscritos)} inscritos no CSV")
    
    # Segmentar
    print("\n🔀 A segmentar listas...")
    grupo1, grupo2 = segmentar(inscritos, zoom_emails)
    
    # Escrever resultados
    write_csv(CSV_GRUPO1, grupo1, "Grupo 1 (Participaram)")
    for c in grupo1:
        print(f"    ✓ {c['nome']} — {c['email']}")
    
    write_csv(CSV_GRUPO2, grupo2, "Grupo 2 (Não participaram)")
    for c in grupo2:
        print(f"    ✗ {c['nome']} — {c['email']}")
    
    print(f"\n{'=' * 60}")
    print(f"📊 Resumo: {len(grupo1)} participaram | {len(grupo2)} ausentes | {len(grupo1) + len(grupo2)} total")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
