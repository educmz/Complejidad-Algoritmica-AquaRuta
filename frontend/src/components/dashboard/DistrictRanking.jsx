function criticityClass(level) {
  if (level === "critica") return "badge critical";
  if (level === "alta") return "badge high";
  if (level === "media") return "badge medium";
  return "badge low";
}

export default function DistrictRanking({ districts = [] }) {
  return (
    <article className="panel">
      <h3 className="panel-title">Distritos más críticos</h3>
      <p className="panel-subtitle">
        Ranking de zonas con mayor número de interrupciones registradas.
      </p>

      <div style={{ display: "grid", gap: "10px" }}>
        {districts.map((district, index) => (
          <div
            key={district.id}
            className="list-card"
            style={{ gridTemplateColumns: "42px 1fr 130px" }}
          >
            <div
              style={{
                alignItems: "center",
                background: "#dbeafe",
                borderRadius: "999px",
                color: "#1e3a8a",
                display: "flex",
                fontWeight: 900,
                height: "32px",
                justifyContent: "center",
                width: "32px",
              }}
            >
              {index + 1}
            </div>

            <div>
              <div className="list-title">{district.nombre}</div>
              <div className="list-subtitle">
                {district.provincia}, {district.departamento}
              </div>
            </div>

            <div className="text-right">
              <span className={criticityClass(district.criticidad)}>
                {district.criticidad}
              </span>
              <div className="list-subtitle" style={{ marginTop: "6px" }}>
                {district.interrupciones.toLocaleString("es-PE")} interrupciones
              </div>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}