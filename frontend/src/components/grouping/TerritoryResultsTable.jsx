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
  const number = Number(value);
  if (!Number.isFinite(number)) return "No calculable";
  return `${number.toFixed(1)} km`;
}

function sortOptions() {
  return [
    ["criticidad", "Criticidad"],
    ["prioridad", "Orden operativo"],
    ["interrupciones", "Interrupciones"],
    ["demanda", "Peso demanda familiar"],
    ["zonas", "Zonas"],
    ["poblacion", "Personas estimadas"],
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
          <p>
            Revisa grupos sectorizables, grupos individuales y zonas sin georreferenciación antes
            de abrir el detalle. La EPS de referencia es un origen operativo externo o local y no
            forma parte del grupo.
          </p>
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
            <strong>Zonas incluidas en {zonesBlock.nombre}</strong>
            <span>
              Estas son las zonas registradas dentro del grupo operativo. Algunas pueden no tener
              coordenadas geográficas disponibles.
            </span>
          </div>
          <button type="button" onClick={() => setZonesBlock(null)}>Cerrar</button>
          {zones.length === 1 && (
            <p className="territory-zones-note">
              Este grupo contiene una sola zona y se considera un grupo individual.
            </p>
          )}
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
              <th>Tipo</th>
              <th>Criticidad</th>
              <th>Zonas</th>
              <th>Cobertura EPS</th>
              <th>EPS de referencia</th>
              <th>Interrupciones</th>
              <th>Personas estimadas</th>
              <th>Peso demanda</th>
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
                <td>
                  <span className={`territory-group-type ${block.groupType}`}>
                    {block.groupTypeLabel}
                  </span>
                </td>
                <td><span className={badgeClass(block.criticidad)}>{block.criticidad}</span></td>
                <td>{formatNumber(block.cantidad_zonas)}</td>
                <td>
                  <span className={`territory-eps-status ${block.epsCoverageKey}`}>
                    {block.epsCoverageLabel}
                  </span>
                </td>
                <td>
                  {block.nearestOrigin?.prestador || "No disponible"}
                  <small>{formatKm(block.nearestOriginDistanceKm)}</small>
                </td>
                <td>{formatNumber(block.interrupciones)}</td>
                <td>{formatCompact(block.estimatedPopulation)}</td>
                <td>{Number(block.demandWeight || 0).toFixed(3)}</td>
                <td>
                  <div className="territory-row-actions compact">
                    <button type="button" onClick={() => onOpenGroup(block)}>
                      Abrir detalle
                    </button>
                    <button type="button" onClick={() => setZonesBlock(block)}>
                      Ver zonas incluidas
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
