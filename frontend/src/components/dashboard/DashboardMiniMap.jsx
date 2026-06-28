import { useEffect } from "react";
import {
  CircleMarker,
  Marker,
  MapContainer,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const priorityColors = {
  critica: { color: "#991b1b", fill: "#dc2626" },
  alta: { color: "#9a3412", fill: "#ea580c" },
  media: { color: "#92400e", fill: "#f59e0b" },
  baja: { color: "#0f766e", fill: "#14b8a6" },
};

function MapFocus({ points, focusKey }) {
  const map = useMap();

  useEffect(() => {
    map.invalidateSize();
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
  }, [focusKey, map, points]);

  return null;
}

const epsIcon = L.divIcon({
  className: "dashboard-eps-marker",
  html: '<span class="dashboard-eps-water-icon" aria-hidden="true"></span>',
  iconSize: [44, 44],
  iconAnchor: [22, 40],
});

const epsReferenceIcon = L.divIcon({
  className: "dashboard-eps-marker dashboard-eps-marker-reference",
  html: '<span class="dashboard-eps-water-icon" aria-hidden="true"></span>',
  iconSize: [44, 44],
  iconAnchor: [22, 40],
});

function isValidCoordinatePair(point) {
  return (
    Array.isArray(point) &&
    point.length === 2 &&
    Number.isFinite(point[0]) &&
    Number.isFinite(point[1]) &&
    point[0] >= -90 &&
    point[0] <= 90 &&
    point[1] >= -180 &&
    point[1] <= 180
  );
}

function isValidOrigin(origin) {
  const lat = Number(origin.lat);
  const lon = Number(origin.lon);
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

export default function DashboardMiniMap({
  districts = [],
  epsOrigins = [],
  focusKey = 0,
  onDistrictClick,
}) {
  const visibleDistricts = districts.filter((district) => isValidCoordinatePair(district.center));
  const visibleOrigins = epsOrigins.filter(isValidOrigin);

  const points = [
    ...visibleDistricts.map((district) => district.center),
    ...visibleOrigins.map((origin) => [Number(origin.lat), Number(origin.lon)]),
  ];
  const center = points[0] || [-12.0464, -77.0428];

  return (
    <div
      className="dashboard-map-shell"
      data-district-count={visibleDistricts.length}
      data-eps-count={visibleOrigins.length}
    >
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

        <MapFocus points={points} focusKey={focusKey} />

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

        {visibleOrigins.map((origin) => (
          <Marker
            key={origin.id}
            position={[Number(origin.lat), Number(origin.lon)]}
            icon={origin.locationType === "referencial" ? epsReferenceIcon : epsIcon}
          >
            <Tooltip direction="top" opacity={0.95}>
              {origin.prestador}
            </Tooltip>
            <Popup>
              <strong>{origin.prestador}</strong>
              <br />
              {origin.distrito}, {origin.provincia}
              <br />
              {origin.locationType === "referencial"
                ? "Ubicacion referencial de la EPS"
                : "Ubicacion de referencia EPS"}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
