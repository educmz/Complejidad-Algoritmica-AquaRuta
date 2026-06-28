const criticalityLabels = {
  critica: "Crítica",
  alta: "Alta",
  media: "Media",
  baja: "Baja",
};

function badgeClass(level) {
  if (level === "critica") return "badge critical";
  if (level === "alta") return "badge high";
  if (level === "media") return "badge medium";
  return "badge low";
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("es-PE");
}

function formatCompact(value) {
  return new Intl.NumberFormat("es-PE", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(value) || 0);
}

function formatHours(value) {
  const hours = Number(value) || 0;
  if (hours >= 24) return `${(hours / 24).toFixed(1)} días`;
  return `${hours.toFixed(1)} horas`;
}

function formatKm(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "No calculable";
  return `${number.toFixed(1)} km`;
}

export default function TerritoryGroupSidePanel({ block, node, onSelectNode, onOpenSectorization }) {
  if (!block) {
    return (
      <aside className="territory-side-panel">
        <div className="empty-state">Selecciona un grupo para revisar sus distritos.</div>
      </aside>
    );
  }

  const selectedNode = node || block.validNodes?.[0] || block.districts?.[0] || null;
  const referenceOrigin = block.nearestOrigin || selectedNode?.nearestOrigin;
  const canSectorize = block.groupType === "sectorizable";

  return (
    <aside className="territory-side-panel">
      <div className="territory-side-header">
        <span>Distrito seleccionado</span>
        <h3>{selectedNode?.nombre || block.nombre}</h3>
        <p>
          {selectedNode
            ? `${selectedNode.provincia}, ${selectedNode.departamento}`
            : block.scopeLabel}
        </p>
      </div>

      <span className={badgeClass(selectedNode?.criticidad || block.criticidad)}>
        {criticalityLabels[selectedNode?.criticidad || block.criticidad] || block.criticidad}
      </span>

      <div className="territory-side-grid compact">
        <div>
          <span>Grupo</span>
          <strong>{block.nombre}</strong>
        </div>
        <div>
          <span>Interrupciones</span>
          <strong>{formatNumber(selectedNode?.interrupciones || block.interrupciones)}</strong>
        </div>
        <div>
          <span>Tiempo acumulado sin servicio</span>
          <strong>{formatHours(selectedNode?.duracion_maxima_horas || block.maxDurationHours)}</strong>
        </div>
        <div>
          <span>Afectaciones estimadas acumuladas</span>
          <strong>{formatCompact(selectedNode?.personas_afectadas_estimadas || block.estimatedPopulation)}</strong>
        </div>
        <div>
          <span>EPS de referencia</span>
          <strong>{referenceOrigin?.prestador || "No disponible"}</strong>
        </div>
        <div>
          <span>Distancia aproximada</span>
          <strong>{formatKm(selectedNode?.nearestOriginDistanceKm ?? block.nearestOriginDistanceKm)}</strong>
        </div>
      </div>

      <div className="territory-zone-preview expanded">
        <strong>Distritos del grupo</strong>
        <div>
          {(block.districts || []).map((district) => (
            <button
              key={district.id}
              type="button"
              className={district.id === selectedNode?.id ? "active" : ""}
              aria-pressed={district.id === selectedNode?.id}
              onClick={() => onSelectNode(district.id)}
            >
              {district.nombre}
            </button>
          ))}
        </div>
      </div>

      {canSectorize && (
        <div className="territory-action-stack compact">
          <button type="button" onClick={onOpenSectorization}>
            Ver sectorización
          </button>
        </div>
      )}
    </aside>
  );
}
