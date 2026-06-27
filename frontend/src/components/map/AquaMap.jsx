import { useEffect, useMemo, useRef } from "react";
import {
  CircleMarker,
  GeoJSON,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

function createLabelIcon(label, color = "#1d4ed8") {
  return L.divIcon({
    className: "",
    html: `
      <div style="
        align-items:center;
        background:${color};
        border:2px solid white;
        border-radius:999px;
        box-shadow:0 8px 18px rgba(15,23,42,.18);
        color:white;
        display:flex;
        font:800 12px Inter, Arial, sans-serif;
        height:34px;
        justify-content:center;
        width:34px;
      ">
        ${label}
      </div>
    `,
    iconAnchor: [17, 17],
    iconSize: [34, 34],
  });
}

function validLatLngs(points) {
  return points.filter(
    (point) =>
      Array.isArray(point) &&
      point.length === 2 &&
      Number.isFinite(point[0]) &&
      Number.isFinite(point[1])
  );
}

function geoJsonLatLngs(geoJson) {
  const coordinates = geoJson?.features?.flatMap((feature) => {
    const geometry = feature?.geometry;
    if (geometry?.type === "LineString") return geometry.coordinates || [];
    if (geometry?.type === "MultiLineString") return geometry.coordinates?.flat() || [];
    return [];
  });

  return (coordinates || [])
    .map((point) => [point[1], point[0]])
    .filter(
      (point) =>
        Number.isFinite(point[0]) &&
        Number.isFinite(point[1])
    );
}

function fitMapToPoints(map, points, options = {}) {
  const validPoints = validLatLngs(points);
  if (!validPoints.length) return;

  if (validPoints.length === 1) {
    map.setView(validPoints[0], options.zoom || 11);
    return;
  }

  map.fitBounds(validPoints, {
    padding: options.padding || [30, 30],
    maxZoom: options.maxZoom || 12,
  });
}

function MapViewportController({ focusKey, focusPoints, routeKey, routePoints }) {
  const map = useMap();
  const controlsRef = useRef(null);
  const lastFocusKeyRef = useRef("");
  const lastRouteKeyRef = useRef("");
  const userHasInteractedRef = useRef(false);

  useEffect(() => {
    if (!controlsRef.current) return;
    L.DomEvent.disableClickPropagation(controlsRef.current);
    L.DomEvent.disableScrollPropagation(controlsRef.current);
  }, []);

  useMapEvents({
    dragstart: () => {
      userHasInteractedRef.current = true;
    },
    zoomstart: () => {
      userHasInteractedRef.current = true;
    },
  });

  useEffect(() => {
    if (!focusKey || focusKey === lastFocusKeyRef.current) return;
    lastFocusKeyRef.current = focusKey;
    if (userHasInteractedRef.current) return;
    fitMapToPoints(map, focusPoints);
  }, [focusKey, focusPoints, map]);

  useEffect(() => {
    if (!routeKey || routeKey === lastRouteKeyRef.current) return;
    lastRouteKeyRef.current = routeKey;
    if (!userHasInteractedRef.current) {
      fitMapToPoints(map, routePoints, { maxZoom: 13 });
    }
  }, [map, routeKey, routePoints]);

  return (
    <div ref={controlsRef} className="map-action-controls leaflet-control">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          userHasInteractedRef.current = false;
          fitMapToPoints(map, focusPoints);
        }}
      >
        Ajustar sector
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          fitMapToPoints(map, routePoints, { maxZoom: 13 });
        }}
        disabled={!routePoints.length}
      >
        Ajustar secuencia
      </button>
    </div>
  );
}

function edgeKey(a, b) {
  return [a, b].sort().join("::");
}

