import { apiRequest } from "./apiClient";

export async function runGraphTraversal(request, options = {}) {
  const payload = await apiRequest("/local-exploration/traversal", {
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    fallbackError: "No se pudo calcular el recorrido.",
    body: {
      originId: request.originId,
      nodeIds: request.nodeIds || [],
      algorithm: request.algorithm || "bfs",
      maxNodes: request.maxNodes || 100,
      maxNeighbors: request.maxNeighbors || 4,
    },
  });
  if (!Array.isArray(payload?.order) || !Array.isArray(payload?.treeEdges)) {
    throw new Error("El backend devolvio un recorrido incompleto.");
  }
  return payload;
}
