export async function api(path, options = {}) {
  const headers = options.body instanceof FormData
    ? options.headers || {}
    : { "Content-Type": "application/json", ...(options.headers || {}) };

  const response = await fetch(path, {
    ...options,
    headers
  });

  const responseText = await response.text();
  let payload = {};
  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch {
    payload = {};
  }

  if (!response.ok) {
    const fallback = responseText && !responseText.trimStart().startsWith("<")
      ? responseText.slice(0, 300)
      : `Pedido falhou (HTTP ${response.status})`;
    const error = new Error(payload.error || fallback);
    error.details = payload.details;
    throw error;
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
