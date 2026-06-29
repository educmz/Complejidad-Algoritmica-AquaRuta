import { apiRequest } from "./apiClient";

export async function runSectorization(request, options = {}) {
  const payload = await apiRequest("/sectorization/run", {
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    fallbackError: "No se pudo sectorizar el grupo.",
    body: {
      groupId: request.groupId,
      group: request.group || null,
      nodeIds: request.nodeIds || null,
      maxSectorSize: request.maxSectorSize || 8,
      splitCriterion: request.splitCriterion || "geografico",
      maxDepth: request.maxDepth || 12,
    },
  });
  if (!Array.isArray(payload?.sectors) || !payload?.metadata) {
    throw new Error("El backend devolvio una sectorizacion incompleta.");
  }
  return payload;
}
