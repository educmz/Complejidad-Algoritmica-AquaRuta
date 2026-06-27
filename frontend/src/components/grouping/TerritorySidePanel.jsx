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
  const number = Number(value);
  if (!Number.isFinite(number)) return "No calculable";
  return `${number.toFixed(1)} km`;
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

function EpsReferenceCard({ block, origin, distance }) {
  const coverageKey = block?.epsCoverageKey || "sin_eps";
  const coverageLabel = block?.epsCoverageLabel || "Sin EPS viable";
  const coverageDescription =
    block?.epsCoverageDescription ||
    "No se encontró una EPS de referencia con datos suficientes.";
  const location = [origin?.distrito, origin?.provincia].filter(Boolean).join(", ");
  const isDistant = coverageKey === "lejana";
  const isNotViable = coverageKey === "no_viable" || coverageKey === "sin_eps";

  return (
    <>
      <div className="territory-eps-card">
        <span>EPS de referencia</span>
        <strong>{origin?.prestador || "No disponible"}</strong>
        <small>{location || "Origen no asignado"}</small>
        <small>{formatKm(distance)}</small>
        <span className={`territory-eps-status ${coverageKey}`}>{coverageLabel}</span>
        <small>{coverageDescription}</small>
      </div>

      {isDistant && (
        <div className="territory-route-status warning">
          <strong>Validación operativa requerida</strong>
          <span>
            La EPS de referencia está lejos del grupo. Esta asignación debe validarse antes de
            usarla como origen operativo.
            {block?.groupType === "individual"
              ? " La atención individual requiere revisar un origen EPS más cercano o validar disponibilidad operativa."
              : block?.groupType === "sectorizable"
              ? " El grupo sigue siendo sectorizable territorialmente, pero su EPS de referencia requiere validación."
              : ""}
          </span>
        </div>
      )}

      {isNotViable && (
        <div className="territory-route-status unavailable">
          <strong>Sin EPS viable</strong>
          <span>
            No se encontró una EPS viable para este grupo con la información disponible.
          </span>
        </div>
      )}
    </>
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
    const isIndividualGroup =
      block &&
      ((block.cantidad_zonas || block.districts?.length) === 1 ||
        block.validNodes?.length === 1);
    const nodeStatus = isIndividualGroup
      ? "Grupo individual"
      : node.ufds?.aislado
      ? "Revisar"
      : "Integrado";
    const referenceOrigin = block?.nearestOrigin || node.nearestOrigin;

    return (
      <aside className="territory-side-panel">
        <div className="territory-side-header">
          <span>Zona seleccionada</span>
          <h3>{node.nombre}</h3>
          <p>{node.provincia}, {node.departamento}</p>
        </div>

        <div className="territory-side-grid compact">
          <div>
            <span>Grupo</span>
            <strong>{node.blockName}</strong>
          </div>
          <div>
            <span>Tipo de grupo</span>
            <strong>{block?.groupTypeLabel || nodeStatus}</strong>
          </div>
          <div>
            <span>Criticidad</span>
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
            <span>Personas afectadas estimadas</span>
            <strong>{formatCompact(node.personas_afectadas_estimadas)}</strong>
          </div>
          <div>
            <span>Prom. integrantes por hogar</span>
            <strong>{Number(node.promedio_integrantes_hogar || 0).toFixed(2)}</strong>
          </div>
          <div>
            <span>Peso demanda familiar</span>
            <strong>{Number(node.peso_demanda_familiar || 0).toFixed(3)}</strong>
          </div>
          <div>
            <span>Estado de la zona</span>
            <strong>{nodeStatus}</strong>
          </div>
        </div>

        {isIndividualGroup && (
          <p className="territory-context-note">
            Este grupo se atiende como unidad independiente y no requiere sectorización.
          </p>
        )}

        <EpsReferenceCard
          block={block}
          origin={referenceOrigin}
          distance={block?.nearestOriginDistanceKm ?? node.nearestOriginDistanceKm}
        />

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

  const hasInvalidOnly =
    (block.validNodes?.length || 0) === 0 &&
    (block.invalidNodes?.length || 0) > 0;

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
          <span>Tipo</span>
          <strong>{block.groupTypeLabel}</strong>
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
          <span>Personas afectadas estimadas</span>
          <strong>{formatCompact(block.estimatedPopulation)}</strong>
        </div>
        <div>
          <span>Peso demanda familiar</span>
          <strong>{Number(block.demandWeight || 0).toFixed(3)}</strong>
        </div>
        <div>
          <span>Prom. integrantes por hogar</span>
          <strong>{Number(block.avgHouseholdSize || 0).toFixed(2)}</strong>
        </div>
        <div>
          <span>Tiempo máximo</span>
          <strong>{formatHours(block.maxDurationHours)}</strong>
        </div>
        <div>
          <span>Cobertura EPS</span>
          <strong>{block.epsCoverageLabel}</strong>
        </div>
      </div>

      <EpsReferenceCard
        block={block}
        origin={block.nearestOrigin}
        distance={block.nearestOriginDistanceKm}
      />

      {hasInvalidOnly && (
        <div className="territory-route-status">
          <strong>Coordenadas no disponibles</strong>
          <span>
            Este grupo tiene zonas registradas, pero no cuenta con centro geográfico válido para
            mostrar nodos en el mapa.
          </span>
        </div>
      )}

      {block.groupType === "individual" && (
        <p className="territory-context-note">
          No sectorizable: grupo individual. Se atiende como una unidad independiente.
        </p>
      )}

      {block.groupType === "sin-georreferenciacion" && (
        <p className="territory-context-note">
          No sectorizable: faltan coordenadas geográficas válidas.
        </p>
      )}

      <ZoneList zones={block.zonas || []} />
    </aside>
  );
}
