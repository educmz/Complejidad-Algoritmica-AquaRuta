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

function formatMil(value, suffix) {
  const number = Number(value) || 0;
  if (number >= 1000) {
    return `${(number / 1000).toLocaleString("es-PE", { maximumFractionDigits: 1 })} mil ${suffix}`;
  }
  return `${formatNumber(number)} ${suffix}`;
}

function formatKm(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "No calculable";
  return `${number.toFixed(1)} km`;
}

const criticalityHelp = [
  "Crítica: 500 o más interrupciones.",
  "Alta: 100 a 499 interrupciones.",
  "Media: 20 a 99 interrupciones.",
  "Baja: menos de 20 interrupciones.",
].join(" ");

export default function TerritoryGroupTable({
  blocks,
  totalGroups,
  activeBlockId,
  pageSize,
  page,
  onPageChange,
  onOpenGroup,
}) {
  const totalPages = Math.max(1, Math.ceil(blocks.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageBlocks = blocks.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const groupCounter =
    blocks.length === totalGroups
      ? `${formatNumber(totalGroups)} grupos`
      : `${formatNumber(blocks.length)} de ${formatNumber(totalGroups)} grupos`;

  return (
    <article className="territory-results-panel">
      <div className="territory-results-toolbar compact">
        <div>
          <h3>Resultados</h3>
          <p>{groupCounter}</p>
        </div>
      </div>

      <div className="territory-results-scroll">
        <table className="territory-table territory-group-list-table">
          <thead>
            <tr>
              <th>Grupo</th>
              <th>
                <span className="territory-heading-help">
                  Criticidad
                  <span tabIndex={0} title={criticalityHelp} aria-label={criticalityHelp}>!</span>
                </span>
              </th>
              <th>Distritos</th>
              <th>EPS de referencia</th>
              <th>Interrupciones</th>
              <th>Afectaciones estimadas</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {pageBlocks.map((block) => (
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
                  <span className={`${badgeClass(block.criticidad)} territory-criticality-label`}>
                    {criticalityLabels[block.criticidad] || block.criticidad}
                  </span>
                </td>
                <td>{formatNumber(block.cantidad_zonas)}</td>
                <td>
                  <span className="territory-truncate" title={block.nearestOrigin?.prestador || "No disponible"}>
                    {block.nearestOrigin?.prestador || "No disponible"}
                  </span>
                  <small>{formatKm(block.nearestOriginDistanceKm)}</small>
                </td>
                <td>{formatNumber(block.interrupciones)}</td>
                <td title="Estimación basada en datos de población y hogares del Censo 2017.">
                  <strong>{formatMil(block.estimatedPopulation, "personas")}</strong>
                  <small>≈ {formatMil(block.affectedHouseholds, "hogares")}</small>
                </td>
                <td>
                  <div className="territory-row-actions compact">
                    <button type="button" onClick={() => onOpenGroup(block)}>
                      Ver grupo
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

      <div className="territory-pagination">
        <span>Página {currentPage} de {totalPages}</span>
        <div>
          <button type="button" onClick={() => onPageChange(Math.max(1, currentPage - 1))} disabled={currentPage === 1}>
            Anterior
          </button>
          <button type="button" onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))} disabled={currentPage === totalPages}>
            Siguiente
          </button>
        </div>
      </div>
    </article>
  );
}
