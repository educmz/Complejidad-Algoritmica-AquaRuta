import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  CircleMarker,
  GeoJSON,
  MapContainer,
  Popup,
  TileLayer,
  Tooltip,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import MainLayout from "../components/layout/MainLayout";
import EpsMapMarker from "../components/map/EpsMapMarker";
import { aquaRutaData } from "../data/aquaRutaData";
import { fetchRouteGeoJsonBatch } from "../services/mapApi";

const routeColors = {
  selected: "#2563eb",
  highlighted: "#2563eb",
  best: "#16a34a",
  network: "#64748b",
  local: "#2563eb",
};

const markerPriorityColors = {
  critica: { stroke: "#991b1b", fill: "#dc2626" },
  alta: { stroke: "#9a3412", fill: "#ea580c" },
  media: { stroke: "#92400e", fill: "#f59e0b" },
  baja: { stroke: "#0f766e", fill: "#14b8a6" },
};

function priorityColor(value) {
  return markerPriorityColors[value] || markerPriorityColors.baja;
}

const ORS_MAX_ALTERNATIVE_ROUTES = 3;
const MAX_CANDIDATE_ROUTES = ORS_MAX_ALTERNATIVE_ROUTES + 2;

const criterionLabels = {
  distancia: "menor distancia",
  tiempo: "menor tiempo",
  costo: "menor costo",
  fragilidad: "menor riesgo de bloqueo",
};

const DEFAULT_SECTOR_CRITERION = "mixto";
const MAX_VISIBLE_OPERATIONAL_GROUP = 104;

function isVisibleOperationalGroup(group) {
  const match = String(group?.nombre || group?.id || group?.groupName || "").match(/\d+/);
  return !match || Number(match[0]) <= MAX_VISIBLE_OPERATIONAL_GROUP;
}

function hasValidCenter(item) {
  const center = item?.center;
  return (
    Array.isArray(center) &&
    center.length === 2 &&
    Number.isFinite(Number(center[0])) &&
    Number.isFinite(Number(center[1]))
  );
}

function distanceKm(center, origin) {
  if (!hasValidCenter({ center }) || !origin) return Infinity;
  const [lat1, lon1] = center.map((item) => (Number(item) * Math.PI) / 180);
  const lat2 = (Number(origin.lat) * Math.PI) / 180;
  const lon2 = (Number(origin.lon) * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatKm(value) {
  if (!Number.isFinite(Number(value))) return "No disponible";
  return `${Number(value).toFixed(1)} km`;
}

function formatTime(value) {
  const minutes = Number(value) || 0;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  if (hours <= 0) return `${rest} min`;
  return `${hours} h ${rest.toString().padStart(2, "0")} min`;
}

function formatMoney(value) {
  return `S/ ${(Number(value) || 0).toFixed(2)}`;
}

function summaryDistanceKm(geoJson) {
  const summary = geoJson?.features?.[0]?.properties?.summary;
  if (!summary) return null;
  return (summary.distance || 0) / 1000;
}

function summaryDurationMin(geoJson) {
  const summary = geoJson?.features?.[0]?.properties?.summary;
  if (!summary) return null;
  return (summary.duration || 0) / 60;
}

function featureToCollection(feature, source) {
  return {
    type: "FeatureCollection",
    bbox: source?.bbox,
    metrics: source?.metrics,
    features: [feature],
  };
}

function routeMetricsFromPayload(payload) {
  return payload?.metrics || payload?.route_metrics || null;
}

function routeTrafficFromMetrics(route, routeMetrics) {
  const candidates = [
    route?.traffic,
    route?.normalizedRoute?.traffic,
    route?.routeMetrics?.traffic,
    routeMetrics?.traffic,
    routeMetrics,
  ];
  const source = candidates.find(
    (item) =>
      item &&
      (Number.isFinite(Number(item.baseDurationMin)) ||
        Number.isFinite(Number(item.liveDurationMin)) ||
        Number.isFinite(Number(item.trafficDelayMin)))
  );
  if (!source) return null;

  const numberOrNull = (value) =>
    Number.isFinite(Number(value)) ? Number(value) : null;
  return {
    baseDurationMin: numberOrNull(source.baseDurationMin),
    liveDurationMin: numberOrNull(source.liveDurationMin),
    trafficDelayMin: numberOrNull(source.trafficDelayMin),
    trafficFactor: numberOrNull(source.trafficFactor),
    trafficSource: source.trafficSource || "",
    trafficMode: source.trafficMode || "",
    trafficUpdatedAt: source.trafficUpdatedAt || "",
    trafficIsStale: Boolean(source.trafficIsStale),
    trafficWarning: source.trafficWarning || "",
  };
}

function routeGeoJsonFromBatchItem(item) {
  if (!item) return null;
  if (item.ok === false) return null;
  return item.result || item.geoJson || item;
}

function splitRouteAlternatives(geoJson, options = {}) {
  const idPrefix = options.idPrefix || "ruta-real";
  const nameOffset = Number(options.nameOffset || 0);
  const via = options.via || "Trazado por calles";
  const normalizedRoutes = [geoJson?.primaryRoute, ...(geoJson?.alternatives || [])];
  if (geoJson?.routeType === "not_required") {
    return [{
      id: `${idPrefix}-not-required`,
      nombre: "Ruta no requerida",
      via: geoJson.message || "La EPS se encuentra en la zona destino",
      geoJson: null,
      routeMetrics: routeMetricsFromPayload(geoJson),
      traffic: geoJson.traffic || geoJson.metrics?.traffic || null,
      routeAvailable: false,
      routeType: "not_required",
      routeMode: geoJson.routeMode || "fallback",
      message: geoJson.message || "",
      timeFactor: 1,
      costFactor: 1,
      speedKmh: 34,
    }];
  }
  return (geoJson?.features || []).map((feature, index) => ({
    id: `${idPrefix}-${index + 1}`,
    nombre: `Ruta candidata ${nameOffset + index + 1}`,
    via,
    geoJson: featureToCollection(feature, geoJson),
    routeMetrics: routeMetricsFromPayload(geoJson),
    normalizedRoute: normalizedRoutes[index] || null,
    traffic: normalizedRoutes[index]?.traffic || null,
    routeAvailable: geoJson?.routeAvailable,
    routeType: geoJson?.routeType || normalizedRoutes[index]?.routeType || "road",
    routeMode: geoJson?.routeMode || normalizedRoutes[index]?.routeMode || "",
    warning: geoJson?.warning || normalizedRoutes[index]?.warning || "",
    timeFactor: 1,
    costFactor: 1,
    speedKmh: 34,
  }));
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
    .filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]));
}

