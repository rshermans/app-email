import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock3,
  ContactRound,
  Eye,
  FileText,
  Loader2,
  Mail,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  ServerCog,
  ShieldCheck,
  Trash2,
  Upload,
  XCircle
} from "lucide-react";
import { api, formatDate, statusLabel } from "./utils/api.js";

const steps = [
  { label: "Contactos", icon: ContactRound },
  { label: "Template", icon: FileText },
  { label: "SMTP", icon: ServerCog },
  { label: "Enviar", icon: Send }
];

const emptyTemplate = {
  id: null,
  name: "",
  subject: "Olá {{name}},",
  body_text: "Olá {{name}},\n\n",
  body_html: "<p>Olá <strong>{{name}}</strong>,</p>"
};

const emptyCampaign = {
  name: "",
  sendMode: "now",
  scheduledAt: "",
  intervalSeconds: 5,
  maxPerMinute: 30,
  confirm: false
};

const fallbackContact = {
  name: "João Silva",
  email: "joao@email.com",
  company: "Empresa Demo"
};

export default function App() {
  const [step, setStep] = useState(0);
  const [contacts, setContacts] = useState([]);
  const [preview, setPreview] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [templateForm, setTemplateForm] = useState(emptyTemplate);
  const [renderedPreview, setRenderedPreview] = useState(null);
  const [smtpSettings, setSmtpSettings] = useState(null);
  const [smtpForm, setSmtpForm] = useState({
    host: "",
    port: 465,
    from_email: "",
    password: "",
    secure: true,
    max_per_minute: 30
  });
  const [campaigns, setCampaigns] = useState([]);
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [campaignForm, setCampaignForm] = useState(emptyCampaign);
  const [selectedContactIds, setSelectedContactIds] = useState([]);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState(null);

  const [contactsSearch, setContactsSearch] = useState("");
  const [contactsFilter, setContactsFilter] = useState("all"); // "all" | "selected" | "unselected"
  const [sendSearch, setSendSearch] = useState("");
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  const filteredContacts = useMemo(() => {
    return contacts.filter((c) => {
      const matchesSearch =
        contactsSearch === "" ||
        c.name.toLowerCase().includes(contactsSearch.toLowerCase()) ||
        c.email.toLowerCase().includes(contactsSearch.toLowerCase()) ||
        (c.company || "").toLowerCase().includes(contactsSearch.toLowerCase());
      
      const isSel = selectedContactIds.includes(c.id);
      const matchesFilter =
        contactsFilter === "all" ||
        (contactsFilter === "selected" && isSel) ||
        (contactsFilter === "unselected" && !isSel);

      return matchesSearch && matchesFilter;
    });
  }, [contacts, contactsSearch, contactsFilter, selectedContactIds]);

  const filteredSendContacts = useMemo(() => {
    return contacts.filter((c) => {
      return (
        sendSearch === "" ||
        c.name.toLowerCase().includes(sendSearch.toLowerCase()) ||
        c.email.toLowerCase().includes(sendSearch.toLowerCase()) ||
        (c.company || "").toLowerCase().includes(sendSearch.toLowerCase())
      );
    });
  }, [contacts, sendSearch]);

  const selectedTemplateId = templateForm.id || templates[0]?.id || "";
  const selectedContacts = useMemo(
    () => contacts.filter((contact) => selectedContactIds.includes(contact.id)),
    [contacts, selectedContactIds]
  );

  const latestCampaign = campaigns[0];

  const showNotice = useCallback((type, message) => {
    setNotice({ type, message });
    window.clearTimeout(showNotice.timeout);
    showNotice.timeout = window.setTimeout(() => setNotice(null), 4500);
  }, []);

  const selectTemplate = useCallback((template) => {
    if (!template) {
      setTemplateForm(emptyTemplate);
      setRenderedPreview(null);
      return;
    }

    setTemplateForm({
      id: template.id,
      name: template.name,
      subject: template.subject,
      body_text: template.body_text,
      body_html: template.body_html || ""
    });
    setRenderedPreview(null);
  }, []);

  const loadCampaigns = useCallback(async () => {
    const data = await api("/api/campaigns");
    setCampaigns(data.campaigns || []);
  }, []);

  const loadInitialData = useCallback(async () => {
    setBusy("load");
    try {
      const [contactsData, templatesData, smtpData, campaignsData] = await Promise.all([
        api("/api/contacts"),
        api("/api/templates"),
        api("/api/smtp-settings"),
        api("/api/campaigns")
      ]);

      const nextContacts = contactsData.contacts || [];
      const nextTemplates = templatesData.templates || [];

      setContacts(nextContacts);
      setTemplates(nextTemplates);
      setCampaigns(campaignsData.campaigns || []);
      setSelectedContactIds(nextContacts.map((contact) => contact.id));

      if (nextTemplates.length > 0) {
        selectTemplate(nextTemplates[0]);
      }

      if (smtpData.settings) {
        setSmtpSettings(smtpData.settings);
        setSmtpForm({
          host: smtpData.settings.host,
          port: smtpData.settings.port,
          from_email: smtpData.settings.from_email,
          password: "",
          secure: smtpData.settings.secure,
          max_per_minute: smtpData.settings.max_per_minute
        });
      }
    } catch (error) {
      showNotice("error", error.message);
    } finally {
      setBusy("");
    }
  }, [selectTemplate, showNotice]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      loadCampaigns().catch(() => {});
    }, 5000);

    return () => window.clearInterval(timer);
  }, [loadCampaigns]);

  async function refreshContacts() {
    const data = await api("/api/contacts");
    const nextContacts = data.contacts || [];
    setContacts(nextContacts);
    setSelectedContactIds((current) => {
      const nextIds = nextContacts.map((contact) => contact.id);
      const currentStillExists = current.filter((id) => nextIds.includes(id));
      return currentStillExists.length > 0 ? currentStillExists : nextIds;
    });
  }

  async function handleCsvPreview(file) {
    if (!file) return;

    setBusy("preview");
    setPreview(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const data = await api("/api/contacts/preview", {
        method: "POST",
        body: formData
      });
      setPreview(data);
      showNotice("success", "CSV analisado");
    } catch (error) {
      showNotice("error", error.message);
    } finally {
      setBusy("");
    }
  }

  async function importPreviewContacts() {
    if (!preview?.validContacts?.length) return;

    setBusy("import");
    try {
      const data = await api("/api/contacts/import", {
        method: "POST",
        body: JSON.stringify({ contacts: preview.validContacts })
      });
      await refreshContacts();
      setPreview(null);
      showNotice("success", `${data.imported} contactos importados`);
    } catch (error) {
      showNotice("error", error.message);
    } finally {
      setBusy("");
    }
  }

  async function clearContacts() {
    if (!window.confirm("Apagar todos os contactos importados?")) return;

    setBusy("clearContacts");
    try {
      const data = await api("/api/contacts", { method: "DELETE" });
      await refreshContacts();
      setPreview(null);
      showNotice("success", `${data.deleted} contactos apagados`);
    } catch (error) {
      showNotice("error", error.message);
    } finally {
      setBusy("");
    }
  }

  async function saveTemplate() {
    setBusy("template");
    try {
      const method = templateForm.id ? "PUT" : "POST";
      const path = templateForm.id ? `/api/templates/${templateForm.id}` : "/api/templates";
      const data = await api(path, {
        method,
        body: JSON.stringify(templateForm)
      });
      const templatesData = await api("/api/templates");
      setTemplates(templatesData.templates || []);
      selectTemplate(data.template);
      showNotice("success", "Template guardado");
    } catch (error) {
      showNotice("error", error.message);
    } finally {
      setBusy("");
    }
  }

  async function deleteTemplate() {
    if (!templateForm.id) return;
    if (!window.confirm("Apagar este template?")) return;

    setBusy("templateDelete");
    try {
      await api(`/api/templates/${templateForm.id}`, { method: "DELETE" });
      const data = await api("/api/templates");
      setTemplates(data.templates || []);
      selectTemplate(data.templates?.[0] || null);
      showNotice("success", "Template apagado");
    } catch (error) {
      showNotice("error", error.message);
    } finally {
      setBusy("");
    }
  }

  async function previewTemplate() {
    setBusy("templatePreview");
    try {
      const sampleContact = contacts[0] || fallbackContact;
      const data = await api("/api/templates/preview", {
        method: "POST",
        body: JSON.stringify({ ...templateForm, contact: sampleContact })
      });
      setRenderedPreview(data.rendered);
    } catch (error) {
      showNotice("error", error.message);
    } finally {
      setBusy("");
    }
  }

  async function saveSmtp() {
    setBusy("smtp");
    try {
      const data = await api("/api/smtp-settings", {
        method: "POST",
        body: JSON.stringify(smtpForm)
      });
      setSmtpSettings(data.settings);
      setSmtpForm((current) => ({ ...current, password: "" }));
      showNotice("success", "SMTP guardado");
    } catch (error) {
      showNotice("error", error.message);
    } finally {
      setBusy("");
    }
  }

  async function testSmtp() {
    setBusy("smtpTest");
    try {
      const data = await api("/api/smtp-settings/test", {
        method: "POST",
        body: JSON.stringify(smtpForm)
      });
      showNotice("success", data.message || "Ligação validada");
    } catch (error) {
      showNotice("error", error.message);
    } finally {
      setBusy("");
    }
  }

  async function sendCampaign() {
    if (campaignForm.sendMode === "scheduled" && !campaignForm.scheduledAt) {
      showNotice("error", "Escolha a data/hora de agendamento");
      return;
    }

    if (selectedContacts.length === 0) {
      showNotice("error", "Selecione pelo menos um contacto");
      return;
    }

    setBusy("campaign");
    try {
      const scheduledAt =
        campaignForm.sendMode === "scheduled"
          ? new Date(campaignForm.scheduledAt).toISOString()
          : null;

      const data = await api("/api/campaigns", {
        method: "POST",
        body: JSON.stringify({
          name: campaignForm.name,
          templateId: Number(selectedTemplateId),
          contactIds: selectedContactIds,
          scheduledAt,
          intervalSeconds: Number(campaignForm.intervalSeconds),
          maxPerMinute: Number(campaignForm.maxPerMinute),
          confirm: campaignForm.confirm
        })
      });

      setSelectedCampaign(data.campaign);
      await loadCampaigns();
      setCampaignForm(emptyCampaign);
      showNotice("success", "Campanha criada");
    } catch (error) {
      showNotice("error", error.message);
    } finally {
      setBusy("");
    }
  }

  async function openCampaign(id) {
    setBusy(`campaign-${id}`);
    try {
      const data = await api(`/api/campaigns/${id}`);
      setSelectedCampaign(data.campaign);
    } catch (error) {
      showNotice("error", error.message);
    } finally {
      setBusy("");
    }
  }

  function toggleContact(id) {
    setSelectedContactIds((current) =>
      current.includes(id)
        ? current.filter((currentId) => currentId !== id)
        : [...current, id]
    );
  }

  const readiness = [
    { label: "Contactos", value: contacts.length, ok: contacts.length > 0 },
    { label: "Templates", value: templates.length, ok: templates.length > 0 },
    { label: "SMTP", value: smtpSettings ? "OK" : "-", ok: Boolean(smtpSettings) }
  ];

  return (
    <div className="min-h-screen bg-mist text-ink">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-pine text-white">
              <Mail size={20} aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-normal">Smart Outreach Mailer</h1>
              <p className="text-sm text-slate-500">Envio SMTP personalizado</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:flex">
            {readiness.map((item) => (
              <div key={item.label} className="metric min-w-24">
                <div className="text-xs text-slate-500">{item.label}</div>
                <div className="flex items-center gap-2 text-sm font-bold">
                  <span>{item.value}</span>
                  {item.ok ? (
                    <CheckCircle2 className="text-pine" size={16} aria-hidden="true" />
                  ) : (
                    <AlertCircle className="text-amberline" size={16} aria-hidden="true" />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <WizardNav step={step} setStep={setStep} />

        {notice && (
          <div
            className={`mb-4 flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
              notice.type === "error"
                ? "border-red-200 bg-red-50 text-red-800"
                : "border-emerald-200 bg-emerald-50 text-emerald-800"
            }`}
          >
            {notice.type === "error" ? <XCircle size={16} /> : <CheckCircle2 size={16} />}
            <span>{notice.message}</span>
          </div>
        )}

        {busy === "load" ? (
          <div className="panel flex min-h-80 items-center justify-center">
            <Loader2 className="animate-spin text-pine" size={28} aria-hidden="true" />
          </div>
        ) : (
          <>
            {step === 0 && (
              <ContactsStep
                busy={busy}
                contacts={contacts}
                filteredContacts={filteredContacts}
                preview={preview}
                selectedContactIds={selectedContactIds}
                onCsvPreview={handleCsvPreview}
                onImport={importPreviewContacts}
                onClear={clearContacts}
                onToggleContact={toggleContact}
                onSelectAll={() => setSelectedContactIds((current) => Array.from(new Set([...current, ...filteredContacts.map((c) => c.id)])))}
                onSelectNone={() => setSelectedContactIds((current) => current.filter((id) => !filteredContacts.map((c) => c.id).includes(id)))}
                contactsSearch={contactsSearch}
                setContactsSearch={setContactsSearch}
                contactsFilter={contactsFilter}
                setContactsFilter={setContactsFilter}
                onOpenAddModal={() => setIsAddModalOpen(true)}
              />
            )}

            {step === 1 && (
              <TemplateStep
                busy={busy}
                templates={templates}
                templateForm={templateForm}
                renderedPreview={renderedPreview}
                onSelect={selectTemplate}
                onChange={setTemplateForm}
                onNew={() => selectTemplate(null)}
                onSave={saveTemplate}
                onDelete={deleteTemplate}
                onPreview={previewTemplate}
              />
            )}

            {step === 2 && (
              <SmtpStep
                busy={busy}
                smtpForm={smtpForm}
                smtpSettings={smtpSettings}
                onChange={setSmtpForm}
                onSave={saveSmtp}
                onTest={testSmtp}
              />
            )}

            {step === 3 && (
              <SendStep
                busy={busy}
                contacts={contacts}
                filteredContacts={filteredSendContacts}
                templates={templates}
                selectedContacts={selectedContacts}
                selectedContactIds={selectedContactIds}
                selectedTemplateId={selectedTemplateId}
                smtpSettings={smtpSettings}
                campaignForm={campaignForm}
                campaigns={campaigns}
                selectedCampaign={selectedCampaign || latestCampaign}
                onTemplateSelect={(id) => {
                  const template = templates.find((item) => item.id === Number(id));
                  selectTemplate(template);
                }}
                onCampaignChange={setCampaignForm}
                onSend={sendCampaign}
                onToggleContact={toggleContact}
                onSelectAll={() => setSelectedContactIds((current) => Array.from(new Set([...current, ...filteredSendContacts.map((c) => c.id)])))}
                onSelectNone={() => setSelectedContactIds((current) => current.filter((id) => !filteredSendContacts.map((c) => c.id).includes(id)))}
                onOpenCampaign={openCampaign}
                onRefreshCampaigns={loadCampaigns}
                sendSearch={sendSearch}
                setSendSearch={setSendSearch}
              />
            )}
          </>
        )}
      </main>

      <AddContactModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSave={async (newContact) => {
          await refreshContacts();
          setSelectedContactIds((current) => [...current, newContact.id]);
        }}
        showNotice={showNotice}
      />
    </div>
  );
}

function WizardNav({ step, setStep }) {
  return (
    <nav className="mb-4 grid gap-2 sm:grid-cols-4" aria-label="Wizard">
      {steps.map((item, index) => {
        const Icon = item.icon;
        const isActive = index === step;
        const isDone = index < step;

        return (
          <button
            key={item.label}
            className={`focus-ring flex h-14 items-center justify-between rounded-md border px-3 text-left transition ${
              isActive
                ? "border-pine bg-white text-pine shadow-sm"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
            }`}
            onClick={() => setStep(index)}
            type="button"
          >
            <span className="flex min-w-0 items-center gap-2">
              <Icon size={18} aria-hidden="true" />
              <span className="truncate text-sm font-semibold">{item.label}</span>
            </span>
            {isDone ? (
              <CheckCircle2 size={18} className="text-pine" aria-hidden="true" />
            ) : (
              <ChevronRight size={18} aria-hidden="true" />
            )}
          </button>
        );
      })}
    </nav>
  );
}

function ContactsStep({
  busy,
  contacts,
  filteredContacts,
  preview,
  selectedContactIds,
  onCsvPreview,
  onImport,
  onClear,
  onToggleContact,
  onSelectAll,
  onSelectNone,
  contactsSearch,
  setContactsSearch,
  contactsFilter,
  setContactsFilter,
  onOpenAddModal
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section className="panel overflow-hidden">
        <PanelHeader
          title="Contactos"
          action={
            <div className="flex flex-wrap gap-2">
              <button className="primary-button" onClick={onOpenAddModal} type="button">
                <Plus size={16} aria-hidden="true" />
                Adicionar
              </button>
              <label className="secondary-button cursor-pointer">
                <Upload size={16} aria-hidden="true" />
                CSV
                <input
                  className="sr-only"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => onCsvPreview(event.target.files?.[0])}
                />
              </label>
              <button className="danger-button" onClick={onClear} disabled={contacts.length === 0} type="button">
                <Trash2 size={16} aria-hidden="true" />
                Apagar
              </button>
            </div>
          }
        />

        <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/50 p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <input
              type="text"
              className="field pl-9"
              placeholder="Pesquisar por nome, email ou empresa..."
              value={contactsSearch}
              onChange={(e) => setContactsSearch(e.target.value)}
            />
            <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-slate-400">
              <Search size={16} />
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              className={`secondary-button !py-1.5 !px-3 text-xs !h-auto ${contactsFilter === "all" ? "border-pine text-pine bg-teal-50/50 font-bold" : ""}`}
              onClick={() => setContactsFilter("all")}
            >
              Todos ({contacts.length})
            </button>
            <button
              type="button"
              className={`secondary-button !py-1.5 !px-3 text-xs !h-auto ${contactsFilter === "selected" ? "border-pine text-pine bg-teal-50/50 font-bold" : ""}`}
              onClick={() => setContactsFilter("selected")}
            >
              Selecionados ({selectedContactIds.length})
            </button>
            <button
              type="button"
              className={`secondary-button !py-1.5 !px-3 text-xs !h-auto ${contactsFilter === "unselected" ? "border-pine text-pine bg-teal-50/50 font-bold" : ""}`}
              onClick={() => setContactsFilter("unselected")}
            >
              Não Selecionados ({contacts.length - selectedContactIds.length})
            </button>
          </div>
        </div>

        {preview ? (
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <Metric label="Linhas" value={preview.summary.totalRows} />
              <Metric label="Válidos" value={preview.summary.valid} tone="good" />
              <Metric label="Inválidos" value={preview.summary.invalid} tone="warn" />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                className="primary-button"
                disabled={!preview.validContacts.length || busy === "import"}
                onClick={onImport}
                type="button"
              >
                {busy === "import" ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />}
                Importar válidos
              </button>
            </div>
          </div>
        ) : null}

        <div className="max-h-[520px] overflow-auto">
          {contacts.length === 0 ? (
            <EmptyState icon={ContactRound} title="Sem contactos" />
          ) : filteredContacts.length === 0 ? (
            <EmptyState icon={Search} title="Nenhum contacto correspondente" />
          ) : (
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="table-heading">
                  <th className="w-12 px-4 py-3">
                    <span className="sr-only">Selecionar</span>
                  </th>
                  <th className="px-4 py-3">Nome</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Empresa</th>
                  <th className="px-4 py-3">Criado</th>
                </tr>
              </thead>
              <tbody>
                {filteredContacts.map((contact) => (
                  <tr key={contact.id} className="border-t border-slate-100">
                    <td className="px-4 py-3">
                      <input
                        className="h-4 w-4 rounded border-slate-300 text-pine focus:ring-pine"
                        checked={selectedContactIds.includes(contact.id)}
                        onChange={() => onToggleContact(contact.id)}
                        type="checkbox"
                      />
                    </td>
                    <td className="px-4 py-3 font-medium">{contact.name}</td>
                    <td className="px-4 py-3 text-slate-600">{contact.email}</td>
                    <td className="px-4 py-3 text-slate-600">{contact.company || "-"}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(contact.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <aside className="panel h-fit overflow-hidden">
        <PanelHeader title="Preview CSV" />
        {busy === "preview" ? (
          <LoadingBlock label="A analisar CSV" />
        ) : preview ? (
          <div className="divide-y divide-slate-100">
            <PreviewRows title="Válidos" rows={preview.validContacts.slice(0, 6)} type="valid" />
            <PreviewRows title="Inválidos" rows={preview.invalidRows.slice(0, 8)} type="invalid" />
          </div>
        ) : (
          <EmptyState icon={Upload} title="CSV por analisar" />
        )}
        <div className="flex gap-2 border-t border-slate-200 p-4">
          <button className="secondary-button flex-1" onClick={onSelectAll} disabled={contacts.length === 0} type="button">
            Todos
          </button>
          <button className="secondary-button flex-1" onClick={onSelectNone} disabled={contacts.length === 0} type="button">
            Nenhum
          </button>
        </div>
      </aside>
    </div>
  );
}

function TemplateStep({
  busy,
  templates,
  templateForm,
  renderedPreview,
  onSelect,
  onChange,
  onNew,
  onSave,
  onDelete,
  onPreview
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="panel h-fit overflow-hidden">
        <PanelHeader
          title="Modelos"
          action={
            <button className="secondary-button" onClick={onNew} type="button" title="Novo template">
              <Plus size={16} aria-hidden="true" />
              Novo
            </button>
          }
        />
        <div className="max-h-[520px] overflow-auto">
          {templates.length === 0 ? (
            <EmptyState icon={FileText} title="Sem modelos" />
          ) : (
            <div className="divide-y divide-slate-100">
              {templates.map((template) => (
                <button
                  key={template.id}
                  className={`focus-ring block w-full px-4 py-3 text-left transition ${
                    template.id === templateForm.id ? "bg-teal-50" : "hover:bg-slate-50"
                  }`}
                  onClick={() => onSelect(template)}
                  type="button"
                >
                  <div className="font-semibold">{template.name}</div>
                  <div className="truncate text-sm text-slate-500">{template.subject}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="panel overflow-hidden">
          <PanelHeader
            title="Editor"
            action={
              <div className="flex flex-wrap gap-2">
                <button className="secondary-button" onClick={onPreview} disabled={busy === "templatePreview"} type="button">
                  {busy === "templatePreview" ? <Loader2 className="animate-spin" size={16} /> : <Eye size={16} />}
                  Preview
                </button>
                <button className="primary-button" onClick={onSave} disabled={busy === "template"} type="button">
                  {busy === "template" ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                  Guardar
                </button>
                <button className="danger-button" onClick={onDelete} disabled={!templateForm.id || busy === "templateDelete"} type="button">
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
            }
          />
          <div className="grid gap-4 p-4">
            <Field label="Nome">
              <input
                className="field"
                value={templateForm.name}
                onChange={(event) => onChange({ ...templateForm, name: event.target.value })}
              />
            </Field>
            <Field label="Assunto">
              <input
                className="field"
                value={templateForm.subject}
                onChange={(event) => onChange({ ...templateForm, subject: event.target.value })}
              />
            </Field>
            <Field label="Texto">
              <textarea
                className="field min-h-44 resize-y"
                value={templateForm.body_text}
                onChange={(event) => onChange({ ...templateForm, body_text: event.target.value })}
              />
            </Field>
            <Field label="HTML">
              <textarea
                className="field min-h-44 resize-y font-mono text-xs"
                value={templateForm.body_html}
                onChange={(event) => onChange({ ...templateForm, body_html: event.target.value })}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              {["{{name}}", "{{email}}", "{{company}}"].map((variable) => (
                <code key={variable} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs">
                  {variable}
                </code>
              ))}
            </div>
          </div>
        </div>

        <aside className="panel h-fit overflow-hidden">
          <PanelHeader title="Email renderizado" />
          {renderedPreview ? (
            <div className="p-4">
              <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold">
                {renderedPreview.subject}
              </div>
              {renderedPreview.html ? (
                <div
                  className="prose prose-sm max-w-none rounded-md border border-slate-200 p-3"
                  dangerouslySetInnerHTML={{ __html: renderedPreview.html }}
                />
              ) : (
                <pre className="whitespace-pre-wrap rounded-md border border-slate-200 p-3 text-sm">
                  {renderedPreview.text}
                </pre>
              )}
            </div>
          ) : (
            <EmptyState icon={Eye} title="Sem preview" />
          )}
        </aside>
      </section>
    </div>
  );
}

function SmtpStep({ busy, smtpForm, smtpSettings, onChange, onSave, onTest }) {
  return (
    <section className="panel overflow-hidden">
      <PanelHeader
        title="Configuração SMTP"
        action={
          smtpSettings ? (
            <Badge tone="good" icon={ShieldCheck}>
              Guardado
            </Badge>
          ) : (
            <Badge tone="warn" icon={AlertCircle}>
              Pendente
            </Badge>
          )
        }
      />
      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <Field label="SMTP Host">
          <input
            className="field"
            value={smtpForm.host}
            onChange={(event) => onChange({ ...smtpForm, host: event.target.value })}
            placeholder="smtp.exemplo.com"
          />
        </Field>
        <Field label="Porta">
          <input
            className="field"
            type="number"
            min="1"
            value={smtpForm.port}
            onChange={(event) => onChange({ ...smtpForm, port: event.target.value })}
          />
        </Field>
        <Field label="Email remetente">
          <input
            className="field"
            value={smtpForm.from_email}
            onChange={(event) => onChange({ ...smtpForm, from_email: event.target.value })}
            placeholder="nome@dominio.com"
          />
        </Field>
        <Field label="Password / App Password">
          <input
            className="field"
            type="password"
            value={smtpForm.password}
            onChange={(event) => onChange({ ...smtpForm, password: event.target.value })}
            placeholder={smtpSettings?.hasPassword ? "Password já guardada" : ""}
          />
        </Field>
        <Field label="Emails por minuto">
          <input
            className="field"
            type="number"
            min="1"
            max="60"
            value={smtpForm.max_per_minute}
            onChange={(event) => onChange({ ...smtpForm, max_per_minute: event.target.value })}
          />
        </Field>
        <div className="flex items-end">
          <label className="flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700">
            <input
              className="h-4 w-4 rounded border-slate-300 text-pine focus:ring-pine"
              checked={Boolean(smtpForm.secure)}
              onChange={(event) => onChange({ ...smtpForm, secure: event.target.checked })}
              type="checkbox"
            />
            SSL/TLS
          </label>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-slate-200 p-4">
        <button className="primary-button" onClick={onSave} disabled={busy === "smtp"} type="button">
          {busy === "smtp" ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
          Guardar
        </button>
        <button className="secondary-button" onClick={onTest} disabled={busy === "smtpTest"} type="button">
          {busy === "smtpTest" ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
          Testar ligação
        </button>
      </div>
    </section>
  );
}

function SendStep({
  busy,
  contacts,
  filteredContacts,
  templates,
  selectedContacts,
  selectedContactIds,
  selectedTemplateId,
  smtpSettings,
  campaignForm,
  campaigns,
  selectedCampaign,
  onTemplateSelect,
  onCampaignChange,
  onSend,
  onToggleContact,
  onSelectAll,
  onSelectNone,
  onOpenCampaign,
  onRefreshCampaigns,
  sendSearch,
  setSendSearch
}) {
  const canSend = contacts.length > 0 && templates.length > 0 && smtpSettings;
  const totalSent = campaigns.reduce((total, campaign) => total + Number(campaign.sent || 0), 0);
  const totalFailed = campaigns.reduce((total, campaign) => total + Number(campaign.failed || 0), 0);
  const totalQueued = campaigns.reduce((total, campaign) => total + Number(campaign.queued || 0), 0);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
      <section className="panel overflow-hidden">
        <PanelHeader title="Envio" />
        <div className="grid gap-4 p-4 lg:grid-cols-2">
          <Field label="Campanha">
            <input
              className="field"
              value={campaignForm.name}
              onChange={(event) => onCampaignChange({ ...campaignForm, name: event.target.value })}
              placeholder="Campanha sem nome"
            />
          </Field>
          <Field label="Template">
            <select
              className="field"
              value={selectedTemplateId}
              onChange={(event) => onTemplateSelect(event.target.value)}
            >
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Modo">
            <div className="grid grid-cols-2 gap-2">
              <button
                className={`secondary-button ${campaignForm.sendMode === "now" ? "border-pine text-pine" : ""}`}
                onClick={() => onCampaignChange({ ...campaignForm, sendMode: "now" })}
                type="button"
              >
                <Play size={16} aria-hidden="true" />
                Agora
              </button>
              <button
                className={`secondary-button ${campaignForm.sendMode === "scheduled" ? "border-pine text-pine" : ""}`}
                onClick={() => onCampaignChange({ ...campaignForm, sendMode: "scheduled" })}
                type="button"
              >
                <CalendarClock size={16} aria-hidden="true" />
                Agendar
              </button>
            </div>
          </Field>

          <Field label="Data/hora">
            <input
              className="field"
              type="datetime-local"
              disabled={campaignForm.sendMode !== "scheduled"}
              value={campaignForm.scheduledAt}
              onChange={(event) => onCampaignChange({ ...campaignForm, scheduledAt: event.target.value })}
            />
          </Field>

          <Field label="Intervalo entre emails">
            <div className="flex items-center gap-2">
              <Clock3 className="text-slate-400" size={18} aria-hidden="true" />
              <input
                className="field"
                type="number"
                min="1"
                value={campaignForm.intervalSeconds}
                onChange={(event) => onCampaignChange({ ...campaignForm, intervalSeconds: event.target.value })}
              />
              <span className="text-sm text-slate-500">seg</span>
            </div>
          </Field>

          <Field label="Limite por minuto">
            <input
              className="field"
              type="number"
              min="1"
              max={smtpSettings?.max_per_minute || 60}
              value={campaignForm.maxPerMinute}
              onChange={(event) => onCampaignChange({ ...campaignForm, maxPerMinute: event.target.value })}
            />
          </Field>
        </div>

        <div className="border-y border-slate-200 bg-slate-50 px-4 py-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">Lista selecionada</div>
              <div className="text-sm text-slate-500">{selectedContacts.length} de {contacts.length} contactos</div>
            </div>
            <div className="flex gap-2">
              <button className="secondary-button" onClick={onSelectAll} disabled={contacts.length === 0} type="button">
                Todos
              </button>
              <button className="secondary-button" onClick={onSelectNone} disabled={contacts.length === 0} type="button">
                Nenhum
              </button>
            </div>
          </div>

          <div className="relative mb-3">
            <input
              type="text"
              className="field pl-9 !py-1.5 text-xs"
              placeholder="Pesquisar nesta lista..."
              value={sendSearch}
              onChange={(e) => setSendSearch(e.target.value)}
            />
            <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-slate-400">
              <Search size={14} />
            </div>
          </div>

          <div className="max-h-52 overflow-auto rounded-md border border-slate-200 bg-white">
            {contacts.length === 0 ? (
              <EmptyState icon={ContactRound} title="Sem contactos" compact />
            ) : filteredContacts.length === 0 ? (
              <EmptyState icon={Search} title="Nenhum contacto correspondente" compact />
            ) : (
              <div className="divide-y divide-slate-100">
                {filteredContacts.map((contact) => (
                  <label key={contact.id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                    <input
                      className="h-4 w-4 rounded border-slate-300 text-pine focus:ring-pine"
                      checked={selectedContactIds.includes(contact.id)}
                      onChange={() => onToggleContact(contact.id)}
                      type="checkbox"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{contact.name}</span>
                      <span className="block truncate text-slate-500">{contact.email}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-center gap-2 text-sm font-semibold cursor-pointer">
            <input
              className="h-4 w-4 rounded border-slate-300 text-pine focus:ring-pine"
              checked={Boolean(campaignForm.confirm)}
              onChange={(event) => onCampaignChange({ ...campaignForm, confirm: event.target.checked })}
              type="checkbox"
            />
            Confirmo o envio
          </label>
          <button className="primary-button" onClick={onSend} disabled={!canSend || busy === "campaign"} type="button">
            {busy === "campaign" ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
            Enviar
          </button>
        </div>
      </section>

      <aside className="grid gap-4">
        <section className="panel overflow-hidden">
          <PanelHeader
            title="Monitorização"
            action={
              <button className="secondary-button" onClick={onRefreshCampaigns} type="button" title="Atualizar">
                <RefreshCw size={16} aria-hidden="true" />
              </button>
            }
          />
          <div className="grid grid-cols-3 gap-2 p-4">
            <Metric label="Enviados" value={totalSent} tone="good" />
            <Metric label="Falhados" value={totalFailed} tone="bad" />
            <Metric label="Em fila" value={totalQueued} tone="warn" />
          </div>

          {selectedCampaign ? (
            <div className="border-t border-slate-200 p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{selectedCampaign.name}</div>
                  <div className="text-sm text-slate-500">{formatDate(selectedCampaign.created_at)}</div>
                </div>
                <StatusPill status={selectedCampaign.status} />
              </div>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <Metric label="Total" value={selectedCampaign.total} />
                <Metric label="OK" value={selectedCampaign.sent} tone="good" />
                <Metric label="Erro" value={selectedCampaign.failed} tone="bad" />
              </div>
              {selectedCampaign.logs?.length ? (
                <div className="mt-3 max-h-40 overflow-auto rounded-md border border-slate-200">
                  {selectedCampaign.logs.map((log) => (
                    <div key={log.id} className="border-b border-slate-100 px-3 py-2 text-xs last:border-b-0">
                      <div className="font-semibold text-red-700">{log.level}</div>
                      <div className="text-slate-600">{log.message}</div>
                      <div className="mt-1 text-slate-400">{formatDate(log.created_at)}</div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <EmptyState icon={Send} title="Sem campanhas" />
          )}
        </section>

        <section className="panel overflow-hidden">
          <PanelHeader title="Histórico" />
          <div className="max-h-80 overflow-auto">
            {campaigns.length === 0 ? (
              <EmptyState icon={FileText} title="Sem histórico" compact />
            ) : (
              <div className="divide-y divide-slate-100">
                {campaigns.map((campaign) => (
                  <button
                    key={campaign.id}
                    className="focus-ring block w-full px-4 py-3 text-left hover:bg-slate-50"
                    onClick={() => onOpenCampaign(campaign.id)}
                    type="button"
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="truncate font-semibold">{campaign.name}</span>
                      <StatusPill status={campaign.status} />
                    </div>
                    <div className="text-sm text-slate-500">
                      {campaign.template_name} · {campaign.sent}/{campaign.total}
                    </div>
                    <div className="text-xs text-slate-400">{formatDate(campaign.created_at)}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
      </aside>
    </div>
  );
}

function PanelHeader({ title, action }) {
  return (
    <div className="flex min-h-16 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
      <h2 className="text-base font-bold">{title}</h2>
      {action}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="grid gap-1">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

function Metric({ label, value, tone = "neutral" }) {
  const tones = {
    neutral: "text-ink",
    good: "text-pine",
    warn: "text-amberline",
    bad: "text-coral"
  };

  return (
    <div className="metric">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-lg font-bold ${tones[tone]}`}>{value}</div>
    </div>
  );
}

function Badge({ tone = "neutral", icon: Icon, children }) {
  const classes = {
    neutral: "border-slate-200 bg-slate-50 text-slate-700",
    good: "border-emerald-200 bg-emerald-50 text-emerald-700",
    warn: "border-amber-200 bg-amber-50 text-amber-700",
    bad: "border-red-200 bg-red-50 text-red-700"
  };

  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold ${classes[tone]}`}>
      {Icon ? <Icon size={14} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

function StatusPill({ status }) {
  const tone = status === "completed"
    ? "good"
    : status === "failed" || status === "completed_with_errors"
      ? "bad"
      : status === "queued" || status === "scheduled"
        ? "warn"
        : "neutral";

  return <Badge tone={tone}>{statusLabel(status)}</Badge>;
}

function EmptyState({ icon: Icon, title, compact = false }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 text-slate-400 ${compact ? "py-8" : "min-h-48 py-10"}`}>
      <Icon size={24} aria-hidden="true" />
      <div className="text-sm font-semibold">{title}</div>
    </div>
  );
}

function LoadingBlock({ label }) {
  return (
    <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-slate-500">
      <Loader2 className="animate-spin text-pine" size={18} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

function PreviewRows({ title, rows, type }) {
  return (
    <div className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-bold">{title}</span>
        <Badge tone={type === "valid" ? "good" : "bad"}>{rows.length}</Badge>
      </div>
      {rows.length === 0 ? (
        <div className="text-sm text-slate-400">-</div>
      ) : (
        <div className="space-y-2">
          {rows.map((row, index) => (
            <div key={`${row.email || row.row}-${index}`} className="rounded-md border border-slate-200 bg-white p-2 text-sm">
              <div className="font-semibold">{row.name || `Linha ${row.row}`}</div>
              <div className="break-all text-slate-500">{row.email || "-"}</div>
              {row.company ? <div className="text-slate-500">{row.company}</div> : null}
              {row.errors?.length ? (
                <div className="mt-1 text-xs text-red-700">{row.errors.join(", ")}</div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AddContactModal({ isOpen, onClose, onSave, showNotice }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  if (!isOpen) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMsg("O nome é obrigatório.");
      return;
    }
    if (!email.trim()) {
      setErrorMsg("O e-mail é obrigatório.");
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    try {
      const data = await api("/api/contacts", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          company: company.trim()
        })
      });

      await onSave(data.contact);
      setName("");
      setEmail("");
      setCompany("");
      onClose();
      showNotice("success", "Contacto adicionado com sucesso!");
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
    >
      <div className="panel w-full max-w-md overflow-hidden bg-white shadow-soft animate-in zoom-in-95 duration-200">
        <PanelHeader 
          title="Adicionar Contacto" 
          action={
            <button 
              type="button" 
              className="text-slate-400 hover:text-slate-600 focus-ring rounded-md p-1"
              onClick={onClose}
              disabled={saving}
            >
              <XCircle size={20} />
            </button>
          } 
        />
        <form onSubmit={handleSubmit} className="p-4 grid gap-4">
          {errorMsg && (
            <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <AlertCircle size={16} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <Field label="Nome">
            <input
              type="text"
              className="field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Maria Santos"
              required
              disabled={saving}
            />
          </Field>

          <Field label="Email">
            <input
              type="email"
              className="field"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Ex: maria.santos@empresa.com"
              required
              disabled={saving}
            />
          </Field>

          <Field label="Empresa">
            <input
              type="text"
              className="field"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Ex: Empresa Exemplo (Opcional)"
              disabled={saving}
            />
          </Field>

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 mt-2">
            <button
              type="button"
              className="secondary-button"
              onClick={onClose}
              disabled={saving}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="primary-button"
              disabled={saving}
            >
              {saving ? (
                <>
                  <Loader2 className="animate-spin" size={16} />
                  A guardar...
                </>
              ) : (
                <>
                  <Save size={16} />
                  Guardar
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

