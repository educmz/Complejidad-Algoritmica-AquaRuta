export default function GroupFilters({
  criticidad,
  onCriticidadChange,
  totalGroups,
  visibleGroups,
}) {
  return (
    <article className="panel">
      <h3 className="panel-title">Filtros de grupos operativos</h3>
      <p className="panel-subtitle">
        Ajusta la vista de grupos territoriales de atención.
      </p>

      <div style={{ display: "grid", gap: "14px" }}>
        <div className="control-group">
          <label className="control-label">Criticidad</label>
          <select
            className="control-select"
            value={criticidad}
            onChange={(event) => onCriticidadChange(event.target.value)}
          >
            <option value="todas">Todas</option>
            <option value="critica">Crítica</option>
            <option value="alta">Alta</option>
            <option value="media">Media</option>
            <option value="baja">Baja</option>
          </select>
        </div>

        <div
          style={{
            background: "#f8fafc",
            border: "1px solid #d9e2ec",
            borderRadius: "14px",
            padding: "12px 14px",
          }}
        >
          <div className="list-subtitle">Grupos totales</div>
          <div className="list-title">{totalGroups}</div>
        </div>

        <div
          style={{
            background: "#f8fafc",
            border: "1px solid #d9e2ec",
            borderRadius: "14px",
            padding: "12px 14px",
          }}
        >
          <div className="list-subtitle">Grupos visibles</div>
          <div className="list-title">{visibleGroups}</div>
        </div>
      </div>
    </article>
  );
}