export default function AquaMap({
  mapTitle = "Mapa operativo",
  mapSubtitle = "Visualizacion territorial con grafo local superpuesto.",
  origins = [],
  groupCenters = [],
  districtPoints = [],
  activeCenter = null,
  routePoints = [],
  routeGeoJson = null,
  routeColor = "#2563eb",
  showConceptRouteFallback = true,
  graphEdges = [],
  highlightedPathEdges = [],
  showEdgeWeights = false,
  edgeWeightLabel = "Peso",
  showDistrictMarkers = true,
  onDistrictClick,
  height = 520,
}) {
  const districtMap = useMemo(
    () => new Map(districtPoints.map((district) => [district.id, district])),
    [districtPoints]
  );
  const highlightedSet = useMemo(
    () => new Set(highlightedPathEdges.map((edge) => edgeKey(edge.source, edge.target))),
    [highlightedPathEdges]
  );

  const pointsForBounds = useMemo(
    () =>
      [
        ...origins.map((item) => [item.lat, item.lon]),
        ...groupCenters.map((item) => item.center),
        ...districtPoints.map((item) => item.center),
        ...(activeCenter ? [activeCenter] : []),
      ].filter(Boolean),
    [activeCenter, districtPoints, groupCenters, origins]
  );
  const realRoutePoints = useMemo(
    () => geoJsonLatLngs(routeGeoJson),
    [routeGeoJson]
  );
  const routeFocusPoints = realRoutePoints.length ? realRoutePoints : routePoints;
  const routePointSignature = useMemo(
    () =>
      validLatLngs(routePoints)
        .map((point) => `${point[0].toFixed(5)},${point[1].toFixed(5)}`)
        .join("|"),
    [routePoints]
  );
  const focusKey = useMemo(
    () =>
      [
        origins.map((item) => item.id).join(","),
        groupCenters.map((item) => item.id).join(","),
        districtPoints.map((item) => item.id).join(","),
        activeCenter?.join(",") || "",
      ].join("|"),
    [activeCenter, districtPoints, groupCenters, origins]
  );
  const routeKey = useMemo(() => {
    if (routeGeoJson) {
      const summary = routeGeoJson?.features?.[0]?.properties?.summary;
      return `geojson-${routePointSignature}-${summary?.distance || 0}-${summary?.duration || 0}-${realRoutePoints.length}`;
    }
    return routePointSignature ? `concept-${routePointSignature}` : "";
  }, [realRoutePoints.length, routeGeoJson, routePointSignature]);

  const initialCenter = activeCenter || pointsForBounds[0] || [-12.0464, -77.0428];

  return (
    <article className="panel" style={{ padding: "0", overflow: "hidden" }}>
      <div style={{ borderBottom: "1px solid #d9e2ec", padding: "16px 18px" }}>
        <h3 className="panel-title" style={{ marginBottom: "4px" }}>
          {mapTitle}
        </h3>
        <p className="panel-subtitle" style={{ marginBottom: 0 }}>
          {mapSubtitle}
        </p>
      </div>

      <div style={{ height: `${height}px`, width: "100%" }}>
        <MapContainer center={initialCenter} zoom={8} style={{ height: "100%", width: "100%" }}>
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <MapViewportController
            focusKey={focusKey}
            focusPoints={pointsForBounds}
            routeKey={routeKey}
            routePoints={routeFocusPoints}
          />

          {graphEdges.map((edge) => {
            const source = districtMap.get(edge.source);
            const target = districtMap.get(edge.target);
            if (!source?.center || !target?.center) return null;

            const isHighlighted = highlightedSet.has(edgeKey(edge.source, edge.target));

            return (
              <Polyline
                key={`${edge.source}-${edge.target}`}
                positions={[source.center, target.center]}
                pathOptions={{
                  color: isHighlighted ? "#16a34a" : "#64748b",
                  weight: isHighlighted ? 5 : 2.5,
                  opacity: isHighlighted ? 1 : 0.75,
                }}
              >
                {showEdgeWeights && (
                  <Tooltip permanent direction="center" opacity={0.9}>
                    {edge.weightLabel || edge.weight}
                  </Tooltip>
                )}
                <Popup>
                  Conexion: {source.nombre} - {target.nombre}
                  <br />
                  {edgeWeightLabel}: {edge.weightLabel || edge.weight}
                </Popup>
              </Polyline>
            );
          })}

          {origins.map((origin) => (
            <Marker
              key={origin.id}
              position={[origin.lat, origin.lon]}
              icon={createLabelIcon("EPS", "#1d4ed8")}
            >
              <Popup>
                <strong>{origin.prestador}</strong>
                <br />
                {origin.distrito}, {origin.provincia}, {origin.departamento}
              </Popup>
            </Marker>
          ))}

          {groupCenters.map((group, index) => (
            <Marker
              key={group.id}
              position={group.center}
              icon={createLabelIcon(String(index + 1), "#0f766e")}
            >
              <Popup>
                <strong>{group.nombre}</strong>
                <br />
                {group.interrupciones.toLocaleString("es-PE")} interrupciones
              </Popup>
            </Marker>
          ))}

          {routeGeoJson ? (
            <GeoJSON
              key={routeKey}
              data={routeGeoJson}
              style={{
                color: routeColor,
                weight: 5,
                opacity: 0.9,
              }}
            />
          ) : (
            showConceptRouteFallback &&
            routePoints.length > 1 && (
              <Polyline
                positions={routePoints}
                pathOptions={{ color: routeColor, weight: 4, opacity: 0.85 }}
              />
            )
          )}

          {showDistrictMarkers && districtPoints.map((district) => {
            const fillColor = district.isSelected
              ? "#dc2626"
              : district.isGoal
              ? "#16a34a"
              : district.isExcluded
              ? "#e2e8f0"
              : district.isActiveNode
              ? "#0f766e"
              : district.isEpsNode
              ? "#1d4ed8"
              : district.isVisited
              ? "#0f766e"
              : "#1d4ed8";

            const color = district.isSelected
              ? "#b91c1c"
              : district.isGoal
              ? "#15803d"
              : district.isExcluded
              ? "#94a3b8"
              : district.isActiveNode
              ? "#0f766e"
              : district.isEpsNode
              ? "#1d4ed8"
              : district.isVisited
              ? "#0f766e"
              : "#1e40af";

            return (
              <CircleMarker
                key={district.id}
                center={district.center}
                radius={district.isEpsNode ? 8 : district.isSelected ? 10 : district.isGoal ? 9 : 7}
                pathOptions={{
                  color,
                  fillColor,
                  fillOpacity: district.isExcluded ? 0.42 : 0.95,
                  opacity: district.isExcluded ? 0.72 : 1,
                  weight: district.isExcluded ? 1.5 : 2,
                }}
                eventHandlers={{
                  click: () => onDistrictClick?.(district),
                }}
              >
                {district.mapOrder && (
                  <Tooltip
                    permanent
                    direction="top"
                    opacity={0.95}
                    className="map-order-tooltip"
                  >
                    {district.mapOrder}
                  </Tooltip>
                )}
                <Popup>
                  <strong>{district.nombre}</strong>
                  {district.provincia && district.departamento && (
                    <>
                      <br />
                      {district.provincia}, {district.departamento}
                    </>
                  )}
                  <br />
                  {district.isEpsNode
                    ? "Inicio EPS de la ruta local"
                    : `${district.interrupciones.toLocaleString("es-PE")} interrupciones`}
                </Popup>
              </CircleMarker>
            );
          })}

          {activeCenter && (
            <CircleMarker
              center={activeCenter}
              radius={12}
              pathOptions={{
                color: "#f59e0b",
                fillColor: "#fbbf24",
                fillOpacity: 0.35,
                weight: 2,
              }}
            >
              <Popup>Centro activo</Popup>
            </CircleMarker>
          )}
        </MapContainer>
      </div>
    </article>
  );
}
