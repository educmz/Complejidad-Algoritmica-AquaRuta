function criticityClass(level) {
  if (level === "critica") return "badge critical";
  if (level === "alta") return "badge high";
  if (level === "media") return "badge medium";
  return "badge low";
}

export default function GroupList({ groups, activeGroupId, onSelectGroup }) {
  return (
    <article className="panel">
      <h3 className="panel-title">Grupos operativos</h3>
      <p className="panel-subtitle">
        Selecciona un grupo para revisar sus zonas y métricas.
      </p>

      <div style={{ display: "grid", gap: "10px", maxHeight: "640px", overflow: "auto" }}>
        {groups.map((group) => {
          const isActive = group.id === activeGroupId;

          return (
            <button
              key={group.id}
              onClick={() => onSelectGroup(group.id)}
              className="list-card"
              style={{
                background: isActive ? "#eff6ff" : "#f8fafc",
                borderColor: isActive ? "#93c5fd" : "#d9e2ec",
                cursor: "pointer",
                gridTemplateColumns: "1fr 150px",
                textAlign: "left",
              }}
            >
              <div>
                <div className="list-title">{group.nombre}</div>
                <div className="list-subtitle">
                  {group.cantidad_zonas} zonas · {group.provincias.join(", ")}
                </div>
              </div>

              <div className="text-right">
                <span className={criticityClass(group.criticidad)}>
                  {group.criticidad}
                </span>
                <div className="list-subtitle" style={{ marginTop: "6px" }}>
                  {group.interrupciones.toLocaleString("es-PE")} interrupciones
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </article>
  );
}
