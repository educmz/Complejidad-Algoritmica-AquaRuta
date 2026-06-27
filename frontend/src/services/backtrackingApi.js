import { apiRequest } from "./apiClient";

export async function runBacktrackingExploration(request, options = {}) {
  const payload = await apiRequest("/local-exploration/backtracking", {
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    fallbackError: "No se pudo evaluar la secuencia.",
    body: {
      originId: request.originId,
      destinationIds: request.destinationIds || [],
      criterion: request.criterion || "distancia",
      constraints: request.constraints || {},
      maxExactNodes: request.maxExactNodes || 10,
    },
  });
  if (!Array.isArray(payload?.sequence) || !Array.isArray(payload?.edges)) {
    throw new Error("El backend devolvio una secuencia Backtracking incompleta.");
  }
  return payload;
}
