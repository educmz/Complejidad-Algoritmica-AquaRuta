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

export default function OperationalBlockTable({
  blocks = [],
  activeBlockId,
  search,
  sortBy,
  onSearchChange,
  onSortChange,
  onSelect,
  onSectorize,
  onOpenRoutes,
  onAssignNode,
  onPrioritize,
}) {
  return (
    <article className="panel operational-table-panel">
      <div className="operational-panel-heading">
        <div>
          <h3 className="panel-title">Tabla operativa de grupos</h3>
          <p className="panel-subtitle">
            Priorización, cobertura EPS, estado y acciones de continuidad operativa.
          </p>
        </div>
        <div className="operational-table-tools">
          <input
            className="control-input"
            type="search"
            placeholder="Buscar grupo, zona o nodo"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
          <select
            className="control-select"
            value={sortBy}
            onChange={(event) => onSortChange(event.target.value)}
          >
            <option value="criticidad">Ordenar por criticidad</option>
            <option value="interrupciones">Interrupciones</option>
            <option value="zonas">Cantidad de zonas</option>
            <option value="poblacion">Personas estimadas</option>
            <option value="demanda">Peso demanda familiar</option>
            <option value="distancia">Distancia al nodo</option>
          </select>
        </div>
      </div>

      <div className="operational-table-scroll">
        <table className="operational-block-table">
          <thead>
            <tr>
              <th>Grupo</th>
              <th>Ámbito</th>
              <th>Zonas</th>
              <th>Interrupciones</th>
              <th>Personas estimadas</th>
              <th>Peso demanda</th>
              <th>Nodo sugerido</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {blocks.map((block) => {
              const isActive = block.id === activeBlockId;

              return (
                <tr key={block.id} className={isActive ? "active" : ""}>
                  <td>
                    <button
                      type="button"
                      className="operational-table-main-button"
                      onClick={() => onSelect(block.id)}
                    >
                      <strong>{block.nombre}</strong>
                      <span className={badgeClass(block.criticidad)}>
                        {block.criticidad}
                      </span>
                    </button>
                  </td>
                  <td>{block.scopeLabel}</td>
                  <td>{formatNumber(block.cantidad_zonas)}</td>
                  <td>{formatNumber(block.interrupciones)}</td>
                  <td>{formatCompact(block.estimatedPopulation)}</td>
                  <td>{Number(block.demandWeight || 0).toFixed(3)}</td>
                  <td>
                    <span>{block.nearestOrigin?.prestador || "No disponible"}</span>
                    <small>{block.nearestOriginDistanceKm.toFixed(1)} km</small>
                  </td>
                  <td>{block.statusLabel}</td>
                  <td>
                    <div className="operational-row-actions">
                      <button type="button" onClick={() => onSelect(block.id)}>
                        Ver mapa
                      </button>
                      <button type="button" onClick={() => onSelect(block.id)}>
                        Detalle
                      </button>
                      <button type="button" onClick={() => onSectorize(block)}>
                        Sectorizar
                      </button>
                      <button type="button" onClick={() => onOpenRoutes(block)}>
                        Rutas
                      </button>
                      <button type="button" onClick={() => onAssignNode(block)}>
                        Asignar nodo
                      </button>
                      <button type="button" onClick={() => onPrioritize(block)}>
                        Priorizar
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {!blocks.length && (
          <div className="empty-state">No hay grupos para los filtros activos.</div>
        )}
      </div>
    </article>
  );
}
