function criticityClass(level) {
  if (level === "critica") return "badge critical";
  if (level === "alta") return "badge high";
  if (level === "media") return "badge medium";
  return "badge low";
}

export default function GroupDetail({ group }) {
  if (!group) {
    return (
      <article className="panel">
        <h3 className="panel-title">Detalle del grupo</h3>
        <div className="empty-state">
          Selecciona un grupo para ver sus zonas, provincias y métricas.
        </div>
      </article>
    );
  }

  return (
    <article className="panel">
      <h3 className="panel-title">Detalle del grupo</h3>
      <p className="panel-subtitle">
        Información del grupo operativo seleccionado.
      </p>

      <div style={{ display: "grid", gap: "12px" }}>
        <div>
          <div className="list-title">{group.nombre}</div>
          <div className="list-subtitle">
            Provincias: {group.provincias.join(", ")}
          </div>
        </div>

        <div>
          <span className={criticityClass(group.criticidad)}>
            {group.criticidad}
          </span>
        </div>

        <div className="section-grid-2">
          <div
            style={{
              background: "#f8fafc",
              border: "1px solid #d9e2ec",
              borderRadius: "14px",
              padding: "12px 14px",
            }}
          >
            <div className="list-subtitle">Cantidad de zonas</div>
            <div className="list-title">{group.cantidad_zonas}</div>
          </div>

          <div
            style={{
              background: "#f8fafc",
              border: "1px solid #d9e2ec",
              borderRadius: "14px",
              padding: "12px 14px",
            }}
          >
            <div className="list-subtitle">Interrupciones</div>
            <div className="list-title">
              {group.interrupciones.toLocaleString("es-PE")}
            </div>
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
          <div className="list-subtitle">Centro del grupo</div>
          <div className="list-title" style={{ fontSize: "1rem" }}>
            {group.center
              ? `${group.center[0]}, ${group.center[1]}`
              : "No disponible"}
          </div>
        </div>

        <div>
          <div className="panel-title" style={{ fontSize: "0.96rem", marginBottom: "10px" }}>
            Zonas del grupo
          </div>

          <div style={{ display: "grid", gap: "8px", maxHeight: "280px", overflow: "auto" }}>
            {group.zonas.map((zone) => (
              <div key={zone} className="list-card">
                <div className="list-title">{zone}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}