function coordinateSignature(coordinates = []) {
  return coordinates
    .map(([lon, lat]) => `${Number(lon).toFixed(5)},${Number(lat).toFixed(5)}`)
    .join("|");
}

function routeLatLngs(route) {
  const geoPoints = geoJsonLatLngs(route.geoJson);
  return geoPoints.length ? geoPoints : [];
}

function routeIntersectionNodes(routes, limit = 36) {
  const seen = new Set();
  const nodes = [];
  routes.forEach((route) => {
    const points = routeLatLngs(route);
    const step = Math.max(1, Math.ceil(points.length / 10));
    points.forEach((point, index) => {
      if (index !== 0 && index !== points.length - 1 && index % step !== 0) return;
      const key = `${point[0].toFixed(4)},${point[1].toFixed(4)}`;
      if (seen.has(key)) return;
      seen.add(key);
      nodes.push({ id: `${route.id}-${key}`, center: point });
    });
  });
  return nodes.slice(0, limit);
}

function routeScore(route, criterion) {
  if (criterion === "tiempo") return route.timeMin || 0;
  if (criterion === "costo") return route.cost || 0;
  if (criterion === "fragilidad") {
    return Number.isFinite(Number(route.routeFragilityPenalty))
      ? Number(route.routeFragilityPenalty)
      : route.cost || 0;
  }
  return route.distanceKm || 0;
}

function routeGeometrySignature(route) {
  const points = geoJsonLatLngs(route.geoJson);
  if (!points.length) return "no-geometry";
  const samples = [points[0], points[Math.floor(points.length / 2)], points.at(-1)];
  return `${points.length}:${samples
    .map(([lat, lon]) => `${lat.toFixed(4)},${lon.toFixed(4)}`)
    .join("|")}`;
}

function dedupeRouteAlternatives(routes) {
  const exactKeys = new Set();
  const metricCounts = new Map();
  return routes.filter((route) => {
    const metricKey = [
      route.routeType || "road",
      route.routeMode || "",
      Number(route.distanceKm || 0).toFixed(1),
      Math.round(Number(route.timeMin || 0)),
      Number(route.cost || 0).toFixed(2),
      Number(route.routeFragilityPenalty || 0).toFixed(3),
    ].join(":");
    const exactKey = `${metricKey}:${routeGeometrySignature(route)}`;
    if (exactKeys.has(exactKey)) return false;
    const metricCount = metricCounts.get(metricKey) || 0;
    if (metricCount >= 2) return false;
    exactKeys.add(exactKey);
    metricCounts.set(metricKey, metricCount + 1);
    return true;
  });
}

function chooseWaypoint(origin, destination, candidates) {
  if (!origin || !destination) return null;
  const midpoint = {
    lat: (origin.lat + destination.center[0]) / 2,
    lon: (origin.lon + destination.center[1]) / 2,
  };

  return candidates
    .filter((district) => district.id !== destination.id && hasValidCenter(district))
    .map((district) => ({
      district,
      score:
        distanceKm(district.center, origin) +
        distanceKm(district.center, { lat: destination.center[0], lon: destination.center[1] }) +
        distanceKm(district.center, midpoint),
    }))
    .sort((a, b) => a.score - b.score)[0]?.district || null;
}

