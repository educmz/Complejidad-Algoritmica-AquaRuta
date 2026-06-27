function criticityClass(level) {
  if (level === "critica") return "badge critical";
  if (level === "alta") return "badge high";
  if (level === "media") return "badge medium";
  return "badge low";
}

export default function SectorDetail({ sector }) {
  if (!sector) {
    return (
      <article className="panel">
        <h3 className="panel-title">Detalle del sector</h3>
        <div className="empty-state">
          Selecciona un sector para revisar sus zonas y métricas.
        </div>
      </article>
    );
  }

  return (
    <article className="panel">
      <h3 className="panel-title">Detalle del sector</h3>
      <p className="panel-subtitle">
        Información del sector seleccionado.
      </p>

      <div style={{ display: "grid", gap: "12px" }}>
        <div>
          <div className="list-title">{sector.nombre}</div>
          <div className="list-subtitle">
            Criterio: {sector.criterio}
          </div>
        </div>

        <div>
          <span className={criticityClass(sector.criticidad)}>
            {sector.criticidad}
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
            <div className="list-title">{sector.cantidad_zonas}</div>
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
              {sector.interrupciones.toLocaleString("es-PE")}
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
          <div className="list-subtitle">Centro del sector</div>
          <div className="list-title" style={{ fontSize: "1rem" }}>
            {sector.center
              ? `${sector.center[0]}, ${sector.center[1]}`
              : "No disponible"}
          </div>
        </div>

        <div>
          <div className="panel-title" style={{ fontSize: "0.96rem", marginBottom: "10px" }}>
            Zonas del sector
          </div>

          <div style={{ display: "grid", gap: "8px", maxHeight: "280px", overflow: "auto" }}>
            {sector.zonas.map((zone) => (
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