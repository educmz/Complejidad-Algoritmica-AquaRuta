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

function formatKm(value) {
  return `${(Number(value) || 0).toFixed(1)} km`;
}

function formatMinutes(value) {
  const minutes = Number(value) || 0;
  if (minutes >= 60) return `${(minutes / 60).toFixed(1)} h`;
  return `${minutes.toFixed(0)} min`;
}

function ZoneList({ zones = [] }) {
  return (
    <div className="territory-zone-preview expanded">
      <strong>Zonas del grupo</strong>
      <div>
        {zones.length ? zones.map((zone) => <span key={zone}>{zone}</span>) : "Sin zonas disponibles."}
      </div>
    </div>
  );
}

export default function TerritorySidePanel({
  viewMode,
  block,
  node,
  routePlan,
  routeResult,
  routeLoading,
  routeError,
}) {
  if (viewMode === "nodos" && node) {
    const isConnected = !node.ufds?.aislado;

    return (
      <aside className="territory-side-panel">
        <div className="territory-side-header">
          <span>Nodo seleccionado</span>
          <h3>{node.nombre}</h3>
          <p>{node.provincia}, {node.departamento}</p>
        </div>

        <div className="territory-side-grid compact">
          <div>
            <span>Grupo</span>
            <strong>{node.blockName}</strong>
          </div>
          <div>
            <span>Prioridad</span>
            <strong>{node.criticidad}</strong>
          </div>
          <div>
            <span>Interrupciones</span>
            <strong>{formatNumber(node.interrupciones)}</strong>
          </div>
          <div>
            <span>Tiempo sin servicio</span>
            <strong>{formatHours(node.duracion_maxima_horas)}</strong>
          </div>
          <div>
            <span>Distancia EPS</span>
            <strong>{formatKm(node.nearestOriginDistanceKm)}</strong>
          </div>
          <div>
            <span>Estado del nodo</span>
            <strong>{isConnected ? "Integrado" : "Revisar"}</strong>
          </div>
        </div>

        <div className="territory-eps-card">
          <span>EPS sugerida</span>
          <strong>{node.nearestOrigin?.prestador || "No disponible"}</strong>
          <small>{node.nearestOrigin?.distrito || "Origen no asignado"}</small>
        </div>

        {block && <ZoneList zones={block.zonas || []} />}
      </aside>
    );
  }

  if (viewMode === "rutas" && routePlan) {
    const distance = routeResult?.distanceKm || routePlan.distanceKm;
    const duration = routeResult?.durationMin || routePlan.durationMin;
    const cost = routeResult?.cost || routePlan.cost;
    const coveredCount = routeResult?.coveredNodes?.length || 0;
    const pendingCount = routeResult?.noConnectionNodes?.length || 0;

    return (
      <aside className="territory-side-panel">
        <div className="territory-side-header">
          <span>Cobertura del grupo</span>
          <h3>{routePlan.block.nombre}</h3>
          <p>{routePlan.origin?.prestador || "Origen no disponible"}</p>
        </div>

        {(routeLoading || routeError) && (
          <div className="territory-route-status">
            <strong>{routeLoading ? "Calculando cobertura" : "Revisar cobertura"}</strong>
            <span>
              {routeError ||
                "Se está evaluando la red vial para confirmar los nodos cubiertos."}
            </span>
          </div>
        )}

        <div className="territory-side-grid compact">
          <div>
            <span>Nodos del grupo</span>
            <strong>{formatNumber(routePlan.stops.length)}</strong>
          </div>
          <div>
            <span>Cubiertos</span>
            <strong>{formatNumber(coveredCount)}</strong>
          </div>
          <div>
            <span>Pendientes</span>
            <strong>{formatNumber(pendingCount)}</strong>
          </div>
          <div>
            <span>Distancia</span>
            <strong>{formatKm(distance)}</strong>
          </div>
          <div>
            <span>Tiempo</span>
            <strong>{formatMinutes(duration)}</strong>
          </div>
          <div>
            <span>Costo estimado</span>
            <strong>S/ {formatNumber(cost)}</strong>
          </div>
        </div>

        <ZoneList zones={routePlan.block.zonas || []} />
      </aside>
    );
  }

  if (!block) {
    return (
      <aside className="territory-side-panel">
        <div className="empty-state">Selecciona un grupo para revisar su detalle operativo.</div>
      </aside>
    );
  }

  return (
    <aside className="territory-side-panel">
      <div className="territory-side-header">
        <span>Grupo seleccionado</span>
        <h3>{block.nombre}</h3>
        <p>{block.scopeLabel}</p>
      </div>

      <span className={badgeClass(block.criticidad)}>{block.criticidad}</span>

      <div className="territory-side-grid compact">
        <div>
          <span>Prioridad</span>
          <strong>{block.prioridad || "S/D"}</strong>
        </div>
        <div>
          <span>Zonas</span>
          <strong>{formatNumber(block.cantidad_zonas)}</strong>
        </div>
        <div>
          <span>Interrupciones</span>
          <strong>{formatNumber(block.interrupciones)}</strong>
        </div>
        <div>
          <span>Unidades afectadas</span>
          <strong>{formatCompact(block.estimatedPopulation)}</strong>
        </div>
        <div>
          <span>Tiempo máximo</span>
          <strong>{formatHours(block.maxDurationHours)}</strong>
        </div>
        <div>
          <span>Cobertura EPS</span>
          <strong>{block.coverageLabel}</strong>
        </div>
      </div>

      <div className="territory-eps-card">
        <span>EPS sugerida</span>
        <strong>{block.nearestOrigin?.prestador || "No disponible"}</strong>
        <small>{formatKm(block.nearestOriginDistanceKm)} al centro del grupo</small>
      </div>

      <ZoneList zones={block.zonas || []} />
    </aside>
  );
}