function buildRouteMetrics(distance, route) {
  const speedKmh = Math.max(20, Number(route.speedKmh || 30));
  const timeMin = (distance / speedKmh) * 60 * Number(route.timeFactor || 1);
  const cost = distance * 3.8 * Number(route.costFactor || 1) + timeMin * 0.18;
  return {
    distanceKm: distance,
    timeMin,
    cost,
  };
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

function fitMapToPoints(map, points, options = {}) {
  const validPoints = validLatLngs(points);
  if (!validPoints.length) return;
  if (validPoints.length === 1) {
    map.setView(validPoints[0], options.zoom || 11);
    return;
  }
  map.fitBounds(validPoints, {
    padding: options.padding || [34, 34],
    maxZoom: options.maxZoom || 13,
  });
}

function CandidateRoutesMap({
  origin,
  destination,
  routes,
  bestRouteId,
  selectedRouteId,
  highlightedRouteId,
  mapView,
  mapExpanded,
  onToggleExpanded,
  onHighlightRoute,
  onToggleRoute,
}) {
  const mapRef = useRef(null);
  const routePoints = useMemo(
    () => [
      origin ? [origin.lat, origin.lon] : null,
      destination?.center || null,
      ...routes.flatMap((route) => routeLatLngs(route)),
    ].filter(Boolean),
    [destination, origin, routes]
  );
  const initialCenter = routePoints[0] || [-12.0464, -77.0428];
  const activeAlternativeId =
    highlightedRouteId || (selectedRouteId && selectedRouteId !== bestRouteId ? selectedRouteId : "");
  const activeAlternative = routes.find((route) => route.id === activeAlternativeId);
  const bestRoute = routes.find((route) => route.id === bestRouteId);
  const intersectionNodes = useMemo(() => routeIntersectionNodes(routes), [routes]);
  const showNetwork = routes.length > 0;
  const showIntersections = mapView === "local" && intersectionNodes.length > 0;
  const mapDescription =
    bestRoute?.routeType === "local"
      ? "Red local estimada. Se muestra como referencia operativa."
      : bestRoute?.routeType === "conceptual"
        ? "Referencia conceptual. No es una ruta vial validada."
        : routes.length || mapView === "road"
          ? "Ruta vial por calles. La mejor alternativa se muestra en verde."
          : "Red local estimada. Se muestra como referencia operativa.";

  return (
    <article className="route-explorer-map-panel">
      <div className="route-explorer-map-heading route-map-card-header">
        <div>
          <h3>Rutas candidatas</h3>
          <p>{mapDescription}</p>
        </div>
        <div
          className="dashboard-map-toolbar route-map-header-actions"
          aria-label="Controles del mapa"
        >
          <button
            type="button"
            aria-label={mapExpanded ? "Reducir mapa" : "Ampliar mapa"}
            title={mapExpanded ? "Reducir mapa" : "Ampliar mapa"}
            aria-pressed={mapExpanded}
            onClick={onToggleExpanded}
          >
            <span className="toolbar-icon toolbar-icon-expand" aria-hidden="true" />
            <span>{mapExpanded ? "Reducir" : "Ampliar"}</span>
          </button>
          <button
            type="button"
            aria-label="Centrar rutas en el mapa"
            title="Centrar rutas"
            onClick={() => fitMapToPoints(mapRef.current, routePoints)}
          >
            <span className="toolbar-icon toolbar-icon-target" aria-hidden="true" />
            <span>Centrar</span>
          </button>
        </div>
      </div>
      <div className="route-explorer-map-shell">
        <MapContainer
          ref={mapRef}
          center={initialCenter}
          zoom={8}
          scrollWheelZoom
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {showNetwork &&
            routes.map((route) =>
              route.geoJson ? (
              <GeoJSON
                key={`${route.id}-network`}
                data={route.geoJson}
                style={{
                  color:
                    route.routeType === "conceptual"
                      ? "#d97706"
                      : route.routeType === "local"
                        ? routeColors.local
                        : routeColors.network,
                  dashArray:
                    route.routeType === "conceptual"
                      ? "4 10"
                      : route.routeType === "local"
                        ? "3 9"
                        : "7 8",
                  opacity: 0.34,
                  weight: 3,
                }}
                eventHandlers={{
                  click: () => onToggleRoute(route.id),
                  mouseover: () => onHighlightRoute(route.id),
                  mouseout: () => onHighlightRoute(""),
                }}
              />
              ) : null
            )}

          {bestRoute?.geoJson && (
            <GeoJSON
              key={`${bestRoute.id}-best`}
              data={bestRoute.geoJson}
              style={{
                color:
                  bestRoute.routeType === "conceptual"
                    ? "#d97706"
                    : bestRoute.routeType === "local"
                      ? routeColors.local
                      : routeColors.best,
                dashArray:
                  bestRoute.routeType === "conceptual"
                    ? "8 10"
                    : bestRoute.routeType === "local"
                      ? "3 9"
                      : undefined,
                opacity: 0.98,
                weight: 6,
              }}
              eventHandlers={{
                click: () => onToggleRoute(bestRoute.id),
                mouseover: () => onHighlightRoute(bestRoute.id),
                mouseout: () => onHighlightRoute(""),
              }}
            />
          )}

          {activeAlternative?.geoJson && activeAlternative.id !== bestRouteId && (
            <GeoJSON
              key={`${activeAlternative.id}-active`}
              data={activeAlternative.geoJson}
              style={{
                color:
                  activeAlternative.routeType === "conceptual"
                    ? "#d97706"
                    : activeAlternative.routeType === "local"
                      ? routeColors.local
                      : routeColors.selected,
                dashArray:
                  activeAlternative.routeType === "conceptual"
                    ? "8 10"
                    : activeAlternative.routeType === "local"
                      ? "3 9"
                      : undefined,
                opacity: 0.98,
                weight: 6,
              }}
              eventHandlers={{
                click: () => onToggleRoute(activeAlternative.id),
                mouseover: () => onHighlightRoute(activeAlternative.id),
                mouseout: () => onHighlightRoute(""),
              }}
            />
          )}

          {showIntersections && intersectionNodes.map((node) => (
            <CircleMarker
              key={node.id}
              center={node.center}
              radius={3}
              pathOptions={{
                color: "#475569",
                fillColor: "#ffffff",
                fillOpacity: 0.95,
                opacity: 0.9,
                weight: 1.5,
              }}
            />
          ))}

          {origin && (
            <EpsMapMarker origin={origin}>
              <br />
              EPS de referencia
            </EpsMapMarker>
          )}

          {destination?.center && (
            <CircleMarker
              center={destination.center}
              radius={10}
              pathOptions={{
                color: priorityColor(destination.criticidad).stroke,
                fillColor: priorityColor(destination.criticidad).fill,
                fillOpacity: 0.9,
                weight: 2,
              }}
            >
              <Tooltip direction="top" opacity={0.95}>
                Destino: {destination.nombre}
              </Tooltip>
              <Popup>
                <strong>{destination.nombre}</strong>
                <br />
                Zona destino
              </Popup>
            </CircleMarker>
          )}
        </MapContainer>
      </div>
    </article>
  );
}

export default function MapaOperativo() {
  const [searchParams] = useSearchParams();
  const districts = useMemo(() => aquaRutaData.districts || [], []);
  const epsOrigins = useMemo(() => aquaRutaData.epsOrigins || [], []);
  const groupedZones = useMemo(() => aquaRutaData.groupedZones || [], []);
  const sectorizedZones = useMemo(() => aquaRutaData.sectorizedZones || {}, []);

  const requestedGroupId = searchParams.get("grupo") || "";
  const requestedDestinationId =
    searchParams.get("distrito") || searchParams.get("destino") || "";
  const requestedCriterion = searchParams.get("criterio") || "distancia";

  const validDistricts = useMemo(
    () => districts.filter(hasValidCenter).sort((a, b) => a.nombre.localeCompare(b.nombre)),
    [districts]
  );
  const districtMap = useMemo(
    () => new Map(validDistricts.map((district) => [district.id, district])),
    [validDistricts]
  );
  const groupOptions = useMemo(
    () => {
      const groups = groupedZones.length
        ? groupedZones.map((group) => ({
            groupId: group.id,
            groupName: group.nombre,
            zoneIds: group.zona_ids || [],
            zonesCount: group.cantidad_zonas || group.zona_ids?.length || 0,
          }))
        : Object.values(sectorizedZones).map((group) => ({
            groupId: group.groupId,
            groupName: group.groupName,
            zoneIds: [],
            zonesCount: group.groupZonesCount || 0,
          }));
      return groups.filter(isVisibleOperationalGroup);
    },
    [groupedZones, sectorizedZones]
  );
  const groupIds = groupOptions.map((group) => group.groupId);
  const requestedGroup = useMemo(
    () =>
      requestedDestinationId
        ? groupOptions.find((group) => (group.zoneIds || []).includes(requestedDestinationId))
        : null,
    [groupOptions, requestedDestinationId]
  );
  const [selectedGroupId, setSelectedGroupId] = useState(
    groupIds.includes(requestedGroupId)
      ? requestedGroupId
      : requestedGroup?.groupId || groupOptions[0]?.groupId || ""
  );
  const [selectedSectorKey, setSelectedSectorKey] = useState("");
  const [selectedDistrictId, setSelectedDistrictId] = useState("");
  const initialDestinationId =
    validDistricts.some((district) => district.id === requestedDestinationId)
      ? requestedDestinationId
      : "";
  const [criterion, setCriterion] = useState(
    ["distancia", "tiempo", "costo"].includes(requestedCriterion)
      ? requestedCriterion
      : "distancia"
  );
  const [routeResults, setRouteResults] = useState([]);
  const [routeResultsKey, setRouteResultsKey] = useState("");
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState("");
  const [routeErrorKey, setRouteErrorKey] = useState("");
  const [highlightedRouteId, setHighlightedRouteId] = useState("");
  const [selectedInfoRouteId, setSelectedInfoRouteId] = useState("");
  const [mapView, setMapView] = useState("road");
  const [mapExpanded, setMapExpanded] = useState(false);
  const [autoCalculationToken, setAutoCalculationToken] = useState(0);
  const routeRequestSeqRef = useRef(0);
  const routeAbortControllerRef = useRef(null);
  const routeLoadingRef = useRef(false);
  const calculateButtonRef = useRef(null);
  const lastAutoCalculationTokenRef = useRef(-1);

  const selectedGroup =
    groupOptions.find((group) => group.groupId === selectedGroupId) ||
    groupOptions[0] ||
    null;
  const selectedSectorizedGroup = selectedGroupId ? sectorizedZones[selectedGroupId] || null : null;
  const sectorOptions = useMemo(() => {
    const criteria = selectedSectorizedGroup?.criterios || {};
    const criterionKey = criteria[DEFAULT_SECTOR_CRITERION]
      ? DEFAULT_SECTOR_CRITERION
      : Object.keys(criteria)[0] || "";
    const byCount = criteria[criterionKey] || {};
    const sectorCount = byCount["3"] ? "3" : Object.keys(byCount)[0] || "";
    const sectors = (byCount[sectorCount] || []).map((sector) => ({
      ...sector,
      key: `${criterionKey}:${sectorCount}:${sector.id}`,
      zones: (sector.zona_ids || [])
        .map((id) => districtMap.get(id))
        .filter(Boolean)
        .sort((a, b) => a.nombre.localeCompare(b.nombre)),
    }));
    if (sectors.length || !selectedGroup) return sectors;
    const zones = (selectedGroup.zoneIds || [])
      .map((id) => districtMap.get(id))
      .filter(Boolean)
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
    return zones.length
      ? [
          {
            id: `${selectedGroup.groupId}-sector-unico`,
            key: `grupo:${selectedGroup.groupId}:sector-unico`,
            nombre: "Sector unico",
            cantidad_zonas: zones.length,
            zona_ids: zones.map((zone) => zone.id),
            zones,
          },
        ]
      : [];
  }, [districtMap, selectedGroup, selectedSectorizedGroup]);
  const selectedSector =
    sectorOptions.find((sector) => sector.key === selectedSectorKey) ||
    sectorOptions.find((sector) => (sector.zona_ids || []).includes(selectedDistrictId || initialDestinationId)) ||
    sectorOptions[0] ||
    null;
  const districtOptions = useMemo(() => selectedSector?.zones || [], [selectedSector]);
  const selectedDistrict =
    districtOptions.find((district) => district.id === selectedDistrictId) ||
    districtOptions.find((district) => district.id === initialDestinationId) ||
    districtOptions[0] ||
    null;
  const selectedDestination = selectedDistrict;
  const selectedOrigin = selectedDestination
    ? [...epsOrigins]
        .map((origin) => ({
          ...origin,
          distanceToDestination: distanceKm(selectedDestination.center, origin),
        }))
        .sort((a, b) => a.distanceToDestination - b.distanceToDestination)[0] || null
    : null;
  const secondRouteWaypoint = useMemo(
    () => chooseWaypoint(selectedOrigin, selectedDestination, districtOptions),
    [districtOptions, selectedDestination, selectedOrigin]
  );
  const selectionComplete = Boolean(
    selectedGroup && selectedSector && selectedDistrict && selectedDestination && selectedOrigin
  );

  const routeRequestKey = useMemo(
    () =>
      selectionComplete
        ? `${mapView}:${coordinateSignature([
            [selectedOrigin.lon, selectedOrigin.lat],
            secondRouteWaypoint
              ? [secondRouteWaypoint.center[1], secondRouteWaypoint.center[0]]
              : [0, 0],
            [selectedDestination.center[1], selectedDestination.center[0]],
          ])}`
        : "",
    [mapView, secondRouteWaypoint, selectedDestination, selectedOrigin, selectionComplete]
  );
  const activeRouteResults = useMemo(
    () => (routeResultsKey === routeRequestKey ? routeResults : []),
    [routeRequestKey, routeResults, routeResultsKey]
  );
  const activeRouteError = routeErrorKey === routeRequestKey ? routeError : "";

  const enrichedRoutes = useMemo(() => {
    const routes = activeRouteResults.map((route) => {
      const geoJson = route.geoJson;
      const distanceKmValue = summaryDistanceKm(geoJson) || 0;
      const timeMin = summaryDurationMin(geoJson);
      const routeMetrics = route.routeMetrics || routeMetricsFromPayload(geoJson) || {};
      const traffic = routeTrafficFromMetrics(route, routeMetrics);
      const metrics = timeMin
        ? {
            distanceKm: distanceKmValue,
            timeMin,
            cost:
              Number(routeMetrics.operationalCost) ||
              Number(routeMetrics.costo_operativo) ||
              distanceKmValue * 3.8 + timeMin * 0.18,
          }
        : buildRouteMetrics(distanceKmValue, route);
      return {
        ...route,
        geoJson,
        ...metrics,
        routeFragilityPenalty:
          routeMetrics.routeFragilityPenalty ??
          routeMetrics.penalizacion_fragilidad_ruta ??
          null,
        edgeOperationalWeight:
          routeMetrics.edgeOperationalWeight ?? routeMetrics.peso_operativo_arista ?? null,
        routeMetricsSource: routeMetrics.source || routeMetrics.route_metrics_source || "",
        routeMetricsCached: Boolean(routeMetrics.cached || routeMetrics.route_metrics_cached),
        traffic,
      };
    });
    const uniqueRoutes = dedupeRouteAlternatives(routes);
    const bestByMetric = {
      distancia: [...uniqueRoutes].sort((a, b) => a.distanceKm - b.distanceKm)[0]?.id,
      tiempo: [...uniqueRoutes].sort((a, b) => a.timeMin - b.timeMin)[0]?.id,
      costo: [...uniqueRoutes].sort((a, b) => a.cost - b.cost)[0]?.id,
      fragilidad: [...uniqueRoutes].sort(
        (a, b) =>
          Number(a.routeFragilityPenalty ?? 999) - Number(b.routeFragilityPenalty ?? 999)
      )[0]?.id,
    };
    return [...uniqueRoutes]
      .map((route) => {
        const strengths = Object.entries(bestByMetric)
          .filter(([, routeId]) => routeId === route.id)
          .map(([metric]) => metric);
        return {
          ...route,
          strengths: strengths.length ? strengths : ["distancia"],
          primaryStrength: strengths[0] || "distancia",
        };
      })
      .sort((a, b) => routeScore(a, criterion) - routeScore(b, criterion))
      .map((route, index) => ({
        ...route,
        nombre:
          route.routeType === "road"
            ? `Ruta candidata ${index + 1}`
            : route.nombre,
      }));
  }, [activeRouteResults, criterion]);

  const bestRoute = enrichedRoutes[0] || null;
  const selectedRoute =
    enrichedRoutes.find((route) => route.id === selectedInfoRouteId) || bestRoute;
  const bestRouteId = bestRoute?.id || "";
  const selectedRouteId = selectedInfoRouteId || bestRouteId;
  const hasCalculatedRoutes = enrichedRoutes.length > 0;
  const selectedRouteCoordinates = selectionComplete
    ? [
        [selectedOrigin.lon, selectedOrigin.lat],
        [selectedDestination.center[1], selectedDestination.center[0]],
      ]
    : null;

  useEffect(() => {
    const timer = window.setTimeout(() => window.dispatchEvent(new Event("resize")), 220);
    return () => window.clearTimeout(timer);
  }, [mapExpanded]);

  useEffect(() => {
    return () => {
      routeAbortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (
      lastAutoCalculationTokenRef.current === autoCalculationToken ||
      !selectionComplete ||
      !routeRequestKey
    ) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      if (!calculateButtonRef.current) return;
      lastAutoCalculationTokenRef.current = autoCalculationToken;
      calculateButtonRef.current.click();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [autoCalculationToken, routeRequestKey, selectionComplete]);

  function resetRouteState() {
    routeAbortControllerRef.current?.abort();
    routeRequestSeqRef.current += 1;
    routeLoadingRef.current = false;
    setRouteLoading(false);
    setRouteResults([]);
    setRouteResultsKey("");
    setRouteError("");
    setRouteErrorKey("");
    setHighlightedRouteId("");
    setSelectedInfoRouteId("");
  }

  function clearSelection() {
    setSelectedGroupId(groupOptions[0]?.groupId || "");
    setSelectedSectorKey("");
    setSelectedDistrictId("");
    setCriterion("distancia");
    setMapView("road");
    resetRouteState();
    setAutoCalculationToken((current) => current + 1);
  }

  async function loadSelectedRoute() {
    if (!selectionComplete || !selectedRouteCoordinates) return;
    if (routeLoadingRef.current) return;

    routeAbortControllerRef.current?.abort();
    const controller = new AbortController();
    routeAbortControllerRef.current = controller;
    const requestSeq = routeRequestSeqRef.current + 1;
    routeRequestSeqRef.current = requestSeq;
    routeLoadingRef.current = true;
    const requestKey = routeRequestKey;
    setRouteLoading(true);
    setRouteError("");
    setRouteResults([]);
    setSelectedInfoRouteId("");

    try {
      const routeRequests = [
        {
          coordinates: selectedRouteCoordinates,
          source: selectedOrigin?.id || selectedOrigin?.prestador || "",
          target: selectedDestination?.id || selectedDestination?.nombre || "",
          viewMode: mapView === "local" ? "local" : "road",
          alternativeRoutes: {
            target_count: ORS_MAX_ALTERNATIVE_ROUTES,
            share_factor: 0.6,
            weight_factor: 1.6,
          },
        },
      ];

      if (secondRouteWaypoint) {
        routeRequests.push({
          coordinates: [
            [selectedOrigin.lon, selectedOrigin.lat],
            [secondRouteWaypoint.center[1], secondRouteWaypoint.center[0]],
            [selectedDestination.center[1], selectedDestination.center[0]],
          ],
          source: selectedOrigin?.id || selectedOrigin?.prestador || "",
          target: selectedDestination?.id || selectedDestination?.nombre || "",
          viewMode: mapView === "local" ? "local" : "road",
        });
      }

      const payload = await fetchRouteGeoJsonBatch(routeRequests, { signal: controller.signal });
      if (routeRequestSeqRef.current !== requestSeq || controller.signal.aborted) return;
      const candidateRoutes = (payload.routes || [])
        .map(routeGeoJsonFromBatchItem)
        .filter(Boolean)
        .flatMap((geoJson, index) =>
          splitRouteAlternatives(geoJson, {
            idPrefix: `ruta-real-${index + 1}`,
            nameOffset: 0,
            via: index === 0
              ? "Trazado directo por calles"
                : `Ruta vía ${secondRouteWaypoint?.nombre || "punto intermedio"}`,
          })
        );
      const hasRoadRoute = candidateRoutes.some(
        (route) => route.routeType !== "conceptual" && route.routeType !== "not_required"
      );
      const routes = candidateRoutes
        .filter(
          (route) =>
            !hasRoadRoute ||
            (route.routeType !== "conceptual" && route.routeType !== "not_required")
        )
        .map((route, index) => ({
          ...route,
          nombre:
            route.routeType === "not_required"
              ? "Ruta no requerida"
              : route.routeType === "local"
                ? "Red local estimada"
                : route.routeType === "conceptual"
                  ? "Ruta conceptual estimada"
                  : `Ruta candidata ${index + 1}`,
          via:
            route.routeType === "not_required"
              ? route.message
              : route.routeType === "local"
                ? "Conexión local estimada; no es una ruta vial"
                : route.routeType === "conceptual"
                  ? "Referencia aproximada; no es una ruta vial validada"
                  : route.id.startsWith("ruta-real-1")
                    ? "Trazado directo por calles"
                    : `Trazado via ${secondRouteWaypoint?.nombre || "punto intermedio"}`,
        }))
        .slice(0, MAX_CANDIDATE_ROUTES);
      if (!routes.length) {
        throw new Error("OpenRouteService no devolvió rutas por calles para este destino.");
      }
      setRouteResults(routes);
      setRouteResultsKey(requestKey);
      setRouteErrorKey("");
      setSelectedInfoRouteId("");
    } catch (error) {
      if (error?.name === "AbortError") return;
      if (routeRequestSeqRef.current !== requestSeq) return;
      setRouteError(error.message || "No se pudo calcular la ruta real.");
      setRouteErrorKey(requestKey);
      setRouteResults([]);
      setRouteResultsKey("");
    } finally {
      if (routeRequestSeqRef.current === requestSeq) {
        routeLoadingRef.current = false;
        setRouteLoading(false);
      }
    }
  }

  function routeState(route) {
    if (route.id === bestRouteId) return "Mejor ruta";
    if (route.strengths?.includes("tiempo")) return "Menor tiempo";
    if (route.strengths?.includes("costo")) return "Menor costo";
    if (route.strengths?.includes("fragilidad")) return "Menor fragilidad";
    if (route.strengths?.includes("distancia")) return "Menor distancia";
    return "Alternativa";
  }

  return (
    <MainLayout>
      <section className={`page-section route-explorer-page workspace-page ${mapExpanded ? "workspace-expanded" : ""}`}>
        <article className="page-card route-explorer-hero">
          <div>
            <h2 className="page-title">Exploración de rutas</h2>
            <p className="page-subtitle">
              Compara rutas candidatas entre una EPS de referencia y una zona de destino.
            </p>
          </div>
        </article>

        <article id="route-control-panel" className="panel route-explorer-controls workspace-side-panel">
              <h3 className="panel-title">Controles</h3>
              <div className="route-control-stack">
                <label className="control-group">
                  <span className="control-label">Grupo operativo</span>
                  <select
                    className="control-select"
                    value={selectedGroupId}
                    disabled={routeLoading}
                    onChange={(event) => {
                      setSelectedGroupId(event.target.value);
                      setSelectedSectorKey("");
                      setSelectedDistrictId("");
                      resetRouteState();
                    }}
                  >
                    {groupOptions.map((group) => (
                      <option key={group.groupId} value={group.groupId}>
                        {group.groupName} ({group.zonesCount} zonas)
                      </option>
                    ))}
                  </select>
                </label>

                <label className="control-group">
                  <span className="control-label">Sector de atención</span>
                  <select
                    className="control-select"
                    value={selectedSector?.key || ""}
                    disabled={routeLoading || !selectedGroup}
                    onChange={(event) => {
                      setSelectedSectorKey(event.target.value);
                      setSelectedDistrictId("");
                      resetRouteState();
                    }}
                  >
                    {sectorOptions.map((sector) => (
                      <option key={sector.key} value={sector.key}>
                        {sector.nombre} - {sector.cantidad_zonas} zonas
                      </option>
                    ))}
                  </select>
                </label>

                <label className="control-group">
                  <span className="control-label">Zona destino</span>
                  <select
                    className="control-select"
                    value={selectedDistrict?.id || ""}
                    disabled={routeLoading || !selectedSector}
                    onChange={(event) => {
                      setSelectedDistrictId(event.target.value);
                      resetRouteState();
                    }}
                  >
                    {districtOptions.map((district) => (
                      <option key={district.id} value={district.id}>
                        {district.nombre} - {district.provincia}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="control-group">
                  <span className="control-label">Priorizar por</span>
                  <select
                    className="control-select"
                    value={criterion}
                    disabled={routeLoading}
                    onChange={(event) => {
                      setCriterion(event.target.value);
                    }}
                  >
                    <option value="distancia">Menor distancia</option>
                    <option value="tiempo">Menor tiempo estimado</option>
                    <option value="costo">Menor costo estimado</option>
                    <option value="fragilidad">Menor riesgo de bloqueo</option>
                  </select>
                </label>

                <label className="control-group">
                  <span className="control-label">Tipo de visualización</span>
                  <select
                    className="control-select"
                    value={mapView}
                    onChange={(event) => {
                      setMapView(event.target.value);
                      resetRouteState();
                    }}
                  >
                    <option value="road">Ruta vial</option>
                    <option value="local">Red local</option>
                  </select>
                </label>

                <div className="route-control-actions">
                  <button
                    ref={calculateButtonRef}
                    className="route-calculate-button"
                    type="button"
                    disabled={routeLoading || !selectionComplete || !selectedRouteCoordinates}
                    title={
                      selectionComplete
                        ? "Calcular rutas candidatas"
                        : "Selecciona grupo, sector y zona destino para calcular"
                    }
                    onClick={loadSelectedRoute}
                  >
                    {routeLoading ? "Calculando..." : "Calcular rutas"}
                  </button>

                  <button
                    className="route-clear-button"
                    type="button"
                    disabled={routeLoading}
                    onClick={clearSelection}
                  >
                    Limpiar selección
                  </button>
                </div>
              </div>
        </article>

        <section className="route-explorer-layout workspace-map-layout">
          <CandidateRoutesMap
            origin={selectedOrigin}
            destination={selectedDestination}
            routes={enrichedRoutes}
            bestRouteId={bestRouteId}
            selectedRouteId={selectedRouteId}
            highlightedRouteId={highlightedRouteId}
            mapView={mapView}
            mapExpanded={mapExpanded}
            onToggleExpanded={() => setMapExpanded((current) => !current)}
            onHighlightRoute={setHighlightedRouteId}
            onToggleRoute={(routeId) => {
              setSelectedInfoRouteId((current) => (current === routeId ? "" : routeId));
            }}
          />

          <article className="panel route-result-panel">
            <h3 className="panel-title">Resultado</h3>
            <div className="route-result-grid">
              <div>
                <span>Origen</span>
                <strong>{selectedOrigin?.prestador || "No disponible"}</strong>
              </div>
              <div>
                <span>Destino</span>
                <strong>{selectedDestination?.nombre || "No disponible"}</strong>
              </div>
              <div>
                <span>Priorizar por</span>
                <strong>{criterionLabels[criterion]}</strong>
              </div>
              {hasCalculatedRoutes && (
                <>
                <div className="selected">
                  <span>Ruta candidata seleccionada</span>
                  <strong>{selectedRoute?.nombre}</strong>
                </div>
                <div className="selected">
                  <span>Distancia estimada</span>
                  <strong>{formatKm(selectedRoute?.distanceKm)}</strong>
                </div>
                <div className="selected">
                  <span>Tiempo estimado</span>
                  <strong>{formatTime(selectedRoute?.timeMin)}</strong>
                </div>
                <div className="selected">
                  <span>Costo operativo estimado</span>
                  <strong>{formatMoney(selectedRoute?.cost)}</strong>
                </div>
                </>
              )}
            </div>

            {hasCalculatedRoutes && selectedRoute?.routeType === "conceptual" && (
              <section className="conceptual-route-warning">
                <strong>Ruta conceptual estimada</strong>
                <span>
                  No se encontró ruta vial por calles; se muestra referencia conceptual.
                </span>
                <small>No es una ruta vial validada.</small>
              </section>
            )}

            {hasCalculatedRoutes && selectedRoute?.routeType === "not_required" && (
              <section className="route-not-required">
                <strong>Ruta no requerida</strong>
                <span>
                  {selectedRoute.message ||
                    "La EPS de referencia se encuentra en la misma zona destino. No se requiere ruta vial."}
                </span>
              </section>
            )}

            {activeRouteError && (
              <div className="route-error-message">
                <strong>No se pudo cargar la ruta</strong>
                <span>{activeRouteError}</span>
              </div>
            )}

            {hasCalculatedRoutes && (
            <div className="route-candidate-list">
              <div className="route-list-heading">
                <span>Alternativas disponibles</span>
              </div>
              {enrichedRoutes.map((route) => (
                <button
                  key={route.id}
                  type="button"
                  disabled={routeLoading}
                  className={[
                    route.id === bestRouteId ? "best" : "",
                    route.id === selectedRouteId ? "active" : "",
                  ].filter(Boolean).join(" ")}
                  onClick={() => {
                    setSelectedInfoRouteId((current) => (current === route.id ? "" : route.id));
                  }}
                  onMouseEnter={() => setHighlightedRouteId(route.id)}
                  onMouseLeave={() => setHighlightedRouteId("")}
                >
                  <div className="route-card-head">
                    <strong>{route.nombre}</strong>
                    <span>{routeState(route)}</span>
                  </div>
                  <em>
                    {formatKm(route.distanceKm)} / {formatTime(route.timeMin)} / {formatMoney(route.cost)}
                  </em>
                  {route.traffic?.trafficDelayMin != null && (
                    <small className="route-traffic-summary">
                      Tráfico estimado: +{route.traffic.trafficDelayMin.toFixed(2)} min
                    </small>
                  )}
                </button>
              ))}
            </div>
            )}
          </article>
        </section>
      </section>
    </MainLayout>
  );
}
