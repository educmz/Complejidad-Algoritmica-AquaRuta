export default function DashboardAlerts({ alerts = [] }) {
  return (
    <article className="panel">
      <h3 className="panel-title">Alertas operativas</h3>
      <p className="panel-subtitle">
        Indicadores clave para monitoreo y priorización.
      </p>

      <div style={{ display: "grid", gap: "10px" }}>
        {alerts.map((alert) => (
          <div
            key={alert}
            style={{
              background: "#fff7ed",
              border: "1px solid #fed7aa",
              borderRadius: "14px",
              color: "#9a3412",
              fontWeight: 700,
              padding: "12px 14px",
            }}
          >
            {alert}
          </div>
        ))}
      </div>
    </article>
  );
}