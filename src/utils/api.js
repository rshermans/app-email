export async function api(path, options = {}) {
  const headers = options.body instanceof FormData
    ? options.headers || {}
    : { "Content-Type": "application/json", ...(options.headers || {}) };

  const response = await fetch(path, {
    ...options,
    headers
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "Pedido falhou");
  }

  return payload;
}

export function statusLabel(status) {
  const labels = {
    queued: "Em fila",
    scheduled: "Agendada",
    running: "A enviar",
    completed: "Concluída",
    completed_with_errors: "Concluída com falhas",
    failed: "Falhou"
  };

  return labels[status] || status;
}

export function formatDate(value) {
  if (!value) return "-";

  return new Intl.DateTimeFormat("pt-PT", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}
