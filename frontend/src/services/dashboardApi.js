import { apiRequest } from "./apiClient.js";

function appendFilter(params, key, value) {
  if (value && value !== "todos") params.set(key, value);
}

export async function fetchDashboard(filters = {}, options = {}) {
  const params = new URLSearchParams();
  appendFilter(params, "eps", filters.eps);
  appendFilter(params, "departamento", filters.departamento);
  appendFilter(params, "provincia", filters.provincia);
  appendFilter(params, "distrito", filters.distrito);
  appendFilter(params, "grupo", filters.grupo);

  const query = params.toString();
  const payload = await apiRequest(`/dashboard${query ? `?${query}` : ""}`, {
    method: "GET",
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    fallbackError: "No se pudieron cargar los indicadores del dashboard.",
  });

  if (!Array.isArray(payload?.districts) || !Array.isArray(payload?.groupedZones)) {
    throw new Error("El backend devolvio indicadores incompletos.");
  }

  return payload;
}
