export default function SectorControls({
  groups,
  selectedGroupId,
  onGroupChange,
  criterion,
  onCriterionChange,
  sectorCount,
  onSectorCountChange,
}) {
  const activeGroup = groups[selectedGroupId];

  const sectorOptions = activeGroup
    ? Object.keys(activeGroup.criterios?.[criterion] || {})
    : [];

  return (
    <article className="panel">
      <h3 className="panel-title">Controles de sectorización</h3>
      <p className="panel-subtitle">
        Selecciona el grupo, criterio y cantidad de sectores a visualizar.
      </p>

      <div style={{ display: "grid", gap: "14px" }}>
        <div className="control-group">
          <label className="control-label">Grupo operativo</label>
          <select
            className="control-select"
            value={selectedGroupId}
            onChange={(event) => onGroupChange(event.target.value)}
          >
            {Object.values(groups).map((group) => (
              <option key={group.groupId} value={group.groupId}>
                {group.groupName}
              </option>
            ))}
          </select>
        </div>

        <div className="control-group">
          <label className="control-label">Criterio</label>
          <select
            className="control-select"
            value={criterion}
            onChange={(event) => onCriterionChange(event.target.value)}
          >
            <option value="geografico">Geográfico</option>
            <option value="carga">Carga</option>
            <option value="mixto">Mixto</option>
          </select>
        </div>

        <div className="control-group">
          <label className="control-label">Cantidad de sectores</label>
          <select
            className="control-select"
            value={sectorCount}
            onChange={(event) => onSectorCountChange(event.target.value)}
          >
            {sectorOptions.map((count) => (
              <option key={count} value={count}>
                {count} sectores
              </option>
            ))}
          </select>
        </div>

        {activeGroup && (
          <>
            <div
              style={{
                background: "#f8fafc",
                border: "1px solid #d9e2ec",
                borderRadius: "14px",
                padding: "12px 14px",
              }}
            >
              <div className="list-subtitle">Interrupciones del grupo</div>
              <div className="list-title">
                {activeGroup.groupInterruptions.toLocaleString("es-PE")}
              </div>
            </div>

            <div
              style={{
                background: "#f8fafc",
                border: "1px solid #d9e2ec",
                borderRadius: "14px",
                padding: "12px 14px",
              }}
            >
              <div className="list-subtitle">Zonas en el grupo</div>
              <div className="list-title">{activeGroup.groupZonesCount}</div>
            </div>
          </>
        )}
      </div>
    </article>
  );
}