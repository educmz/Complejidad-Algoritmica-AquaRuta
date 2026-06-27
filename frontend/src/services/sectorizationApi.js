const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const REQUEST_TIMEOUT_MS = 20000;

function withTimeout(signal, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort();
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return { signal: controller.signal, timeoutId };
}

async function readJson(response) {
  try {
    return await response.json();
  } catch (error) {
    throw new Error("El backend devolvio una respuesta invalida.", { cause: error });
  }
}

export async function runSectorization(request, options = {}) {
  const { signal, timeoutId } = withTimeout(options.signal, options.timeoutMs);
  let response;
  try {
    response = await fetch(`${API_BASE_URL}/sectorization/run`, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        groupId: request.groupId,
        nodeIds: request.nodeIds || null,
        maxSectorSize: request.maxSectorSize || 8,
        splitCriterion: request.splitCriterion || "geografico",
        maxDepth: request.maxDepth || 12,
      }),
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new Error("El servidor no respondio. Revisa que el backend este en ejecucion.", {
      cause: error,
    });
  } finally {
    window.clearTimeout(timeoutId);
  }

  const payload = await readJson(response);
  if (!response.ok) {
    const detail = Array.isArray(payload?.detail)
      ? payload.detail.map((item) => item.msg || item.message || String(item)).join(" ")
      : payload?.detail;
    const error = new Error(detail || "No se pudo sectorizar el grupo.", {
      cause: payload,
    });
    error.status = response.status;
    throw error;
  }
  if (!Array.isArray(payload?.sectors) || !payload?.metadata) {
    throw new Error("El backend devolvio una sectorizacion incompleta.");
  }
  return payload;
}
