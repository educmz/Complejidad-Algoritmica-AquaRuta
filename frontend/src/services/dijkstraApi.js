import { apiRequest } from "./apiClient";

export async function runDijkstraExploration(request, options = {}) {
  const payload = await apiRequest("/local-exploration/dijkstra", {
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    fallbackError: "No se pudo calcular el camino minimo.",
    body: {
      originId: request.originId,
      targetId: request.targetId,
      nodeIds: request.nodeIds || [],
      criterion: request.criterion || "distancia",
      maxNodes: request.maxNodes || 80,
      maxNeighbors: request.maxNeighbors || 4,
    },
  });
  if (!Array.isArray(payload?.path) || !Array.isArray(payload?.edges)) {
    throw new Error("El backend devolvio un camino minimo incompleto.");
  }
  return payload;
}
