# -*- coding: utf-8 -*-
"""
Enviar campanhas Follow-Up via Smart Outreach Mailer API
=========================================================
Campanha F: Follow-Up Participantes (Grupo 1)
Campanha G: Follow-Up Ausentes (Grupo 2)
"""

import csv
import json
import os
import sys
import time
import urllib.request
import urllib.error

API = "http://localhost:4000/api"
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SAMPLES_DIR = os.path.join(os.path.dirname(BASE_DIR), "samples")


def api(method, path, data=None):
    """Call the Smart Outreach Mailer API."""
    url = f"{API}{path}"
    body = json.dumps(data).encode("utf-8") if data else None
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8", errors="replace")
        print(f"  API ERROR {e.code}: {error_body}")
        return None


def api_upload(path, filepath):
    """Upload a CSV file via multipart form."""
    import io
    boundary = "----PythonBoundary123456"
    filename = os.path.basename(filepath)
    
    with open(filepath, "rb") as f:
        file_data = f.read()
    
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: text/csv\r\n\r\n"
    ).encode("utf-8") + file_data + f"\r\n--{boundary}--\r\n".encode("utf-8")
    
    url = f"{API}{path}"
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))


def load_html(filename):
    """Read an HTML template file."""
    path = os.path.join(SAMPLES_DIR, filename)
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def extract_text_from_html(html):
    """Simple HTML to plain text (strip tags, decode entities)."""
    import re
    text = re.sub(r'<style[^>]*>.*?</style>', '', html, flags=re.DOTALL)
    text = re.sub(r'<[^>]+>', '\n', text)
    text = re.sub(r'&nbsp;', ' ', text)
    text = re.sub(r'&amp;', '&', text)
    text = re.sub(r'&lt;', '<', text)
    text = re.sub(r'&gt;', '>', text)
    text = re.sub(r'&#\d+;', '', text)
    text = re.sub(r'\n\s*\n', '\n\n', text)
    return text.strip()


def send_campaign(campaign_name, template_name, subject, html_file, csv_file):
    """Full flow: clear contacts, import CSV, create template, launch campaign."""
    print(f"\n{'='*60}")
    print(f"  {campaign_name}")
    print(f"{'='*60}")
    
    # 1. Clear existing contacts
    print("\n1. A limpar contactos existentes...")
    result = api("DELETE", "/contacts")
    if result:
        print(f"   Removidos: {result.get('deleted', 0)}")
    
    # 2. Preview CSV (validate)
    csv_path = os.path.join(BASE_DIR, csv_file)
    print(f"\n2. A validar CSV: {csv_file}")
    preview = api_upload("/contacts/preview", csv_path)
    if not preview:
        print("   ERRO: Falha ao validar CSV")
        return False
    
    summary = preview.get("summary", {})
    print(f"   Total: {summary.get('totalRows', 0)} | Validos: {summary.get('valid', 0)} | Invalidos: {summary.get('invalid', 0)}")
    
    invalid = preview.get("invalidRows", [])
    if invalid:
        print("   Linhas invalidas:")
        for row in invalid:
            print(f"     Linha {row['row']}: {row['name']} <{row['email']}> - {', '.join(row['errors'])}")
    
    # 3. Import valid contacts
    valid_contacts = preview.get("validContacts", [])
    if not valid_contacts:
        print("   ERRO: Nenhum contacto valido para importar")
        return False
    
    print(f"\n3. A importar {len(valid_contacts)} contactos...")
    result = api("POST", "/contacts/import", {"contacts": valid_contacts})
    if result:
        print(f"   Importados: {result.get('imported', 0)} | Ignorados: {result.get('skipped', 0)}")
    
    # 4. Create template
    html_content = load_html(html_file)
    text_content = extract_text_from_html(html_content)
    
    print(f"\n4. A criar template: {template_name}")
    result = api("POST", "/templates", {
        "name": template_name,
        "subject": subject,
        "body_text": text_content,
        "body_html": html_content
    })
    if not result:
        print("   ERRO: Falha ao criar template")
        return False
    
    template_id = result["template"]["id"]
    print(f"   Template criado com ID: {template_id}")
    
    # 5. Launch campaign
    print(f"\n5. A lancar campanha: {campaign_name}")
    result = api("POST", "/campaigns", {
        "name": campaign_name,
        "templateId": template_id,
        "confirm": True,
        "intervalSeconds": 5,
        "maxPerMinute": 12
    })
    if not result:
        print("   ERRO: Falha ao criar campanha")
        return False
    
    campaign = result.get("campaign", {})
    campaign_id = campaign.get("id")
    print(f"   Campanha #{campaign_id} criada!")
    print(f"   Status: {campaign.get('status')}")
    print(f"   Total emails: {campaign.get('total')}")
    
    return campaign_id


def wait_for_campaign(campaign_id, label):
    """Poll campaign status until complete."""
    print(f"\n   A aguardar conclusao da campanha #{campaign_id}...")
    while True:
        time.sleep(5)
        result = api("GET", f"/campaigns/{campaign_id}")
        if not result:
            continue
        
        campaign = result.get("campaign", {})
        status = campaign.get("status", "unknown")
        sent = campaign.get("sent", 0)
        failed = campaign.get("failed", 0)
        total = campaign.get("total", 0)
        
        print(f"   [{label}] {sent}/{total} enviados | {failed} falhados | Status: {status}")
        
        if status in ("completed", "completed_with_errors", "failed"):
            return status
    

def main():
    # Check API health
    print("A verificar API...")
    health = api("GET", "/health")
    if not health or not health.get("ok"):
        print("ERRO: API nao esta acessivel em http://localhost:4000")
        sys.exit(1)
    print("API OK!")
    
    # Check SMTP
    smtp = api("GET", "/smtp-settings")
    settings = smtp.get("settings") if smtp else None
    if not settings or not settings.get("host"):
        print("ERRO: SMTP nao configurado. Configure na app antes de enviar.")
        sys.exit(1)
    print(f"SMTP: {settings.get('from_email')} via {settings.get('host')}:{settings.get('port')}")
    
    # === CAMPANHA F: Follow-Up Participantes ===
    campaign_f_id = send_campaign(
        campaign_name="F — Follow-Up Participantes",
        template_name="F — Follow-Up Participantes",
        subject="{{name}}, o replay do webinar ja esta disponivel — e a sua opiniao conta!",
        html_file="F_Follow-Up-Participantes.html",
        csv_file="grupo1-participantes.csv"
    )
    
    if campaign_f_id:
        status_f = wait_for_campaign(campaign_f_id, "Grupo 1")
        print(f"\n   Campanha F finalizada: {status_f}")
    
    # === CAMPANHA G: Follow-Up Ausentes ===
    campaign_g_id = send_campaign(
        campaign_name="G — Follow-Up Ausentes (Mundial)",
        template_name="G — Follow-Up Ausentes (Mundial)",
        subject="Enquanto Portugal joga, ha outro replay que nao pode perder...",
        html_file="G_Follow-Up-Ausentes.html",
        csv_file="grupo2-ausentes.csv"
    )
    
    if campaign_g_id:
        status_g = wait_for_campaign(campaign_g_id, "Grupo 2")
        print(f"\n   Campanha G finalizada: {status_g}")
    
    print(f"\n{'='*60}")
    print("  RESUMO FINAL")
    print(f"{'='*60}")
    if campaign_f_id:
        print(f"  Campanha F (Participantes): {status_f}")
    if campaign_g_id:
        print(f"  Campanha G (Ausentes):      {status_g}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
