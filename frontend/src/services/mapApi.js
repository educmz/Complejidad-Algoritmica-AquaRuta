import { apiRequest } from "./apiClient";

const routeMemoryCache = new Map();

function routeCacheKey(coordinates, options = {}) {
  return JSON.stringify({
    coordinates,
    alternativeRoutes: options.alternativeRoutes || null,
    source: options.source || "",
    target: options.target || "",
  });
}

export async function fetchRouteGeoJson(coordinates, options = {}) {
  const cacheKey = routeCacheKey(coordinates, options);
  if (routeMemoryCache.has(cacheKey)) {
    return routeMemoryCache.get(cacheKey);
  }

  const payload = await apiRequest("/route", {
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    fallbackError: "No se pudo obtener la ruta real",
    body: {
      coordinates,
      ...(options.source ? { source: options.source } : {}),
      ...(options.target ? { target: options.target } : {}),
      ...(options.alternativeRoutes
        ? { alternative_routes: options.alternativeRoutes }
        : {}),
    },
  });
  routeMemoryCache.set(cacheKey, payload);
  return payload;
}

export async function fetchRouteGeoJsonBatch(routes, options = {}) {
  return apiRequest("/routes-batch", {
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    fallbackError: "No se pudieron obtener las rutas reales",
    body: {
      routes: routes.map((route) => ({
        coordinates: route.coordinates,
        ...(route.source ? { source: route.source } : {}),
        ...(route.target ? { target: route.target } : {}),
        ...(route.alternativeRoutes
          ? { alternative_routes: route.alternativeRoutes }
          : {}),
      })),
    },
  });
}
