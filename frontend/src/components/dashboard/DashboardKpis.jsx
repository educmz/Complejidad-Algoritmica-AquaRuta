import StatCard from "../shared/StatCard";

export default function DashboardKpis({ kpis }) {
  return (
    <section
      style={{
        display: "grid",
        gap: "16px",
        gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
      }}
    >
      {kpis.map((item) => (
        <StatCard
          key={item.label}
          label={item.label}
          value={item.value}
          accent={item.accent}
        />
      ))}
    </section>
  );
}