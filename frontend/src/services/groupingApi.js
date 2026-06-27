import { apiRequest } from "./apiClient";

export const DEFAULT_GROUPING_CONFIG = {
  criterio: "combinado",
  umbral_distancia_geografica_km: 18,
  umbral_distancia_vial_km: 32,
  umbral_tiempo_min: 70,
  umbral_costo: 240,
  velocidad_promedio_kmh: 28,
  factor_vial: 1.35,
  max_vecinos_candidatos: 12,
};

export async function runGrouping(request = {}, options = {}) {
  const payload = await apiRequest("/grouping/run", {
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    fallbackError: "No se pudo calcular la agrupacion operativa.",
    body: {
      filters: request.filters || {},
      config: request.config || DEFAULT_GROUPING_CONFIG,
    },
  });
  if (!Array.isArray(payload?.groups)) {
    throw new Error("El backend devolvio una agrupacion sin lista de grupos.");
  }
  return payload;
}
