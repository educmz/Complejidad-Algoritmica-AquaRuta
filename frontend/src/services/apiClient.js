export const API_BASE_URL = (import.meta.env?.VITE_API_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
export const REQUEST_TIMEOUT_MS = 20000;

function withTimeout(signal, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  let didTimeout = false;
  const timeoutId = window.setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort();
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return { signal: controller.signal, timeoutId, didTimeout: () => didTimeout };
}

async function readJson(response, invalidMessage) {
  try {
    return await response.json();
  } catch (error) {
    throw new Error(invalidMessage || "El backend devolvio una respuesta invalida.", {
      cause: error,
    });
  }
}

function errorDetail(payload, fallback) {
  if (Array.isArray(payload?.detail)) {
    return payload.detail.map((item) => item.msg || item.message || String(item)).join(" ");
  }
  return payload?.detail || fallback;
}

export async function apiRequest(path, options = {}) {
  const {
    body,
    fallbackError = "No se pudo completar la solicitud.",
    invalidJsonError = "El backend devolvio una respuesta invalida.",
    method = "POST",
    signal: sourceSignal,
    timeoutMs,
  } = options;
  const { signal, timeoutId, didTimeout } = withTimeout(sourceSignal, timeoutMs);
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      signal,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      if (didTimeout() && !sourceSignal?.aborted) {
        const timeoutError = new Error("El backend no respondio dentro del tiempo esperado. Verifica que el servidor este iniciado.");
        timeoutError.name = "TimeoutError";
        throw timeoutError;
      }
      throw error;
    }
    throw new Error("El servidor no respondio. Revisa que el backend este en ejecucion.", {
      cause: error,
    });
  } finally {
    window.clearTimeout(timeoutId);
  }

  const payload = await readJson(response, invalidJsonError);
  if (!response.ok) {
    const error = new Error(errorDetail(payload, fallbackError), { cause: payload });
    error.status = response.status;
    error.retryAfter = response.headers.get("Retry-After");
    throw error;
  }
  return payload;
}
