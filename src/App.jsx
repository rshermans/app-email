import {
  cloneElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  AlertCircle,
  Archive,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleUserRound,
  Clock3,
  Code2,
  ContactRound,
  Eye,
  FileCode2,
  FileText,
  Gauge,
  HelpCircle,
  Inbox,
  LayoutDashboard,
  Loader2,
  Mail,
  Menu,
  Monitor,
  PanelLeftClose,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  ServerCog,
  Settings,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trash2,
  Upload,
  UserPlus,
  UsersRound,
  X,
  XCircle
} from "lucide-react";
import { api, formatDate, statusLabel } from "./utils/api.js";

const navigation = [
  { id: "overview", label: "Visão geral", icon: LayoutDashboard },
  { id: "audience", label: "Público", icon: UsersRound },
  { id: "templates", label: "Templates", icon: FileCode2 },
  { id: "campaigns", label: "Campanhas", icon: Send },
  { id: "settings", label: "Definições", icon: Settings }
];

const emptyTemplate = {
  id: null,
  event_id: null,
  name: "",
  subject: "",
  body_text: "",
  body_html: ""
};

const emptyCampaign = {
  name: "",
  templateMode: "assigned",
  templateId: "",
  signature: "",
  selectedGroups: [],
  sendMode: "now",
  scheduledAt: "",
  intervalSeconds: 5,
  maxPerMinute: 30,
  confirm: false
};

function escapeMarkup(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function htmlForPreview(rendered) {
  if (rendered?.html) return rendered.html;
  return `<!doctype html><html lang="pt-PT"><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;padding:28px;color:#12212b;line-height:1.6}pre{white-space:pre-wrap;font:inherit}</style></head><body><pre>${escapeMarkup(rendered?.text)}</pre></body></html>`;
}

function participantForm(contact = null) {
  return {
    event_contact_id: contact?.event_contact_id || null,
    name: contact?.name || "",
    email: contact?.email || "",
    company: contact?.company || "",
    group_name: contact?.group_name || "",
    template_id: contact?.template_id || "",
    selected_for_email: contact?.selected_for_email ?? true,
    fieldsText: JSON.stringify(contact?.fields || {}, null, 2)
  };
}

export default function App() {
  const [view, setView] = useState("overview");
  const [events, setEvents] = useState([]);
  const [event, setEvent] = useState(null);
  const [eventId, setEventId] = useState(null);
  const [smtpSettings, setSmtpSettings] = useState(null);
  const [busy, setBusy] = useState("initial");
  const [notice, setNotice] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const announce = useCallback((type, message, details = null) => {
    setNotice({ type, message, details });
    window.clearTimeout(announce.timeout);
    announce.timeout = window.setTimeout(() => setNotice(null), 6500);
  }, []);

  const loadEvent = useCallback(async (id, quiet = false) => {
    if (!id) return;
    if (!quiet) setBusy("event");
    try {
      const data = await api(`/api/events/${id}`);
      setEvent(data.event);
      setEventId(data.event.id);
      window.localStorage.setItem("lifeinternet-mail-event", String(data.event.id));
    } catch (error) {
      announce("error", error.message);
    } finally {
      if (!quiet) setBusy("");
    }
  }, [announce]);

  const loadEvents = useCallback(async (preferredId = null) => {
    const data = await api("/api/events");
    const nextEvents = data.events || [];
    setEvents(nextEvents);
    const stored = Number(window.localStorage.getItem("lifeinternet-mail-event"));
    const nextId =
      preferredId ||
      (nextEvents.some((item) => item.id === stored) ? stored : null) ||
      nextEvents.find((item) => item.status === "active")?.id ||
      nextEvents[0]?.id;
    if (nextId) await loadEvent(nextId);
  }, [loadEvent]);

  useEffect(() => {
    async function start() {
      setBusy("initial");
      try {
        const [eventsData, smtpData] = await Promise.all([
          api("/api/events"),
          api("/api/smtp-settings")
        ]);
        const nextEvents = eventsData.events || [];
        setEvents(nextEvents);
        setSmtpSettings(smtpData.settings);
        const stored = Number(window.localStorage.getItem("lifeinternet-mail-event"));
        const nextId =
          (nextEvents.some((item) => item.id === stored) ? stored : null) ||
          nextEvents.find((item) => item.status === "active")?.id ||
          nextEvents[0]?.id;
        if (nextId) await loadEvent(nextId, true);
      } catch (error) {
        announce("error", error.message);
      } finally {
        setBusy("");
      }
    }
    start();
  }, [announce, loadEvent]);

  useEffect(() => {
    if (!eventId) return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") loadEvent(eventId, true);
    }, 7000);
    return () => window.clearInterval(timer);
  }, [eventId, loadEvent]);

  const openView = (nextView) => {
    setView(nextView);
    setMobileMenuOpen(false);
    requestAnimationFrame(() => document.querySelector("#page-title")?.focus());
  };

  async function handleEventCreated(nextEvent) {
    setCreateOpen(false);
    await loadEvents(nextEvent.id);
    setView("audience");
    announce("success", `Evento “${nextEvent.name}” criado. Agora importe o público.`);
  }

  async function refreshEverything(message) {
    await Promise.all([loadEvents(eventId), loadEvent(eventId)]);
    if (message) announce("success", message);
  }

  const readiness = [
    {
      label: "Público",
      description: `${event?.contacts?.length || 0} destinatários`,
      ready: (event?.contacts?.length || 0) > 0,
      view: "audience"
    },
    {
      label: "Templates",
      description: `${event?.templates?.length || 0} modelos`,
      ready: (event?.templates?.length || 0) > 0,
      view: "templates"
    },
    {
      label: "Servidor de envio",
      description: smtpSettings ? "Ligação guardada" : "Por configurar",
      ready: Boolean(smtpSettings),
      view: "settings"
    },
    {
      label: "Revisão e envio",
      description: "Última verificação",
      ready:
        (event?.contacts?.length || 0) > 0 &&
        (event?.templates?.length || 0) > 0 &&
        Boolean(smtpSettings),
      view: "campaigns"
    }
  ];

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Saltar para o conteúdo</a>
      <aside className={`sidebar ${mobileMenuOpen ? "sidebar-open" : ""}`}>
        <div className="brand-lockup">
          <img
            className="brand-logo"
            src="/lifeinternet-brand.png"
            alt="LifeInternet"
          />
          <div className="brand-product-line">
            <span>Mail Studio</span>
            <small>Campanhas inteligentes</small>
          </div>
          <button
            className="icon-button sidebar-mobile-close"
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Fechar menu"
          >
            <PanelLeftClose size={20} />
          </button>
        </div>

        <nav className="primary-nav" aria-label="Navegação principal">
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={view === item.id ? "nav-item nav-item-active" : "nav-item"}
                type="button"
                onClick={() => openView(item.id)}
                aria-current={view === item.id ? "page" : undefined}
              >
                <Icon size={19} aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="startup-chip">
            <Sparkles size={16} aria-hidden="true" />
            <span>A LifeInternet Startup product</span>
          </div>
          <p>Comunicação humana, organizada e responsável.</p>
        </div>
      </aside>

      {mobileMenuOpen && (
        <button
          className="sidebar-backdrop"
          type="button"
          aria-label="Fechar menu"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      <div className="workspace">
        <header className="topbar">
          <button
            className="icon-button mobile-menu-button"
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Abrir menu"
            aria-expanded={mobileMenuOpen}
          >
            <Menu size={22} />
          </button>

          <div className="event-switcher">
            <label htmlFor="event-select">Evento atual</label>
            <div className="select-wrap">
              <select
                id="event-select"
                value={eventId || ""}
                onChange={(changeEvent) => loadEvent(Number(changeEvent.target.value))}
                disabled={events.length === 0}
              >
                {events.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}{item.status === "archived" ? " — arquivado" : ""}
                  </option>
                ))}
              </select>
              <ChevronDown size={16} aria-hidden="true" />
            </div>
          </div>

          <div className="topbar-actions">
            <button className="button button-secondary" type="button" onClick={() => setCreateOpen(true)}>
              <Plus size={17} aria-hidden="true" />
              <span className="desktop-label">Novo evento</span>
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label="Ajuda sobre esta página"
              title="Ajuda"
              onClick={() => announce("info", "Comece pelo público, confirme os templates e termine em Campanhas. O Mail Studio valida tudo antes do envio.")}
            >
              <HelpCircle size={20} />
            </button>
            <div className="avatar" aria-label="Espaço de trabalho local">
              <CircleUserRound size={21} aria-hidden="true" />
            </div>
          </div>
        </header>

        <div className="live-region" aria-live="polite" aria-atomic="true">
          {notice?.message || ""}
        </div>

        <main id="main-content" className="main-content" tabIndex="-1">
          {notice && (
            <Notice notice={notice} onClose={() => setNotice(null)} />
          )}

          {busy === "initial" || busy === "event" ? (
            <LoadingState label="A preparar o seu espaço de trabalho" />
          ) : !event ? (
            <EmptyWorkspace onCreate={() => setCreateOpen(true)} />
          ) : (
            <>
              {view === "overview" && (
                <Overview
                  event={event}
                  events={events}
                  readiness={readiness}
                  onOpenView={openView}
                  onCreate={() => setCreateOpen(true)}
                  onImport={() => setImportOpen(true)}
                  onSelectEvent={loadEvent}
                />
              )}
              {view === "audience" && (
                <Audience
                  event={event}
                  onImport={() => setImportOpen(true)}
                  onRefresh={() => loadEvent(eventId)}
                  announce={announce}
                />
              )}
              {view === "templates" && (
                <TemplateStudio
                  event={event}
                  onRefresh={() => loadEvent(eventId)}
                  announce={announce}
                />
              )}
              {view === "campaigns" && (
                <Campaigns
                  event={event}
                  smtpSettings={smtpSettings}
                  onRefresh={() => loadEvent(eventId)}
                  onOpenSettings={() => openView("settings")}
                  announce={announce}
                />
              )}
              {view === "settings" && (
                <SettingsView
                  event={event}
                  smtpSettings={smtpSettings}
                  onSmtpSaved={setSmtpSettings}
                  onEventSaved={(saved) => {
                    setEvent((current) => ({ ...current, ...saved }));
                    loadEvents(saved.id);
                  }}
                  onArchived={() => loadEvents()}
                  announce={announce}
                />
              )}
            </>
          )}
        </main>
      </div>

      <CreateEventModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleEventCreated}
      />
      <ImportModal
        open={importOpen}
        event={event}
        onClose={() => setImportOpen(false)}
        onImported={async (result) => {
          setImportOpen(false);
          await refreshEverything(
            `${result.imported} novos e ${result.updated} atualizados. O público está pronto.`
          );
        }}
      />
    </div>
  );
}

