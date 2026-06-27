export default function MapLegend() {
  const items = [
    { label: "Origen EPS", color: "#1d4ed8" },
    { label: "Distrito del grupo", color: "#64748b" },
    { label: "Nodo visitado", color: "#16a34a" },
    { label: "Nodo inicial", color: "#dc2626" },
  ];

  return (
    <article className="panel">
      <h3 className="panel-title">Leyenda</h3>
      <div style={{ display: "grid", gap: "10px" }}>
        {items.map((item) => (
          <div
            key={item.label}
            style={{ alignItems: "center", display: "flex", gap: "10px" }}
          >
            <span
              style={{
                background: item.color,
                borderRadius: "999px",
                display: "inline-block",
                height: "12px",
                width: "12px",
              }}
            />
            <span className="list-subtitle" style={{ fontSize: "0.9rem" }}>
              {item.label}
            </span>
          </div>
        ))}
      </div>
    </article>
  );
}
