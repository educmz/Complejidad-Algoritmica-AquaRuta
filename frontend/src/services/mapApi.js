const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "")

export async function fetchRouteGeoJson(coordinates, options = {}) {
  const response = await fetch(`${API_BASE_URL}/route`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      coordinates,
      ...(options.alternativeRoutes
        ? { alternative_routes: options.alternativeRoutes }
        : {}),
    }),
  });

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

  return response.json();
}

export async function fetchRouteGeoJsonBatch(routes) {
  const response = await fetch(`${API_BASE_URL}/routes-batch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      routes: routes.map((route) => ({
        coordinates: route.coordinates,
        ...(route.alternativeRoutes
          ? { alternative_routes: route.alternativeRoutes }
          : {}),
      })),
    }),
  });

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
