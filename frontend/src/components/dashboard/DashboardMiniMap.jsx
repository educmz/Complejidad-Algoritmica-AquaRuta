import { useEffect } from "react";
import {
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";

const priorityColors = {
  critica: { color: "#991b1b", fill: "#dc2626" },
  alta: { color: "#9a3412", fill: "#ea580c" },
  media: { color: "#92400e", fill: "#f59e0b" },
  baja: { color: "#0f766e", fill: "#14b8a6" },
};

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

    map.fitBounds(validPoints, { padding: [28, 28], maxZoom: 11 });
  }, [map, points]);

  return null;
}

export default function DashboardMiniMap({ districts = [], onDistrictClick }) {
  const visibleDistricts = districts
    .filter((district) => district.center)
    .slice(0, 80);

  const points = visibleDistricts.map((district) => district.center);
  const center = points[0] || [-12.0464, -77.0428];

  return (
    <div className="dashboard-map-shell">
      <MapContainer
        center={center}
        zoom={6}
        scrollWheelZoom={true}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <MapFocus points={points} />

        {visibleDistricts.map((district) => {
          const colors = priorityColors[district.criticidad] || priorityColors.baja;
          const radius =
            district.criticidad === "critica"
              ? 11
              : district.criticidad === "alta"
              ? 9
              : district.criticidad === "media"
              ? 7
              : 6;

          return (
            <CircleMarker
              key={district.id}
              center={district.center}
              radius={radius}
              eventHandlers={{
                click: () => onDistrictClick?.(district),
              }}
              pathOptions={{
                color: colors.color,
                fillColor: colors.fill,
                fillOpacity: 0.84,
                weight: 2,
              }}
            >
              <Tooltip direction="top" opacity={0.92}>
                {district.nombre}
              </Tooltip>
              <Popup>
                <strong>{district.nombre}</strong>
                <br />
                {district.provincia}, {district.departamento}
                <br />
                {district.interrupciones.toLocaleString("es-PE")} interrupciones
                <br />
                Prioridad {district.criticidad}
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}
