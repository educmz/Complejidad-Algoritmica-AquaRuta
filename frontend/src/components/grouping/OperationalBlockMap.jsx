import { useEffect } from "react";
import {
  Circle,
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const priorityColors = {
  critica: { stroke: "#991b1b", fill: "#dc2626", soft: "#fee2e2" },
  alta: { stroke: "#9a3412", fill: "#ea580c", soft: "#ffedd5" },
  media: { stroke: "#92400e", fill: "#f59e0b", soft: "#fef3c7" },
  baja: { stroke: "#0f766e", fill: "#14b8a6", soft: "#ccfbf1" },
};

function epsIcon(label = "EPS") {
  return L.divIcon({
    className: "",
    html: `
      <div style="
        align-items:center;
        background:#0f766e;
        border:2px solid white;
        border-radius:8px;
        box-shadow:0 8px 18px rgba(15,23,42,.2);
        color:white;
        display:flex;
        font:900 10px Inter, Arial, sans-serif;
        height:32px;
        justify-content:center;
        letter-spacing:0;
        width:38px;
      ">${label}</div>
    `,
    iconAnchor: [19, 16],
    iconSize: [38, 32],
  });
}

function MapFocus({ points }) {
  const map = useMap();

  useEffect(() => {
    const validPoints = points.filter(
      (point) =>
        Array.isArray(point) &&
        point.length === 2 &&
        Number.isFinite(point[0]) &&
        Number.isFinite(point[1])
    );

    if (!validPoints.length) return;

    if (validPoints.length === 1) {
      map.setView(validPoints[0], 11);
      return;
    }

    map.fitBounds(validPoints, { padding: [34, 34], maxZoom: 11 });
  }, [map, points]);

  return null;
}

export default function OperationalBlockMap({
  blocks = [],
  activeBlock = null,
  layers,
  onSelectBlock,
  onOpenMap,
}) {
  const selectedBlocks = activeBlock ? [activeBlock] : blocks.slice(0, 18);
  const blockPoints = selectedBlocks.map((block) => block.center).filter(Boolean);
  const activeDistrictPoints = activeBlock?.districts
    ?.map((district) => district.center)
    .filter(Boolean);
  const activeOrigin = activeBlock?.nearestOrigin || null;
  const focusPoints = [
    ...(activeBlock ? [activeBlock.center] : blockPoints),
    ...(activeDistrictPoints || []),
    ...(activeOrigin ? [[activeOrigin.lat, activeOrigin.lon]] : []),
  ].filter(Boolean);
  const initialCenter = focusPoints[0] || [-12.0464, -77.0428];

  return (
    <article className="panel operational-map-panel">
      <div className="operational-panel-heading">
        <div>
          <h3 className="panel-title">Mapa territorial de grupos</h3>
          <p className="panel-subtitle">
            Áreas de cobertura, criticidad y relación con nodos EPS sugeridos.
          </p>
        </div>
        {activeBlock && (
          <button
            type="button"
            className="operational-soft-button"
            onClick={() => onOpenMap?.(activeBlock)}
          >
            Abrir mapa operativo
          </button>
        )}
      </div>

      <div className="operational-map-shell">
        <MapContainer
          center={initialCenter}
          zoom={7}
          scrollWheelZoom={true}
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <MapFocus points={focusPoints} />

          {layers.showHalos &&
            selectedBlocks.map((block) => {
              if (!block.center) return null;
              const colors = priorityColors[block.criticidad] || priorityColors.baja;
              const isActive = activeBlock?.id === block.id;

              return (
                <Circle
                  key={`halo-${block.id}`}
                  center={block.center}
                  radius={Math.max(4500, block.spreadKm * 1000)}
                  eventHandlers={{ click: () => onSelectBlock?.(block.id) }}
                  pathOptions={{
                    color: colors.stroke,
                    fillColor: colors.fill,
                    fillOpacity: isActive ? 0.1 : 0.04,
                    opacity: isActive ? 0.72 : 0.32,
                    weight: isActive ? 3 : 1.5,
                  }}
                >
                  <Tooltip direction="top" opacity={0.94}>
                    {block.nombre}: {block.cantidad_zonas} zonas
                  </Tooltip>
                  <Popup>
                    <strong>{block.nombre}</strong>
                    <br />
                    {block.scopeLabel}
                    <br />
                    {block.interrupciones.toLocaleString("es-PE")} interrupciones
                    <br />
                    Nodo sugerido: {block.nearestOrigin?.prestador || "No disponible"}
                  </Popup>
                </Circle>
              );
            })}

          {layers.showConnections &&
            activeBlock?.center &&
            activeOrigin && (
              <Polyline
                positions={[activeBlock.center, [activeOrigin.lat, activeOrigin.lon]]}
                pathOptions={{
                  color: "#0f766e",
                  dashArray: "8 8",
                  opacity: 0.85,
                  weight: 3,
                }}
              >
                <Tooltip permanent direction="center" opacity={0.9}>
                  {activeBlock.nearestOriginDistanceKm.toFixed(1)} km
                </Tooltip>
              </Polyline>
            )}

          {layers.showEps &&
            activeOrigin && (
              <Marker
                position={[activeOrigin.lat, activeOrigin.lon]}
                icon={epsIcon("EPS")}
              >
                <Popup>
                  <strong>{activeOrigin.prestador}</strong>
                  <br />
                  {activeOrigin.distrito}, {activeOrigin.provincia}
                  <br />
                  Nodo sugerido para {activeBlock?.nombre}
                </Popup>
              </Marker>
            )}

          {layers.showZones &&
            (activeBlock?.districts || []).map((district) => {
              const colors = priorityColors[district.criticidad] || priorityColors.baja;
              return (
                <CircleMarker
                  key={district.id}
                  center={district.center}
                  radius={district.id === activeBlock.mainDistrict?.id ? 9 : 6}
                  pathOptions={{
                    color: colors.stroke,
                    fillColor: colors.fill,
                    fillOpacity: 0.88,
                    weight: district.id === activeBlock.mainDistrict?.id ? 3 : 2,
                  }}
                >
                  <Tooltip direction="top" opacity={0.92}>
                    {district.nombre}
                  </Tooltip>
                  <Popup>
                    <strong>{district.nombre}</strong>
                    <br />
                    {district.interrupciones.toLocaleString("es-PE")} interrupciones
                    <br />
                    {district.conexiones_afectadas.toLocaleString("es-PE")} conexiones
                  </Popup>
                </CircleMarker>
              );
            })}
        </MapContainer>
      </div>

      <div className="operational-map-legend">
        <span className="critical">Crítica</span>
        <span className="high">Alta</span>
        <span className="medium">Media</span>
        <span className="low">Baja</span>
        <span className="eps">Nodo EPS</span>
        <span className="route">Conexion sugerida</span>
      </div>
    </article>
  );
}
