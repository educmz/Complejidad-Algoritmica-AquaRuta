function buildPositions(nodes) {
  const selected = nodes.find((n) => n.isSelected);
  const others = nodes.filter((n) => !n.isSelected);

  const centerX = 360;
  const centerY = 210;
  const radius = 160;

  const positioned = [];

  if (selected) {
    positioned.push({ ...selected, x: centerX, y: centerY });
  }

  others.forEach((node, index) => {
    const angle = (index / Math.max(1, others.length)) * Math.PI * 2;
    positioned.push({
      ...node,
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    });
  });

  return positioned;
}

function truncate(text, maxLength) {
  const value = String(text || "");
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

export default function DistrictSubgraphView({
  graph,
}) {
  if (!graph) {
    return (
      <article className="panel">
        <h3 className="panel-title">Subgrafo distrital</h3>
        <div className="empty-state">
          Selecciona un distrito para visualizar su grafo local.
        </div>
      </article>
    );
  }

  const positionedNodes = buildPositions(graph.nodes || []);
  const nodeMap = new Map(positionedNodes.map((node) => [node.id, node]));
  const pathIds = graph.shortestPath?.path || [];
  const pathEdgeSet = new Set();

  for (let i = 0; i < pathIds.length - 1; i += 1) {
    const a = pathIds[i];
    const b = pathIds[i + 1];
    pathEdgeSet.add([a, b].sort().join("::"));
  }

  return (
    <article className="panel">
      <h3 className="panel-title">Subgrafo distrital</h3>
      <p className="panel-subtitle">
        Todos los nodos locales conectados y ruta óptima resaltada.
      </p>

      {graph.origin && (
        <div
          className="list-card"
          style={{
            background: "#eff6ff",
            borderColor: "#93c5fd",
            marginBottom: "14px",
          }}
        >
          <div>
            <div className="list-title">{graph.origin.prestador}</div>
            <div className="list-subtitle">
              EPS de referencia · {graph.origin.distrito}, {graph.origin.provincia}
            </div>
          </div>
          <div className="text-right">
            <span className="badge" style={{ background: "#dbeafe", color: "#1e3a8a" }}>
              origen
            </span>
          </div>
        </div>
      )}

      <div
        style={{
          background: "#f8fafc",
          border: "1px solid #d9e2ec",
          borderRadius: "16px",
          overflow: "auto",
          padding: "12px",
        }}
      >
        <svg width={760} height={440} style={{ display: "block" }}>
          {(graph.edges || []).map((edge) => {
            const source = nodeMap.get(edge.source);
            const target = nodeMap.get(edge.target);
            if (!source || !target) return null;

            const key = [edge.source, edge.target].sort().join("::");
            const isPath = pathEdgeSet.has(key);

            const midX = (source.x + target.x) / 2;
            const midY = (source.y + target.y) / 2;

            return (
              <g key={`${edge.source}-${edge.target}`}>
                <line
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  stroke={isPath ? "#16a34a" : "#94a3b8"}
                  strokeWidth={isPath ? 5 : 3}
                  opacity={isPath ? 1 : 0.9}
                />
                <text
                  x={midX}
                  y={midY - 6}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight="700"
                  fill={isPath ? "#166534" : "#475569"}
                >
                  {edge.weight}
                </text>
              </g>
            );
          })}

          {positionedNodes.map((node) => {
            const isSelected = node.isSelected;
            const isGoal = node.isGoal;

            let fill = "#1d4ed8";
            if (isSelected) fill = "#dc2626";
            if (isGoal) fill = "#16a34a";

            return (
              <g key={node.id}>
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={isSelected ? 30 : 24}
                  fill={fill}
                  stroke="white"
                  strokeWidth="4"
                />

                <text
                  x={node.x}
                  y={node.y + 5}
                  textAnchor="middle"
                  fontSize="12"
                  fontWeight="800"
                  fill="white"
                >
                  {isSelected ? "D" : isGoal ? "F" : "N"}
                </text>

                <text
                  x={node.x}
                  y={node.y + 42}
                  textAnchor="middle"
                  fontSize="12"
                  fontWeight="700"
                  fill="#0f172a"
                >
                  {truncate(node.nombre, 18)}
                </text>

                <text
                  x={node.x}
                  y={node.y + 58}
                  textAnchor="middle"
                  fontSize="11"
                  fill="#64748b"
                >
                  {node.interrupciones?.toLocaleString("es-PE") || 0} int.
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div style={{ display: "grid", gap: "10px", marginTop: "14px" }}>
        <div className="list-subtitle">Rojo: distrito seleccionado.</div>
        <div className="list-subtitle">Verde: destino de la ruta óptima.</div>
        <div className="list-subtitle">Líneas verdes: camino mínimo calculado con Dijkstra.</div>
      </div>
    </article>
  );
}
