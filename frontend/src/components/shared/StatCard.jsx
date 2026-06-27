export default function StatCard({ label, value, accent = "#1d4ed8" }) {
  return (
    <article className="stat-card" style={{ borderTopColor: accent }}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </article>
  );
}