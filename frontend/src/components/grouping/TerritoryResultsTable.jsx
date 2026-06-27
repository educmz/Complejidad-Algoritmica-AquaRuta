import { useState } from "react";

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

function formatKm(value) {
  return `${(Number(value) || 0).toFixed(1)} km`;
}

function sortOptions() {
  return [
    ["criticidad", "Criticidad"],
    ["prioridad", "Prioridad"],
    ["interrupciones", "Interrupciones"],
    ["zonas", "Zonas"],
    ["poblacion", "Unidades afectadas"],
    ["distancia", "Distancia EPS"],
  ];
}

export default function TerritoryResultsTable({
  blocks,
  activeBlockId,
  search,
  sortBy,
  onSearchChange,
  onSortChange,
  onOpenGroup,
}) {
  const [zonesBlock, setZonesBlock] = useState(null);
  const zones = zonesBlock?.zonas || [];

  return (
    <article className="territory-results-panel">
      <div className="territory-results-toolbar">
        <div>
          <h3>Grupos operativos</h3>
          <p>Selecciona un grupo para revisar cobertura, zonas incluidas y EPS sugerida.</p>
        </div>
        <div className="territory-results-tools">
          <input
            className="control-input"
            type="search"
            placeholder="Buscar por grupo, distrito, provincia o EPS"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
          <select
            className="control-select"
            value={sortBy}
            onChange={(event) => onSortChange(event.target.value)}
          >
            {sortOptions().map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {zonesBlock && (
        <div className="territory-zones-panel">
          <div>
            <strong>Zonas de {zonesBlock.nombre}</strong>
            <span>{formatNumber(zones.length)} zonas incluidas</span>
          </div>
          <button type="button" onClick={() => setZonesBlock(null)}>Cerrar</button>
          <div className="territory-zones-list">
            {zones.map((zone) => (
              <span key={zone}>{zone}</span>
            ))}
          </div>
        </div>
      )}

      <div className="territory-results-scroll">
        <table className="territory-table territory-group-list-table">
          <thead>
            <tr>
              <th>Grupo</th>
              <th>Criticidad</th>
              <th>Zonas</th>
              <th>Cobertura</th>
              <th>EPS sugerida</th>
              <th>Interrupciones</th>
              <th>Unidades afectadas</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {blocks.map((block) => (
              <tr
                key={block.id}
                className={block.id === activeBlockId ? "active" : ""}
                onDoubleClick={() => onOpenGroup(block)}
              >
                <td>
                  <button type="button" onClick={() => onOpenGroup(block)}>
                    <strong>{block.nombre}</strong>
                    <small>{block.scopeLabel}</small>
                  </button>
                </td>
                <td><span className={badgeClass(block.criticidad)}>{block.criticidad}</span></td>
                <td>{formatNumber(block.cantidad_zonas)}</td>
                <td>{block.coverageLabel}</td>
                <td>
                  {block.nearestOrigin?.prestador || "No disponible"}
                  <small>{formatKm(block.nearestOriginDistanceKm)}</small>
                </td>
                <td>{formatNumber(block.interrupciones)}</td>
                <td>{formatCompact(block.estimatedPopulation)}</td>
                <td>
                  <div className="territory-row-actions compact">
                    <button type="button" onClick={() => onOpenGroup(block)}>
                      Ver grupo
                    </button>
                    <button type="button" onClick={() => setZonesBlock(block)}>
                      Ver zonas
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {!blocks.length && (
          <div className="empty-state">No hay grupos para los filtros activos.</div>
        )}
      </div>
    </article>
  );
}
