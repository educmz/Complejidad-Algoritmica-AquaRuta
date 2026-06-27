function buildNodePositions(nodes, includeOrigin = false) {
  if (includeOrigin) {
    const allNodes = [
      { id: "origin-node", nombre: "EPS", interrupciones: 0, isOrigin: true },
      ...nodes,
    ];

    return allNodes.map((node, index) => ({
      ...node,
      x: 140 + index * 180,
      y: 180,
      order: index,
    }));
  }

  const startX = 80;
  const startY = 90;
  const stepX = 120;
  const stepY = 120;
  const perRow = 5;

  return nodes.map((node, index) => {
    const row = Math.floor(index / perRow);
    const col = index % perRow;
    const zigzagCol = row % 2 === 0 ? col : perRow - 1 - col;

    return {
      ...node,
      x: startX + zigzagCol * stepX,
      y: startY + row * stepY,
      order: index + 1,
    };
  });
}

export default function NodalGraphView({
  origin = null,
  nodes = [],
  title = "Vista nodal",
  subtitle = "Representación lógica del recorrido sobre nodos operativos.",
  includeOriginInGraph = false,
}) {
  const positionedNodes = buildNodePositions(nodes, includeOriginInGraph);

  const svgWidth = includeOriginInGraph
    ? Math.max(520, positionedNodes.length * 190)
    : 760;

  const svgHeight = includeOriginInGraph
    ? 320
    : Math.max(240, Math.ceil(positionedNodes.length / 5) * 140);

  return (
    <article className="panel">
      <h3 className="panel-title">{title}</h3>
      <p className="panel-subtitle">{subtitle}</p>

      {!includeOriginInGraph && origin && (
        <div
          className="list-card"
          style={{
            background: "#eff6ff",
            borderColor: "#93c5fd",
            marginBottom: "14px",
          }}
        >
          <div>
            <div className="list-title">{origin.prestador}</div>
            <div className="list-subtitle">
              Nodo de inicio · {origin.distrito}, {origin.provincia}
            </div>
          </div>
          <div className="text-right">
            <span
              className="badge"
              style={{ background: "#dbeafe", color: "#1e3a8a" }}
            >
              inicio
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
        <svg width={svgWidth} height={svgHeight} style={{ display: "block" }}>
          {positionedNodes.slice(0, -1).map((node, index) => {
            const next = positionedNodes[index + 1];
            return (
              <line
                key={`edge-${node.id}-${next.id}`}
                x1={node.x}
                y1={node.y}
                x2={next.x}
                y2={next.y}
                stroke="#94a3b8"
                strokeWidth="3"
                strokeDasharray="6 4"
              />
            );
          })}

          {positionedNodes.map((node, index) => {
            const isOriginNode = Boolean(node.isOrigin);
            const isFirstRouteNode = !isOriginNode && index === (includeOriginInGraph ? 1 : 0);

            const fill = isOriginNode
              ? "#1d4ed8"
              : isFirstRouteNode
              ? "#dc2626"
              : "#1d4ed8";

            const label = isOriginNode ? "EPS" : String(node.order);

            return (
              <g key={node.id}>
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={isOriginNode || isFirstRouteNode ? 26 : 22}
                  fill={fill}
                  stroke="white"
                  strokeWidth="4"
                />

                <text
                  x={node.x}
                  y={node.y + 5}
                  textAnchor="middle"
                  fontSize={isOriginNode ? "11" : "12"}
                  fontWeight="800"
                  fill="white"
                >
                  {label}
                </text>

                <text
                  x={node.x}
                  y={node.y + 42}
                  textAnchor="middle"
                  fontSize="12"
                  fontWeight="700"
                  fill="#0f172a"
                >
                  {isOriginNode
                    ? truncate(origin?.prestador || "EPS", 18)
                    : truncate(node.nombre, 18)}
                </text>

                <text
                  x={node.x}
                  y={node.y + 58}
                  textAnchor="middle"
                  fontSize="11"
                  fill="#64748b"
                >
                  {isOriginNode
                    ? "origen"
                    : `${node.interrupciones?.toLocaleString("es-PE") || 0} int.`}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div style={{ display: "grid", gap: "10px", marginTop: "14px" }}>
        <div className="list-subtitle">
          El nodo azul representa el origen EPS.
        </div>
        <div className="list-subtitle">
          El nodo rojo representa el primer destino atendido.
        </div>
      </div>
    </article>
  );
}

function truncate(text, maxLength) {
  const value = String(text || "");
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}