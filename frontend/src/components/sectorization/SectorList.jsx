function criticityClass(level) {
  if (level === "critica") return "badge critical";
  if (level === "alta") return "badge high";
  if (level === "media") return "badge medium";
  return "badge low";
}

export default function SectorList({ sectors, activeSectorId, onSelectSector }) {
  return (
    <article className="panel">
      <h3 className="panel-title">Sectores generados</h3>
      <p className="panel-subtitle">
        Resultado de la particion operativa del grupo seleccionado.
      </p>

      <div style={{ display: "grid", gap: "10px", maxHeight: "640px", overflow: "auto" }}>
        {sectors.map((sector) => {
          const isActive = sector.id === activeSectorId;

          return (
            <button
              key={sector.id}
              onClick={() => onSelectSector(sector.id)}
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
                <div className="list-title">{sector.nombre}</div>
                <div className="list-subtitle">
                  {sector.cantidad_zonas} zonas
                </div>
              </div>

              <div className="text-right">
                <span className={criticityClass(sector.criticidad)}>
                  {sector.criticidad}
                </span>
                <div className="list-subtitle" style={{ marginTop: "6px" }}>
                  {sector.interrupciones.toLocaleString("es-PE")} interrupciones
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </article>
  );
}
