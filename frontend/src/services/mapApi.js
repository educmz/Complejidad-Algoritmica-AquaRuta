const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const REQUEST_TIMEOUT_MS = 20000;
const routeMemoryCache = new Map();

function routeCacheKey(coordinates, options = {}) {
  return JSON.stringify({
    coordinates,
    alternativeRoutes: options.alternativeRoutes || null,
    source: options.source || "",
    target: options.target || "",
  });
}

function withTimeout(signal, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort();
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return { signal: controller.signal, timeoutId };
}

export async function fetchRouteGeoJson(coordinates, options = {}) {
  const cacheKey = routeCacheKey(coordinates, options);
  if (routeMemoryCache.has(cacheKey)) {
    return routeMemoryCache.get(cacheKey);
  }

  const { signal, timeoutId } = withTimeout(options.signal, options.timeoutMs);
  const response = await fetch(`${API_BASE_URL}/route`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      coordinates,
      ...(options.source ? { source: options.source } : {}),
      ...(options.target ? { target: options.target } : {}),
      ...(options.alternativeRoutes
        ? { alternative_routes: options.alternativeRoutes }
        : {}),
    }),
  }).finally(() => window.clearTimeout(timeoutId));

  if (!response.ok) {
    let detail = "No se pudo obtener la ruta real";
    try {
      const payload = await response.json();
      detail = payload?.detail || detail;
    } catch {
      // Mantiene el mensaje generico si el backend no devuelve JSON.
    }

    const error = new Error(detail);
    error.status = response.status;
    error.retryAfter = response.headers.get("Retry-After");
    throw error;
  }

  const payload = await response.json();
  routeMemoryCache.set(cacheKey, payload);
  return payload;
}

export async function fetchRouteGeoJsonBatch(routes, options = {}) {
  const { signal, timeoutId } = withTimeout(options.signal, options.timeoutMs);
  const response = await fetch(`${API_BASE_URL}/routes-batch`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      routes: routes.map((route) => ({
        coordinates: route.coordinates,
        ...(route.source ? { source: route.source } : {}),
        ...(route.target ? { target: route.target } : {}),
        ...(route.alternativeRoutes
          ? { alternative_routes: route.alternativeRoutes }
          : {}),
      })),
    }),
  }).finally(() => window.clearTimeout(timeoutId));

  if (!response.ok) {
    let detail = "No se pudieron obtener las rutas reales";
    try {
      const payload = await response.json();
      detail = payload?.detail || detail;
    } catch {
      // Mantiene el mensaje generico si el backend no devuelve JSON.
    }

    const error = new Error(detail);
    error.status = response.status;
    error.retryAfter = response.headers.get("Retry-After");
    throw error;
  }

  return response.json();
}
