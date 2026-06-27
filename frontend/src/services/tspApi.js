import { apiRequest } from "./apiClient";

export async function runTspExploration(request, options = {}) {
  const payload = await apiRequest("/local-exploration/tsp", {
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    fallbackError: "No se pudo calcular la secuencia de visita.",
    body: {
      originId: request.originId,
      destinationIds: request.destinationIds || [],
      criterion: request.criterion || "distancia",
      maxExactNodes: request.maxExactNodes || 12,
      maxDestinations: request.maxDestinations || 60,
    },
  });
  if (!Array.isArray(payload?.sequence) || !Array.isArray(payload?.edges)) {
    throw new Error("El backend devolvio una secuencia local incompleta.");
  }
  return payload;
}