function PageHeading({ eyebrow, title, description, action }) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1 id="page-title" tabIndex="-1">{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action && <div className="page-actions">{action}</div>}
    </div>
  );
}

function Overview({ event, events, readiness, onOpenView, onCreate, onImport, onSelectEvent }) {
  const delivered = event.campaigns.reduce((sum, campaign) => sum + Number(campaign.sent || 0), 0);
  const failed = event.campaigns.reduce((sum, campaign) => sum + Number(campaign.failed || 0), 0);
  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="O seu espaço de comunicação"
        title={`Olá — vamos preparar “${event.name}”?`}
        description="Todo o público, os modelos e os envios deste evento vivem aqui."
        action={
          <>
            <button className="button button-secondary" type="button" onClick={onImport}>
              <Upload size={17} aria-hidden="true" /> Importar público
            </button>
            <button className="button button-primary" type="button" onClick={() => onOpenView("campaigns")}>
              <Send size={17} aria-hidden="true" /> Preparar campanha
            </button>
          </>
        }
      />

      <section className="hero-panel" aria-labelledby="readiness-heading">
        <div className="hero-copy">
          <span className="hero-kicker"><Gauge size={17} /> Preparação do evento</span>
          <h2 id="readiness-heading">Um percurso claro até ao envio</h2>
          <p>Complete cada etapa ao seu ritmo. O Mail Studio verifica os dados antes de qualquer mensagem sair.</p>
        </div>
        <ol className="readiness-list">
          {readiness.map((item, index) => (
            <li key={item.label}>
              <button type="button" onClick={() => onOpenView(item.view)}>
                <span className={item.ready ? "step-number step-done" : "step-number"}>
                  {item.ready ? <Check size={16} aria-label="Concluído" /> : index + 1}
                </span>
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </section>

      <section className="metrics-grid" aria-label="Resumo do evento">
        <Metric icon={UsersRound} label="Destinatários" value={event.contacts.length} detail={`${event.groups.length} segmentos`} />
        <Metric icon={FileCode2} label="Templates" value={event.templates.length} detail="Modelos neste evento" />
        <Metric icon={Send} label="Entregues" value={delivered} detail={`${event.campaigns.length} campanhas`} />
        <Metric icon={AlertCircle} label="Falhas" value={failed} detail={failed ? "Requer atenção" : "Tudo tranquilo"} tone={failed ? "warning" : "good"} />
      </section>

      <div className="content-grid content-grid-two">
        <section className="panel">
          <PanelTitle title="Distribuição do público" subtitle="Pessoas por segmento" />
          {event.groups.length ? (
            <div className="segment-list">
              {event.groups.map((group) => {
                const percentage = Math.round((group.count / event.contacts.length) * 100);
                return (
                  <div className="segment-row" key={group.name}>
                    <div>
                      <strong>{group.name}</strong>
                      <span>{group.count} pessoas</span>
                    </div>
                    <div className="segment-progress" aria-label={`${percentage}% do público`}>
                      <span style={{ width: `${percentage}%` }} />
                    </div>
                    <b>{percentage}%</b>
                  </div>
                );
              })}
            </div>
          ) : (
            <FriendlyEmpty icon={ContactRound} title="Ainda não há público" text="Importe o CSV deste evento para ver os segmentos aqui." actionLabel="Importar público" onAction={onImport} />
          )}
        </section>

        <section className="panel">
          <PanelTitle title="Eventos recentes" subtitle="Continue de onde parou" action={<button className="text-button" type="button" onClick={onCreate}><Plus size={15} /> Novo</button>} />
          <div className="event-list">
            {events.slice(0, 5).map((item) => (
              <button
                className={item.id === event.id ? "event-row event-row-active" : "event-row"}
                type="button"
                key={item.id}
                onClick={() => onSelectEvent(item.id)}
              >
                <span className="event-icon"><CalendarDays size={18} /></span>
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.contact_count} pessoas · {item.template_count} modelos</small>
                </span>
                <StatusPill status={item.status} />
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function Audience({ event, onImport, onRefresh, announce }) {
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingContact, setEditingContact] = useState(null);
  const filtered = useMemo(() => event.contacts.filter((contact) => {
    const term = search.toLowerCase();
    const matchesSearch =
      !term ||
      contact.name.toLowerCase().includes(term) ||
      contact.email.toLowerCase().includes(term);
    const matchesGroup = group === "all" || (contact.group_name || "Sem grupo") === group;
    return matchesSearch && matchesGroup;
  }), [event.contacts, group, search]);
  const selectedCount = event.contacts.filter((contact) => contact.selected_for_email).length;

  function openEditor(contact = null) {
    setEditingContact(contact);
    setEditorOpen(true);
  }

  async function saveContact(values) {
    const path = values.event_contact_id
      ? `/api/events/${event.id}/contacts/${values.event_contact_id}`
      : `/api/events/${event.id}/contacts`;
    await api(path, {
      method: values.event_contact_id ? "PUT" : "POST",
      body: JSON.stringify(values)
    });
    setEditorOpen(false);
    setEditingContact(null);
    await onRefresh();
    announce("success", values.event_contact_id ? "Participante atualizado." : "Participante adicionado ao evento.");
  }

  async function assignTemplate(contact, templateId) {
    try {
      await api(`/api/events/${event.id}/contacts/${contact.event_contact_id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: contact.name,
          email: contact.email,
          company: contact.company || "",
          group_name: contact.group_name || "",
          templateId: templateId || null,
          selected_for_email: contact.selected_for_email,
          fields: contact.fields || {}
        })
      });
      await onRefresh();
      announce("success", `Modelo atualizado para ${contact.name}.`);
    } catch (error) {
      announce("error", error.message);
    }
  }

  async function toggleSelected(contact) {
    try {
      await api(`/api/events/${event.id}/contacts/${contact.event_contact_id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: contact.name,
          email: contact.email,
          company: contact.company || "",
          group_name: contact.group_name || "",
          templateId: contact.template_id || null,
          selected_for_email: !contact.selected_for_email,
          fields: contact.fields || {}
        })
      });
      await onRefresh();
      announce(
        "success",
        !contact.selected_for_email
          ? `${contact.name} será incluído no envio.`
          : `${contact.name} foi removido do envio.`
      );
    } catch (error) {
      announce("error", error.message);
    }
  }

  async function removeContact(contact) {
    if (!window.confirm(`Remover ${contact.name} deste evento?`)) return;
    try {
      await api(`/api/events/${event.id}/contacts/${contact.event_contact_id}`, {
        method: "DELETE"
      });
      await onRefresh();
      announce("success", `${contact.name} removido deste evento.`);
    } catch (error) {
      announce("error", error.message);
    }
  }

  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="Público do evento"
        title="Pessoas e segmentos"
        description={`${selectedCount} de ${event.contacts.length} participantes selecionados para envio.`}
        action={
          <>
            <button className="button button-secondary" type="button" onClick={onImport}><Upload size={17} /> Importar público</button>
            <button className="button button-primary" type="button" onClick={() => openEditor()}><UserPlus size={17} /> Adicionar participante</button>
          </>
        }
      />
      <section className="panel table-panel" aria-labelledby="audience-title">
        <div className="toolbar">
          <div className="search-field">
            <Search size={18} aria-hidden="true" />
            <label className="sr-only" htmlFor="audience-search">Pesquisar por nome ou email</label>
            <input id="audience-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Pesquisar nome ou email" />
          </div>
          <div className="toolbar-select">
            <label htmlFor="group-filter">Segmento</label>
            <select id="group-filter" value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="all">Todos</option>
              {event.groups.map((item) => <option key={item.name} value={item.name}>{item.name} ({item.count})</option>)}
            </select>
          </div>
          <span className="result-count" aria-live="polite">{filtered.length} de {event.contacts.length}</span>
        </div>
        {filtered.length ? (
          <div className="table-scroll">
            <table>
              <caption id="audience-title">Destinatários do evento {event.name}</caption>
              <thead>
                <tr>
                  <th scope="col">Envio</th>
                  <th scope="col">Pessoa</th>
                  <th scope="col">Segmento</th>
                  <th scope="col">Modelo atribuído</th>
                  <th scope="col">Dados</th>
                  <th scope="col">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((contact) => (
                  <tr className={contact.selected_for_email ? "" : "row-muted"} key={contact.event_contact_id}>
                    <td>
                      <label className="selection-toggle">
                        <input
                          type="checkbox"
                          checked={contact.selected_for_email}
                          onChange={() => toggleSelected(contact)}
                        />
                        <span>{contact.selected_for_email ? "Selecionado" : "Não enviar"}</span>
                      </label>
                    </td>
                    <td>
                      <div className="person-cell">
                        <span className="person-avatar" aria-hidden="true">{contact.name.slice(0, 1).toUpperCase()}</span>
                        <span><strong>{contact.name}</strong><small>{contact.email}</small></span>
                      </div>
                    </td>
                    <td><span className="soft-pill">{contact.group_name || "Sem grupo"}</span></td>
                    <td>
                      <label className="sr-only" htmlFor={`template-${contact.event_contact_id}`}>Modelo para {contact.name}</label>
                      <select
                        className={contact.template_id ? "inline-select" : "inline-select inline-select-warning"}
                        id={`template-${contact.event_contact_id}`}
                        value={contact.template_id || ""}
                        onChange={(e) => assignTemplate(contact, Number(e.target.value) || null)}
                      >
                        <option value="">Sem modelo</option>
                        {event.templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                      </select>
                    </td>
                    <td><span className="data-count">{Object.keys(contact.fields || {}).length} campos</span></td>
                    <td>
                      <div className="row-actions">
                        <button className="icon-button" type="button" onClick={() => openEditor(contact)} aria-label={`Editar ${contact.name}`} title="Editar">
                          <Pencil size={16} />
                        </button>
                        <button className="icon-button danger-icon" type="button" onClick={() => removeContact(contact)} aria-label={`Remover ${contact.name}`} title="Remover">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <FriendlyEmpty icon={Search} title="Nenhuma pessoa encontrada" text="Experimente alterar a pesquisa ou o segmento." />
        )}
      </section>
      <ParticipantModal
        open={editorOpen}
        event={event}
        contact={editingContact}
        onClose={() => {
          setEditorOpen(false);
          setEditingContact(null);
        }}
        onSave={saveContact}
      />
    </div>
  );
}

function ParticipantModal({ open, event, contact, onClose, onSave }) {
  const [form, setForm] = useState(participantForm(contact));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setForm(participantForm(contact));
      setError("");
    }
  }, [contact, open]);

  async function submit(eventSubmit) {
    eventSubmit.preventDefault();
    setBusy(true);
    setError("");
    try {
      let fields = {};
      if (form.fieldsText.trim()) fields = JSON.parse(form.fieldsText);
      await onSave({
        event_contact_id: form.event_contact_id,
        name: form.name,
        email: form.email,
        company: form.company,
        group_name: form.group_name,
        templateId: Number(form.template_id) || null,
        selected_for_email: form.selected_for_email,
        fields
      });
    } catch (eventError) {
      setError(eventError instanceof SyntaxError ? "Campos extra deve ser JSON válido." : eventError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={contact ? "Editar participante" : "Adicionar participante"}
      description={`Evento: ${event.name}`}
    >
      {error && <ErrorSummary message={error} />}
      <form className="form-stack" onSubmit={submit}>
        <div className="two-fields">
          <Field label="Nome" htmlFor="participant-name">
            <input id="participant-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Email" htmlFor="participant-email">
            <input id="participant-email" required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
        </div>
        <div className="two-fields">
          <Field label="Empresa" htmlFor="participant-company">
            <input id="participant-company" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
          </Field>
          <Field label="Segmento" htmlFor="participant-group">
            <input id="participant-group" list="event-groups" value={form.group_name} onChange={(e) => setForm({ ...form, group_name: e.target.value })} placeholder="Sem grupo" />
          </Field>
        </div>
        <datalist id="event-groups">
          {event.groups.map((item) => <option key={item.name} value={item.name} />)}
        </datalist>
        <Field label="Modelo atribuído" htmlFor="participant-template">
          <select id="participant-template" value={form.template_id} onChange={(e) => setForm({ ...form, template_id: e.target.value })}>
            <option value="">Sem modelo</option>
            {event.templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
          </select>
        </Field>
        <label className="checkbox-row">
          <input type="checkbox" checked={form.selected_for_email} onChange={(e) => setForm({ ...form, selected_for_email: e.target.checked })} />
          Selecionado para envio de email
        </label>
        <Field label="Campos extra" htmlFor="participant-fields" hint='JSON opcional para variáveis dos templates, por exemplo {"CURSO":"IA"}.'>
          <textarea className="code-input" id="participant-fields" rows="5" value={form.fieldsText} onChange={(e) => setForm({ ...form, fieldsText: e.target.value })} />
        </Field>
        <div className="modal-actions">
          <button className="button button-secondary" type="button" onClick={onClose}>Cancelar</button>
          <button className="button button-primary" type="submit" disabled={busy}>{busy ? <Loader2 className="spin" size={17} /> : <Save size={17} />} Guardar</button>
        </div>
      </form>
    </Modal>
  );
}

function TemplateStudio({ event, onRefresh, announce }) {
  const [form, setForm] = useState(emptyTemplate);
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [selectedContactId, setSelectedContactId] = useState(event.contacts[0]?.event_contact_id || "");
  const [device, setDevice] = useState("desktop");
  const [mobileTab, setMobileTab] = useState("editor");
  const [activeField, setActiveField] = useState("body_html");
  const [saving, setSaving] = useState(false);

  const selectTemplate = useCallback((template, force = false) => {
    if (!force && dirty && !window.confirm("Há alterações por guardar. Quer descartá-las?")) return;
    setForm(template ? {
      id: template.id,
      event_id: template.event_id,
      name: template.name,
      subject: template.subject,
      body_text: template.body_text,
      body_html: template.body_html || ""
    } : { ...emptyTemplate, event_id: event.id });
    setDirty(false);
  }, [dirty, event.id]);

  useEffect(() => {
    const currentStillExists = event.templates.find((template) => template.id === form.id);
    if (!form.id && event.templates[0]) selectTemplate(event.templates[0], true);
    else if (form.id && !currentStillExists) selectTemplate(event.templates[0] || null, true);
  }, [event.templates]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const warn = (eventBeforeUnload) => {
      if (dirty) {
        eventBeforeUnload.preventDefault();
        eventBeforeUnload.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    if (!form.subject && !form.body_text && !form.body_html) {
      setPreview(null);
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setPreviewBusy(true);
      try {
        const data = await api("/api/templates/preview", {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify({
            ...form,
            eventId: event.id,
            eventContactId: Number(selectedContactId) || null
          })
        });
        setPreview(data);
      } catch (error) {
        if (error.name !== "AbortError") announce("error", error.message);
      } finally {
        setPreviewBusy(false);
      }
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [announce, event.id, form, selectedContactId]);

  const update = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setDirty(true);
  };

  async function save() {
    setSaving(true);
    try {
      const method = form.id ? "PUT" : "POST";
      const path = form.id ? `/api/templates/${form.id}` : "/api/templates";
      const data = await api(path, {
        method,
        body: JSON.stringify({ ...form, eventId: event.id })
      });
      await onRefresh();
      selectTemplate(data.template, true);
      announce("success", "Template guardado.");
    } catch (error) {
      announce("error", error.message);
    } finally {
      setSaving(false);
    }
  }

  async function importHtml(files) {
    if (!files?.length) return;
    const data = new FormData();
    [...files].forEach((file) => data.append("templates", file));
    try {
      await api(`/api/events/${event.id}/templates/import`, { method: "POST", body: data });
      await onRefresh();
      announce("success", `${files.length} ficheiro(s) HTML importado(s).`);
    } catch (error) {
      announce("error", error.message);
    }
  }

  function insertVariable(variable) {
    const field = activeField || "body_html";
    const separator = form[field] ? " " : "";
    update(field, `${form[field] || ""}${separator}${variable}`);
  }

  const variables = preview?.variables || [
    "{{NOME}}", "{{EMAIL}}", "{{GRUPO}}", "{{ASSINATURA}}"
  ];
  const rendered = preview?.rendered;

  return (
    <div className="page-stack template-page">
      <PageHeading
        eyebrow="Estúdio visual"
        title="Templates de email"
        description="Edite o conteúdo e veja imediatamente como cada pessoa o receberá."
        action={
          <>
            <label className="button button-secondary file-button">
              <Upload size={17} aria-hidden="true" /> Importar HTML
              <input className="sr-only" type="file" accept=".html,.htm,text/html" multiple onChange={(e) => importHtml(e.target.files)} />
            </label>
            <button className="button button-primary" type="button" disabled={saving} onClick={save}>
              {saving ? <Loader2 className="spin" size={17} /> : <Save size={17} />}
              {dirty ? "Guardar alterações" : "Guardado"}
            </button>
          </>
        }
      />

      <div className="mobile-editor-tabs" role="tablist" aria-label="Área do template">
        <button role="tab" aria-selected={mobileTab === "editor"} onClick={() => setMobileTab("editor")}>Editor</button>
        <button role="tab" aria-selected={mobileTab === "preview"} onClick={() => setMobileTab("preview")}>Preview</button>
      </div>

      <div className="studio-grid">
        <aside className={`panel template-library ${mobileTab === "preview" ? "mobile-hidden" : ""}`} aria-label="Biblioteca de templates">
          <PanelTitle
            title="Biblioteca"
            subtitle={`${event.templates.length} modelos`}
            action={<button className="icon-button" type="button" onClick={() => selectTemplate(null)} aria-label="Criar template"><Plus size={18} /></button>}
          />
          <div className="template-list">
            {event.templates.map((template) => (
              <button
                type="button"
                key={template.id}
                onClick={() => selectTemplate(template)}
                className={template.id === form.id ? "template-card template-card-active" : "template-card"}
              >
                <span className="template-card-icon"><Mail size={18} /></span>
                <span><strong>{template.name}</strong><small>{template.subject}</small></span>
                {template.id === form.id && <CheckCircle2 size={17} aria-label="Selecionado" />}
              </button>
            ))}
            {!event.templates.length && (
              <FriendlyEmpty icon={FileText} title="Sem templates" text="Crie um modelo ou importe os ficheiros HTML do evento." compact />
            )}
          </div>
        </aside>

        <section className={`panel editor-panel ${mobileTab === "preview" ? "mobile-hidden" : ""}`} aria-label="Editor do template">
          <div className="editor-status">
            <span className={dirty ? "status-dot status-dot-warning" : "status-dot"} />
            {dirty ? "Alterações por guardar" : "Todas as alterações guardadas"}
          </div>
          <div className="form-stack">
            <Field label="Nome do template" htmlFor="template-name">
              <input id="template-name" value={form.name} onChange={(e) => update("name", e.target.value)} />
            </Field>
            <Field label="Assunto" htmlFor="template-subject">
              <input id="template-subject" value={form.subject} onFocus={() => setActiveField("subject")} onChange={(e) => update("subject", e.target.value)} />
            </Field>
            <div className="variable-section">
              <div><strong>Campos personalizados</strong><span>Selecione para inserir no campo ativo.</span></div>
              <div className="variable-chips">
                {variables.map((variable) => <button key={variable} type="button" onClick={() => insertVariable(variable)}>{variable}</button>)}
              </div>
            </div>
            <Field label="Versão em texto simples" htmlFor="template-text" hint="Usada quando o destinatário não permite HTML.">
              <textarea id="template-text" rows="8" value={form.body_text} onFocus={() => setActiveField("body_text")} onChange={(e) => update("body_text", e.target.value)} />
            </Field>
            <Field label="Código HTML" htmlFor="template-html" hint="O documento completo será preservado no envio.">
              <textarea className="code-input" id="template-html" rows="15" value={form.body_html} onFocus={() => setActiveField("body_html")} onChange={(e) => update("body_html", e.target.value)} />
            </Field>
          </div>
        </section>

        <aside className={`preview-column ${mobileTab === "editor" ? "preview-mobile-hidden" : ""}`} aria-label="Preview do email">
          <div className="preview-toolbar">
            <div className="device-switcher" role="group" aria-label="Tamanho do preview">
              <button className={device === "desktop" ? "active" : ""} type="button" onClick={() => setDevice("desktop")} aria-pressed={device === "desktop"}><Monitor size={17} /> Desktop</button>
              <button className={device === "mobile" ? "active" : ""} type="button" onClick={() => setDevice("mobile")} aria-pressed={device === "mobile"}><Smartphone size={17} /> Mobile</button>
            </div>
            {previewBusy && <span className="preview-loading"><Loader2 className="spin" size={15} /> A atualizar</span>}
          </div>
          <div className="recipient-picker">
            <label htmlFor="preview-person">Ver como será recebido por</label>
            <select id="preview-person" value={selectedContactId} onChange={(e) => setSelectedContactId(e.target.value)}>
              {event.contacts.map((contact) => <option key={contact.event_contact_id} value={contact.event_contact_id}>{contact.name}</option>)}
              {!event.contacts.length && <option value="">Destinatário de exemplo</option>}
            </select>
          </div>
          {rendered?.missingVariables?.length > 0 && (
            <div className="inline-warning" role="status">
              <AlertCircle size={17} aria-hidden="true" />
              <span><strong>Campos em falta:</strong> {rendered.missingVariables.join(", ")}</span>
            </div>
          )}
          <div className="mail-client">
            <div className="mail-client-header">
              <span className="mail-avatar" aria-hidden="true">LI</span>
              <div>
                <strong>{smtpLabel(event)}</strong>
                <span>para {event.contacts.find((item) => item.event_contact_id === Number(selectedContactId))?.email || "destinatario@exemplo.org"}</span>
              </div>
            </div>
            <div className="mail-subject">{rendered?.subject || form.subject || "O assunto aparecerá aqui"}</div>
            <div className={`preview-stage preview-${device}`}>
              <iframe
                title={`Email renderizado em modo ${device === "desktop" ? "desktop" : "mobile"}`}
                sandbox=""
                srcDoc={htmlForPreview(rendered)}
              />
            </div>
          </div>
          <details className="text-alternative">
            <summary><Eye size={16} /> Ler alternativa em texto simples</summary>
            <pre>{rendered?.text || form.body_text || "Sem conteúdo."}</pre>
          </details>
        </aside>
      </div>
    </div>
  );
}

function Campaigns({ event, smtpSettings, onRefresh, onOpenSettings, announce }) {
  const [form, setForm] = useState({
    ...emptyCampaign,
    signature: event.default_variables?.ASSINATURA || ""
  });
  const [busy, setBusy] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState(event.campaigns[0] || null);
  const sendableContacts = event.contacts.filter((contact) => contact.selected_for_email);
  const campaignContacts = form.selectedGroups.length
    ? sendableContacts.filter((contact) => form.selectedGroups.includes(contact.group_name || "Sem grupo"))
    : sendableContacts;
  const missingAssignments = campaignContacts.filter((contact) => !contact.template_id).length;
  const availableGroups = event.groups.map((group) => group.name);
  const selectedCount = campaignContacts.length;

  const ready =
    selectedCount > 0 &&
    event.templates.length > 0 &&
    Boolean(smtpSettings) &&
    Boolean(form.signature) &&
    (form.templateMode === "single" ? Boolean(form.templateId) : missingAssignments === 0);

  const toggleGroup = (group) => {
    setForm((current) => ({
      ...current,
      selectedGroups: current.selectedGroups.includes(group)
        ? current.selectedGroups.filter((item) => item !== group)
        : [...current.selectedGroups, group]
    }));
  };

  async function createCampaign() {
    setBusy(true);
    try {
      const scheduledAt =
        form.sendMode === "scheduled" && form.scheduledAt
          ? new Date(form.scheduledAt).toISOString()
          : null;
      const data = await api("/api/campaigns", {
        method: "POST",
        body: JSON.stringify({
          eventId: event.id,
          name: form.name,
          templateMode: form.templateMode,
          templateId: Number(form.templateId) || null,
          contactIds: campaignContacts.map((contact) => contact.id),
          groups: form.selectedGroups,
          globals: { ASSINATURA: form.signature },
          scheduledAt,
          intervalSeconds: Number(form.intervalSeconds),
          maxPerMinute: Number(form.maxPerMinute),
          confirm: form.confirm
        })
      });
      setSelectedCampaign(data.campaign);
      setForm({ ...emptyCampaign, signature: form.signature });
      await onRefresh();
      announce("success", scheduledAt ? "Campanha agendada." : "Campanha colocada na fila de envio.");
    } catch (error) {
      announce("error", error.message, error.details);
    } finally {
      setBusy(false);
    }
  }

  async function openCampaign(id) {
    try {
      const data = await api(`/api/campaigns/${id}`);
      setSelectedCampaign(data.campaign);
    } catch (error) {
      announce("error", error.message);
    }
  }

  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="Campanhas"
        title="Rever e enviar"
        description="O Mail Studio valida cada pessoa e cada variável antes do envio."
      />
      <div className="campaign-layout">
        <section className="panel campaign-builder">
          <PanelTitle title="Nova campanha" subtitle={`${selectedCount} destinatários selecionados`} />
          <div className="form-stack">
            <Field label="Nome da campanha" htmlFor="campaign-name">
              <input id="campaign-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={`Comunicação — ${event.name}`} />
            </Field>
            <fieldset className="choice-fieldset">
              <legend>Como escolher o modelo</legend>
              <label className={form.templateMode === "assigned" ? "choice-card choice-card-active" : "choice-card"}>
                <input type="radio" name="template-mode" checked={form.templateMode === "assigned"} onChange={() => setForm({ ...form, templateMode: "assigned" })} />
                <span><strong>Modelo atribuído a cada pessoa</strong><small>Ideal para uma mala direta com vários grupos.</small></span>
              </label>
              <label className={form.templateMode === "single" ? "choice-card choice-card-active" : "choice-card"}>
                <input type="radio" name="template-mode" checked={form.templateMode === "single"} onChange={() => setForm({ ...form, templateMode: "single" })} />
                <span><strong>Um único modelo</strong><small>Todos recebem o mesmo template personalizado.</small></span>
              </label>
            </fieldset>
            {form.templateMode === "single" && (
              <Field label="Template" htmlFor="campaign-template">
                <select id="campaign-template" value={form.templateId} onChange={(e) => setForm({ ...form, templateId: e.target.value })}>
                  <option value="">Escolha um modelo</option>
                  {event.templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                </select>
              </Field>
            )}
            <fieldset className="group-fieldset">
              <legend>Segmentos</legend>
              <p>Sem seleção, todo o público será incluído.</p>
              <div className="group-checks">
                {availableGroups.map((group) => (
                  <label key={group}>
                    <input type="checkbox" checked={form.selectedGroups.includes(group)} onChange={() => toggleGroup(group)} />
                    <span>{group}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <Field label="Assinatura" htmlFor="campaign-signature" hint="Preenche {{ASSINATURA}} em todos os templates.">
              <input id="campaign-signature" value={form.signature} onChange={(e) => setForm({ ...form, signature: e.target.value })} />
            </Field>
            <fieldset className="inline-fieldset">
              <legend>Quando enviar</legend>
              <label><input type="radio" name="send-mode" checked={form.sendMode === "now"} onChange={() => setForm({ ...form, sendMode: "now" })} /> Enviar agora</label>
              <label><input type="radio" name="send-mode" checked={form.sendMode === "scheduled"} onChange={() => setForm({ ...form, sendMode: "scheduled" })} /> Agendar</label>
            </fieldset>
            {form.sendMode === "scheduled" && (
              <Field label="Data e hora" htmlFor="scheduled-at">
                <input id="scheduled-at" type="datetime-local" value={form.scheduledAt} onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })} />
              </Field>
            )}
            <div className="two-fields">
              <Field label="Segundos entre emails" htmlFor="interval-seconds">
                <input id="interval-seconds" type="number" min="1" max="3600" value={form.intervalSeconds} onChange={(e) => setForm({ ...form, intervalSeconds: e.target.value })} />
              </Field>
              <Field label="Máximo por minuto" htmlFor="max-per-minute">
                <input id="max-per-minute" type="number" min="1" max={smtpSettings?.max_per_minute || 60} value={form.maxPerMinute} onChange={(e) => setForm({ ...form, maxPerMinute: e.target.value })} />
              </Field>
            </div>
          </div>
        </section>

        <aside className="campaign-review">
          <section className="panel">
            <PanelTitle title="Revisão final" subtitle="Nada será enviado sem confirmação" />
            <ul className="review-list">
              <ReviewItem ready={selectedCount > 0} label={`${selectedCount} destinatários selecionados`} />
              <ReviewItem ready={event.templates.length > 0} label={`${event.templates.length} templates disponíveis`} />
              <ReviewItem ready={Boolean(smtpSettings)} label={smtpSettings ? `Servidor ${smtpSettings.from_email}` : "Servidor por configurar"} action={!smtpSettings ? onOpenSettings : null} />
              <ReviewItem ready={form.templateMode === "single" ? Boolean(form.templateId) : missingAssignments === 0} label={missingAssignments && form.templateMode === "assigned" ? `${missingAssignments} pessoas sem modelo` : "Modelos associados"} />
              <ReviewItem ready={Boolean(form.signature)} label={form.signature ? "Assinatura preenchida" : "Assinatura em falta"} />
            </ul>
            <label className="confirmation-box">
              <input type="checkbox" checked={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.checked })} />
              <span>Revisei o público, os modelos e autorizo este envio.</span>
            </label>
            <button className="button button-primary button-wide" type="button" disabled={!ready || !form.confirm || busy} onClick={createCampaign}>
              {busy ? <Loader2 className="spin" size={18} /> : form.sendMode === "scheduled" ? <Clock3 size={18} /> : <Send size={18} />}
              {form.sendMode === "scheduled" ? "Agendar campanha" : "Confirmar e enviar"}
            </button>
          </section>
        </aside>
      </div>

      <div className="content-grid content-grid-two">
        <section className="panel">
          <PanelTitle title="Histórico" subtitle="Campanhas deste evento" />
          <div className="campaign-history">
            {event.campaigns.length ? event.campaigns.map((campaign) => (
              <button key={campaign.id} type="button" onClick={() => openCampaign(campaign.id)} className={selectedCampaign?.id === campaign.id ? "campaign-row campaign-row-active" : "campaign-row"}>
                <span className="campaign-icon"><Send size={17} /></span>
                <span><strong>{campaign.name}</strong><small>{campaign.template_name} · {formatDate(campaign.created_at)}</small></span>
                <span className="campaign-count">{campaign.sent}/{campaign.total}</span>
                <StatusPill status={campaign.status} />
              </button>
            )) : <FriendlyEmpty icon={Inbox} title="Ainda não há campanhas" text="A primeira campanha aparecerá aqui depois de confirmada." compact />}
          </div>
        </section>
        <CampaignDetail campaign={selectedCampaign} />
      </div>
    </div>
  );
}

function CampaignDetail({ campaign }) {
  if (!campaign) return <section className="panel"><FriendlyEmpty icon={Eye} title="Selecione uma campanha" text="Veja os resultados e eventuais falhas." /></section>;
  const total = Number(campaign.total || 0);
  const percentage = total ? Math.round((Number(campaign.sent || 0) / total) * 100) : 0;
  return (
    <section className="panel">
      <PanelTitle title={campaign.name} subtitle={statusLabel(campaign.status)} />
      <div className="campaign-summary">
        <div className="delivery-ring" style={{ "--progress": `${percentage * 3.6}deg` }}><span>{percentage}%</span></div>
        <div>
          <strong>{campaign.sent} entregues</strong>
          <span>{campaign.failed} falhas · {campaign.queued} em fila</span>
        </div>
      </div>
      {campaign.jobs?.length > 0 && (
        <details className="job-details">
          <summary>Ver destinatários</summary>
          <ul>
            {campaign.jobs.slice(0, 40).map((job) => <li key={job.id}><span>{job.recipient_name}</span><StatusPill status={job.status} /></li>)}
          </ul>
        </details>
      )}
    </section>
  );
}

function SettingsView({ event, smtpSettings, onSmtpSaved, onEventSaved, onArchived, announce }) {
  const [eventForm, setEventForm] = useState({
    name: event.name,
    description: event.description || "",
    event_date: event.event_date || "",
    signature: event.default_variables?.ASSINATURA || ""
  });
  const [smtpForm, setSmtpForm] = useState({
    host: smtpSettings?.host || "",
    port: smtpSettings?.port || 465,
    from_email: smtpSettings?.from_email || "",
    password: "",
    secure: smtpSettings?.secure ?? true,
    max_per_minute: smtpSettings?.max_per_minute || 30
  });
  const [busy, setBusy] = useState("");

  async function saveEvent() {
    setBusy("event");
    try {
      const data = await api(`/api/events/${event.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: eventForm.name,
          description: eventForm.description,
          event_date: eventForm.event_date || null,
          default_variables: {
            ...(event.default_variables || {}),
            ASSINATURA: eventForm.signature
          }
        })
      });
      onEventSaved(data.event);
      announce("success", "Dados do evento guardados.");
    } catch (error) {
      announce("error", error.message);
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
      onSmtpSaved(data.settings);
      setSmtpForm((current) => ({ ...current, password: "" }));
      announce("success", "Servidor de envio guardado.");
    } catch (error) {
      announce("error", error.message);
    } finally {
      setBusy("");
    }
  }

  async function testSmtp() {
    setBusy("test");
    try {
      const data = await api("/api/smtp-settings/test", {
        method: "POST",
        body: JSON.stringify(smtpForm)
      });
      announce("success", data.message || "Ligação validada.");
    } catch (error) {
      announce("error", error.message);
    } finally {
      setBusy("");
    }
  }

  async function archiveEvent() {
    if (!window.confirm(`Arquivar “${event.name}”? Os dados e o histórico serão preservados.`)) return;
    try {
      await api(`/api/events/${event.id}/archive`, { method: "POST", body: "{}" });
      announce("success", "Evento arquivado. Pode continuar a consultar os dados.");
      onArchived();
    } catch (error) {
      announce("error", error.message);
    }
  }

  return (
    <div className="page-stack">
      <PageHeading eyebrow="Definições" title="Evento e servidor de envio" description="Ajuste os dados usados nos templates e a ligação de email." />
      <div className="settings-grid">
        <section className="panel settings-card">
          <PanelTitle title="Dados do evento" subtitle="Visíveis apenas neste espaço de trabalho" />
          <div className="form-stack">
            <Field label="Nome" htmlFor="settings-event-name"><input id="settings-event-name" value={eventForm.name} onChange={(e) => setEventForm({ ...eventForm, name: e.target.value })} /></Field>
            <Field label="Descrição" htmlFor="settings-event-description"><textarea id="settings-event-description" rows="4" value={eventForm.description} onChange={(e) => setEventForm({ ...eventForm, description: e.target.value })} /></Field>
            <Field label="Data" htmlFor="settings-event-date"><input id="settings-event-date" type="date" value={eventForm.event_date} onChange={(e) => setEventForm({ ...eventForm, event_date: e.target.value })} /></Field>
            <Field label="Assinatura padrão" htmlFor="settings-signature" hint="Preenche {{ASSINATURA}} automaticamente."><input id="settings-signature" value={eventForm.signature} onChange={(e) => setEventForm({ ...eventForm, signature: e.target.value })} /></Field>
            <button className="button button-primary" type="button" onClick={saveEvent} disabled={busy === "event"}>{busy === "event" ? <Loader2 className="spin" size={17} /> : <Save size={17} />} Guardar evento</button>
          </div>
        </section>

        <section className="panel settings-card">
          <PanelTitle title="Servidor de envio" subtitle="Credenciais cifradas na base local" action={smtpSettings ? <span className="secure-badge"><ShieldCheck size={16} /> Guardado</span> : null} />
          <div className="form-stack">
            <Field label="Servidor SMTP" htmlFor="smtp-host"><input id="smtp-host" value={smtpForm.host} onChange={(e) => setSmtpForm({ ...smtpForm, host: e.target.value })} placeholder="smtp.exemplo.org" /></Field>
            <div className="two-fields">
              <Field label="Porta" htmlFor="smtp-port"><input id="smtp-port" type="number" min="1" value={smtpForm.port} onChange={(e) => setSmtpForm({ ...smtpForm, port: e.target.value })} /></Field>
              <Field label="Máximo/minuto" htmlFor="smtp-limit"><input id="smtp-limit" type="number" min="1" max="60" value={smtpForm.max_per_minute} onChange={(e) => setSmtpForm({ ...smtpForm, max_per_minute: e.target.value })} /></Field>
            </div>
            <Field label="Email remetente" htmlFor="smtp-email"><input id="smtp-email" type="email" value={smtpForm.from_email} onChange={(e) => setSmtpForm({ ...smtpForm, from_email: e.target.value })} /></Field>
            <Field label="Password ou App Password" htmlFor="smtp-password" hint={smtpSettings?.hasPassword ? "Deixe vazio para manter a password guardada." : ""}><input id="smtp-password" type="password" value={smtpForm.password} onChange={(e) => setSmtpForm({ ...smtpForm, password: e.target.value })} placeholder={smtpSettings?.hasPassword ? "Password guardada" : ""} /></Field>
            <label className="checkbox-row"><input type="checkbox" checked={smtpForm.secure} onChange={(e) => setSmtpForm({ ...smtpForm, secure: e.target.checked })} /> Usar ligação segura SSL/TLS</label>
            <div className="button-row">
              <button className="button button-primary" type="button" onClick={saveSmtp} disabled={busy === "smtp"}>{busy === "smtp" ? <Loader2 className="spin" size={17} /> : <Save size={17} />} Guardar</button>
              <button className="button button-secondary" type="button" onClick={testSmtp} disabled={busy === "test"}>{busy === "test" ? <Loader2 className="spin" size={17} /> : <RefreshCw size={17} />} Testar ligação</button>
            </div>
          </div>
        </section>
      </div>
      <section className="panel danger-zone">
        <div><Archive size={20} /><span><strong>Arquivar este evento</strong><small>Oculta-o da lista principal, preservando público, templates e histórico.</small></span></div>
        <button className="button button-danger" type="button" onClick={archiveEvent}>Arquivar evento</button>
      </section>
    </div>
  );
}

function CreateEventModal({ open, onClose, onCreated }) {
  const [form, setForm] = useState({ name: "", description: "", event_date: "", signature: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(eventSubmit) {
    eventSubmit.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await api("/api/events", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          event_date: form.event_date || null,
          default_variables: { ASSINATURA: form.signature }
        })
      });
      setForm({ name: "", description: "", event_date: "", signature: "" });
      onCreated(data.event);
    } catch (eventError) {
      setError(eventError.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Criar um novo evento" description="Comece pelo contexto; o público e os modelos entram a seguir.">
      {error && <ErrorSummary message={error} />}
      <form className="form-stack" onSubmit={submit}>
        <Field label="Nome do evento" htmlFor="new-event-name"><input autoFocus id="new-event-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex.: Escrita Académica com IA — 2026" /></Field>
        <Field label="Descrição" htmlFor="new-event-description" hint="Uma frase para ajudar a equipa a reconhecer este evento."><textarea id="new-event-description" rows="3" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <div className="two-fields">
          <Field label="Data" htmlFor="new-event-date"><input id="new-event-date" type="date" value={form.event_date} onChange={(e) => setForm({ ...form, event_date: e.target.value })} /></Field>
          <Field label="Assinatura padrão" htmlFor="new-event-signature"><input id="new-event-signature" value={form.signature} onChange={(e) => setForm({ ...form, signature: e.target.value })} /></Field>
        </div>
        <div className="modal-actions">
          <button className="button button-secondary" type="button" onClick={onClose}>Cancelar</button>
          <button className="button button-primary" type="submit" disabled={busy}>{busy ? <Loader2 className="spin" size={17} /> : <Plus size={17} />} Criar evento</button>
        </div>
      </form>
    </Modal>
  );
}

function ImportModal({ open, event, onClose, onImported }) {
  const [step, setStep] = useState(1);
  const [csv, setCsv] = useState(null);
  const [htmlFiles, setHtmlFiles] = useState([]);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      setStep(1);
      setCsv(null);
      setHtmlFiles([]);
      setPreview(null);
      setError("");
    }
  }, [open]);

  async function analyse() {
    if (!csv) {
      setError("Escolha o ficheiro CSV do público.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = new FormData();
      data.append("file", csv);
      htmlFiles.forEach((file) => data.append("templates", file));
      const result = await api(`/api/events/${event.id}/import/preview`, { method: "POST", body: data });
      setPreview(result);
      setStep(3);
    } catch (eventError) {
      setError(eventError.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport() {
    setBusy(true);
    setError("");
    try {
      const result = await api(`/api/events/${event.id}/import`, {
        method: "POST",
        body: JSON.stringify({ contacts: preview.contacts, templates: preview.templates })
      });
      onImported(result);
    } catch (eventError) {
      setError(eventError.message);
    } finally {
      setBusy(false);
    }
  }

  const labels = ["Evento", "Ficheiros", "Campos", "Qualidade", "Modelos", "Confirmar"];
  return (
    <Modal open={open} onClose={onClose} title="Importar público e modelos" description={`Evento: ${event?.name || ""}`} wide>
      <ol className="import-steps" aria-label={`Passo ${step} de 6`}>
        {labels.map((label, index) => (
          <li key={label} className={index + 1 === step ? "active" : index + 1 < step ? "done" : ""}>
            <span>{index + 1 < step ? <Check size={14} /> : index + 1}</span>
            <small>{label}</small>
          </li>
        ))}
      </ol>
      {error && <ErrorSummary message={error} />}
      <div className="import-content">
        {step === 1 && (
          <div className="import-intro">
            <span className="large-icon"><CalendarDays size={30} /></span>
            <h3>{event?.name}</h3>
            <p>Os contactos serão associados a este evento. Pessoas já conhecidas não serão duplicadas.</p>
            <button className="button button-primary" type="button" onClick={() => setStep(2)}>Continuar para os ficheiros</button>
          </div>
        )}
        {step === 2 && (
          <div className="upload-grid">
            <FileDrop
              id="csv-upload"
              icon={FileText}
              title="Lista de público"
              description="CSV com NOME e EMAIL. Os restantes campos serão preservados."
              accept=".csv,text/csv"
              fileNames={csv ? [csv.name] : []}
              onFiles={(files) => setCsv(files[0] || null)}
            />
            <FileDrop
              id="html-upload"
              icon={Code2}
              title="Templates HTML"
              description="Pode selecionar vários ficheiros. MODELO_EMAIL fará a associação."
              accept=".html,.htm,text/html"
              multiple
              fileNames={htmlFiles.map((file) => file.name)}
              onFiles={(files) => setHtmlFiles([...files])}
            />
            <div className="modal-actions modal-actions-full">
              <button className="button button-secondary" type="button" onClick={() => setStep(1)}>Voltar</button>
              <button className="button button-primary" type="button" onClick={analyse} disabled={busy || !csv}>{busy ? <Loader2 className="spin" size={17} /> : <Sparkles size={17} />} Analisar ficheiros</button>
            </div>
          </div>
        )}
        {step === 3 && preview && (
          <div className="import-review">
            <h3>Campos reconhecidos</h3>
            <p>Nome e email identificam a pessoa; os restantes campos ficam disponíveis nos templates.</p>
            <div className="column-chips">{preview.columns.map((column) => <span key={column}>{column}</span>)}</div>
            <div className="mapping-cards">
              <div><strong>NOME</strong><span>Nome da pessoa</span><CheckCircle2 size={18} /></div>
              <div><strong>EMAIL</strong><span>Endereço de envio</span><CheckCircle2 size={18} /></div>
              <div><strong>GRUPO</strong><span>Segmentação</span><CheckCircle2 size={18} /></div>
              <div><strong>MODELO_EMAIL</strong><span>Template individual</span><CheckCircle2 size={18} /></div>
            </div>
            <ImportActions back={() => setStep(2)} next={() => setStep(4)} />
          </div>
        )}
        {step === 4 && preview && (
          <div className="import-review">
            <h3>Qualidade dos dados</h3>
            <div className="import-metrics">
              <Metric icon={UsersRound} label="Linhas" value={preview.summary.totalRows} detail="No ficheiro" />
              <Metric icon={CheckCircle2} label="Válidas" value={preview.summary.valid} detail="Prontas a importar" tone="good" />
              <Metric icon={RefreshCw} label="Existentes" value={preview.summary.existing} detail="Serão atualizadas" />
              <Metric icon={XCircle} label="Com erro" value={preview.summary.invalid} detail="Não serão importadas" tone={preview.summary.invalid ? "warning" : "good"} />
            </div>
            {preview.groups.length > 0 && <div className="group-summary">{preview.groups.map((group) => <span key={group.name}><strong>{group.count}</strong> {group.name}</span>)}</div>}
            {preview.invalidRows.length > 0 && (
              <details className="error-details"><summary>Ver linhas com erro</summary><ul>{preview.invalidRows.map((row) => <li key={row.row}>Linha {row.row}: {row.errors.join(", ")}</li>)}</ul></details>
            )}
            <ImportActions back={() => setStep(3)} next={() => setStep(5)} />
          </div>
        )}
        {step === 5 && preview && (
          <div className="import-review">
            <h3>Associação dos modelos</h3>
            <p>O nome em MODELO_EMAIL é comparado com os ficheiros HTML selecionados.</p>
            <div className="template-match-list">
              {[...new Set([...preview.contacts, ...preview.invalidRows].map((contact) => contact.template_key).filter(Boolean))].map((key) => {
                const contacts = [...preview.contacts, ...preview.invalidRows].filter((contact) => contact.template_key === key);
                const matched = contacts.every((contact) => contact.template_matched);
                return <div key={key}><span className={matched ? "match-icon match-good" : "match-icon match-bad"}>{matched ? <Check size={16} /> : <X size={16} />}</span><span><strong>{key}</strong><small>{contacts.length} destinatários</small></span><b>{matched ? "Associado" : "Em falta"}</b></div>;
              })}
            </div>
            <ImportActions back={() => setStep(4)} next={() => setStep(6)} />
          </div>
        )}
        {step === 6 && preview && (
          <div className="import-confirm">
            <span className="large-icon large-icon-good"><CheckCircle2 size={34} /></span>
            <h3>Pronto para importar</h3>
            <p><strong>{preview.summary.valid} pessoas</strong>, <strong>{preview.groups.length} segmentos</strong> e <strong>{preview.templates.length} templates</strong> serão guardados em {event.name}.</p>
            <p className="privacy-note"><ShieldCheck size={17} /> Os dados ficam apenas na base local da aplicação.</p>
            <div className="modal-actions modal-actions-centered">
              <button className="button button-secondary" type="button" onClick={() => setStep(5)}>Voltar</button>
              <button className="button button-primary" type="button" onClick={confirmImport} disabled={busy}>{busy ? <Loader2 className="spin" size={17} /> : <Upload size={17} />} Confirmar importação</button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Modal({ open, onClose, title, description, children, wide = false }) {
  const dialogRef = useRef(null);
  const triggerRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    triggerRef.current = document.activeElement;
    const dialog = dialogRef.current;
    const focusable = () => [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')];
    const first = focusable()[0];
    first?.focus();
    function keydown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key === "Tab") {
        const items = focusable();
        const firstItem = items[0];
        const lastItem = items.at(-1);
        if (event.shiftKey && document.activeElement === firstItem) {
          event.preventDefault();
          lastItem?.focus();
        } else if (!event.shiftKey && document.activeElement === lastItem) {
          event.preventDefault();
          firstItem?.focus();
        }
      }
    }
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      triggerRef.current?.focus?.();
    };
  }, [onClose, open]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={`modal-card ${wide ? "modal-wide" : ""}`} ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="modal-title" aria-describedby="modal-description">
        <header className="modal-header">
          <div><h2 id="modal-title">{title}</h2>{description && <p id="modal-description">{description}</p>}</div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Fechar janela"><X size={20} /></button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}

function FileDrop({ id, icon: Icon, title, description, accept, multiple, fileNames, onFiles }) {
  return (
    <label className="file-drop" htmlFor={id}>
      <span className="file-drop-icon"><Icon size={25} /></span>
      <strong>{title}</strong>
      <span>{description}</span>
      <span className="button button-secondary" aria-hidden="true">Escolher ficheiro{multiple ? "s" : ""}</span>
      <input className="sr-only" id={id} type="file" accept={accept} multiple={multiple} onChange={(e) => onFiles(e.target.files)} />
      {fileNames.length > 0 && <ul>{fileNames.map((name) => <li key={name}><CheckCircle2 size={14} /> {name}</li>)}</ul>}
    </label>
  );
}

function ImportActions({ back, next }) {
  return <div className="modal-actions modal-actions-full"><button className="button button-secondary" type="button" onClick={back}>Voltar</button><button className="button button-primary" type="button" onClick={next}>Continuar</button></div>;
}

function Metric({ icon: Icon, label, value, detail, tone = "" }) {
  return (
    <article className={`metric-card ${tone ? `metric-${tone}` : ""}`}>
      <span className="metric-icon"><Icon size={20} aria-hidden="true" /></span>
      <div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
    </article>
  );
}

function PanelTitle({ title, subtitle, action }) {
  return <header className="panel-title"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</header>;
}

function Field({ label, htmlFor, hint, children }) {
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  const child = children
    ? cloneElement(children, { "aria-describedby": hintId })
    : children;
  return <div className="field-group"><label htmlFor={htmlFor}>{label}</label>{hint && <span id={hintId}>{hint}</span>}{child}</div>;
}

function ReviewItem({ ready, label, action }) {
  return <li className={ready ? "review-ready" : "review-pending"}><span>{ready ? <Check size={15} aria-label="Pronto" /> : <AlertCircle size={16} aria-label="Pendente" />}</span><strong>{label}</strong>{action && <button type="button" onClick={action}>Configurar</button>}</li>;
}

function StatusPill({ status }) {
  const good = ["active", "completed", "sent"].includes(status);
  const bad = ["failed", "completed_with_errors"].includes(status);
  return <span className={`status-pill ${good ? "status-good" : bad ? "status-bad" : ""}`}>{good && <CheckCircle2 size={13} />}{bad && <AlertCircle size={13} />}{status === "archived" ? "Arquivado" : status === "active" ? "Ativo" : statusLabel(status)}</span>;
}

function FriendlyEmpty({ icon: Icon, title, text, actionLabel, onAction, compact = false }) {
  return <div className={`friendly-empty ${compact ? "friendly-empty-compact" : ""}`}><span><Icon size={compact ? 21 : 26} /></span><h3>{title}</h3><p>{text}</p>{actionLabel && <button className="button button-secondary" type="button" onClick={onAction}>{actionLabel}</button>}</div>;
}

function Notice({ notice, onClose }) {
  return (
    <div className={`notice ${notice.type === "error" ? "notice-error" : notice.type === "info" ? "notice-info" : "notice-success"}`} role={notice.type === "error" ? "alert" : "status"}>
      {notice.type === "error" ? <XCircle size={19} /> : notice.type === "info" ? <HelpCircle size={19} /> : <CheckCircle2 size={19} />}
      <div><strong>{notice.type === "error" ? "Não foi possível concluir" : notice.type === "info" ? "Ajuda rápida" : "Concluído"}</strong><span>{notice.message}</span>
        {notice.details?.invalidRecipients?.length > 0 && <details><summary>Ver o que precisa de atenção</summary><ul>{notice.details.invalidRecipients.slice(0, 12).map((item) => <li key={item.email}>{item.name}: {item.missing.join(", ")}</li>)}</ul></details>}
      </div>
      <button className="icon-button" type="button" onClick={onClose} aria-label="Fechar mensagem"><X size={17} /></button>
    </div>
  );
}

function ErrorSummary({ message }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, [message]);
  return <div className="error-summary" role="alert" tabIndex="-1" ref={ref}><AlertCircle size={18} /><span><strong>Verifique esta informação</strong>{message}</span></div>;
}

function LoadingState({ label }) {
  return <div className="loading-state" role="status"><Loader2 className="spin" size={30} /><span>{label}</span></div>;
}

function EmptyWorkspace({ onCreate }) {
  return <div className="empty-workspace"><img className="empty-brand-logo" src="/lifeinternet-brand.png" alt="LifeInternet" /><h1 id="page-title">Bem-vindo ao LifeInternet Mail Studio</h1><p>Crie o primeiro evento para começar a organizar o público e os emails.</p><button className="button button-primary" type="button" onClick={onCreate}><Plus size={18} /> Criar primeiro evento</button></div>;
}

function smtpLabel(event) {
  return event?.name ? `${event.name} · LifeInternet Mail Studio` : "LifeInternet Mail Studio";
}
