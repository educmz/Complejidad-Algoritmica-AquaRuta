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
  if (hours >= 24) return `${(hours / 24).toFixed(1)} d`;
  return `${hours.toFixed(1)} h`;
}

export default function OperationalBlockDetail({
  block,
  onOpenCenter,
  onSendSectorization,
  onOpenRoutes,
  onOpenLocal,
  onMarkPrioritized,
}) {
  if (!block) {
    return (
      <article className="panel operational-detail-panel">
        <h3 className="panel-title">Detalle del grupo</h3>
        <div className="empty-state">
          Selecciona un grupo operativo para revisar su prioridad, cobertura y nodo sugerido.
        </div>
      </article>
    );
  }

  return (
    <article className="panel operational-detail-panel">
      <div className="operational-detail-header">
        <div>
          <h3>{block.nombre}</h3>
          <p>{block.scopeLabel}</p>
        </div>
        <span className={badgeClass(block.criticidad)}>{block.criticidad}</span>
      </div>

      <div className="operational-status-strip">
        <span>Estado operativo</span>
        <strong>{block.statusLabel}</strong>
      </div>

      <div className="operational-detail-grid">
        <div>
          <span>Zonas</span>
          <strong>{formatNumber(block.cantidad_zonas)}</strong>
        </div>
        <div>
          <span>Interrupciones</span>
          <strong>{formatNumber(block.interrupciones)}</strong>
        </div>
        <div>
          <span>Personas afectadas estimadas</span>
          <strong>{formatCompact(block.estimatedPopulation)}</strong>
        </div>
        <div>
          <span>Peso demanda familiar</span>
          <strong>{Number(block.demandWeight || 0).toFixed(3)}</strong>
        </div>
        <div>
          <span>Conexiones afectadas</span>
          <strong>{formatCompact(block.connections)}</strong>
        </div>
        <div>
          <span>Tiempo promedio</span>
          <strong>{formatHours(block.avgDurationHours)}</strong>
        </div>
        <div>
          <span>Tiempo máximo</span>
          <strong>{formatHours(block.maxDurationHours)}</strong>
        </div>
      </div>

      <div className="operational-node-card">
        <span>Nodo EPS sugerido</span>
        <strong>{block.nearestOrigin?.prestador || "No disponible"}</strong>
        <small>
          {block.nearestOrigin
            ? `${block.nearestOrigin.distrito}, ${block.nearestOrigin.provincia} - ${block.nearestOriginDistanceKm.toFixed(1)} km`
            : "Sin nodo referencial asociado"}
        </small>
      </div>

      <div className="operational-detail-grid">
        <div>
          <span>Prioridad operativa</span>
          <strong>{block.priorityLabel}</strong>
        </div>
        <div>
          <span>Capacidad sugerida</span>
          <strong>{block.suggestedCapacity}</strong>
        </div>
        <div>
          <span>Cobertura logística</span>
          <strong>{block.logisticCoverageLabel}</strong>
        </div>
        <div>
          <span>Extensión territorial</span>
          <strong>{block.spreadKm.toFixed(1)} km</strong>
        </div>
      </div>

      <div className="operational-center-card">
        <span>Referencia territorial</span>
        <strong>{block.mainDistrict?.nombre || "Zona central no disponible"}</strong>
        <small>
          Centro operativo: {block.center ? block.center.map((item) => item.toFixed(4)).join(", ") : "No disponible"}
        </small>
        <button type="button" onClick={() => onOpenCenter?.(block)}>
          Ver centro en mapa
        </button>
      </div>

      <div className="operational-critic-note">
        <strong>Criterio de criticidad</strong>
        <span>
          La etiqueta combina volumen de interrupciones, concentración territorial,
          personas afectadas estimadas, conexiones comprometidas y tiempos sin servicio.
        </span>
      </div>

      <div className="operational-zone-list">
        <div className="operational-section-label">Zonas del grupo</div>
        {(block.districts || []).slice(0, 10).map((district) => (
          <button
            type="button"
            key={district.id}
            onClick={() => onOpenLocal?.(district)}
          >
            <span>{district.nombre}</span>
            <small>{formatNumber(district.interrupciones)} interrupciones</small>
          </button>
        ))}
      </div>

      <div className="operational-action-grid">
        <button type="button" onClick={() => onSendSectorization?.(block)}>
          Enviar a sectorización
        </button>
        <button type="button" onClick={() => onOpenRoutes?.(block)}>
          Ver rutas candidatas
        </button>
        <button type="button" onClick={() => onMarkPrioritized?.(block)}>
          Marcar como priorizado
        </button>
      </div>
    </article>
  );
}
