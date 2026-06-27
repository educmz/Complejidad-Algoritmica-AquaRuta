import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  CircleMarker,
  GeoJSON,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import MainLayout from "../components/layout/MainLayout";
import { aquaRutaData } from "../data/aquaRutaData";
import { fetchRouteGeoJsonBatch } from "../services/mapApi";
import { epsCoverageStatus, epsRequiresValidation } from "../utils/epsCoverage";

const routeColors = {
  selected: "#2563eb",
  highlighted: "#2563eb",
  best: "#16a34a",
  network: "#64748b",
};

const ORS_MAX_ALTERNATIVE_ROUTES = 3;
const MAX_CANDIDATE_ROUTES = ORS_MAX_ALTERNATIVE_ROUTES + 2;

const criterionLabels = {
  distancia: "menor distancia",
  tiempo: "menor tiempo",
  costo: "menor costo",
  fragilidad: "menor fragilidad",
};

const DEFAULT_SECTOR_CRITERION = "mixto";

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

function formatDecimal(value) {
  if (!Number.isFinite(Number(value))) return "No disponible";
  return Number(value).toFixed(3);
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

function routeGeoJsonFromBatchItem(item) {
  if (!item) return null;
  if (item.ok === false) return null;
  return item.result || item.geoJson || item;
}

function splitRouteAlternatives(geoJson, options = {}) {
  const idPrefix = options.idPrefix || "ruta-real";
  const nameOffset = Number(options.nameOffset || 0);
  const via = options.via || "Trazado por calles";
  return (geoJson?.features || []).map((feature, index) => ({
    id: `${idPrefix}-${index + 1}`,
    nombre: `Ruta candidata ${nameOffset + index + 1}`,
    via,
    geoJson: featureToCollection(feature, geoJson),
    routeMetrics: routeMetricsFromPayload(geoJson),
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

function makeIcon(label, color) {
  return L.divIcon({
    className: "",
    html: `
      <div style="
        align-items:center;
        background:${color};
        border:2px solid white;
        border-radius:999px;
        box-shadow:0 8px 18px rgba(15,23,42,.2);
        color:white;
        display:flex;
        font:900 11px Inter, Arial, sans-serif;
        height:36px;
        justify-content:center;
        width:36px;
      ">${label}</div>
    `,
    iconAnchor: [18, 18],
    iconSize: [36, 36],
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

function RouteMapController({ routePoints }) {
  const map = useMap();
  const controlsRef = useRef(null);
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

  return (
    <div ref={controlsRef} className="map-action-controls leaflet-control route-explorer-map-actions">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          userHasInteractedRef.current = false;
          fitMapToPoints(map, routePoints);
        }}
      >
        Ajustar rutas
      </button>
    </div>
  );
}

function CandidateRoutesMap({
  origin,
  destination,
  routes,
  bestRouteId,
  selectedRouteId,
  highlightedRouteId,
  mapView,
  onHighlightRoute,
  onToggleRoute,
}) {
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
  const showIntersections = mapView === "network" && intersectionNodes.length > 0;

  return (
    <article className="route-explorer-map-panel">
      <div className="route-explorer-map-heading">
        <div>
          <h3>Rutas candidatas</h3>
          <p>{routes.length ? "Red gris, mejor ruta verde, alternativa azul." : "Completa la selección y calcula para ver rutas."}</p>
        </div>
      </div>
      <div className="route-explorer-map-shell">
        <MapContainer center={initialCenter} zoom={8} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <RouteMapController routePoints={routePoints} />

          {showNetwork &&
            routes.map((route) =>
              route.geoJson ? (
              <GeoJSON
                key={`${route.id}-network`}
                data={route.geoJson}
                style={{
                  color: routeColors.network,
                  dashArray: "7 8",
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
                color: routeColors.best,
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
                color: routeColors.selected,
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

          {!routes.length && (
            <div className="route-map-empty leaflet-control">
              Selecciona grupo, sector y zona destino para calcular rutas candidatas.
            </div>
          )}

          {origin && (
            <Marker position={[origin.lat, origin.lon]} icon={makeIcon("EPS", "#1d4ed8")}>
              <Popup>
                <strong>{origin.prestador}</strong>
                <br />
                EPS de referencia
              </Popup>
            </Marker>
          )}

          {destination?.center && (
            <CircleMarker
              center={destination.center}
              radius={10}
              pathOptions={{
                color: "#166534",
                fillColor: "#16a34a",
                fillOpacity: 0.95,
                weight: 3,
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
    () =>
      groupedZones.length
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
          })),
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
    groupIds.includes(requestedGroupId) ? requestedGroupId : requestedGroup?.groupId || ""
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
  const routeRequestSeqRef = useRef(0);
  const routeAbortControllerRef = useRef(null);
  const routeLoadingRef = useRef(false);

  const selectedGroup =
    groupOptions.find((group) => group.groupId === selectedGroupId) || null;
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
    null;
  const districtOptions = useMemo(() => selectedSector?.zones || [], [selectedSector]);
  const selectedDistrict =
    districtOptions.find((district) => district.id === selectedDistrictId) ||
    districtOptions.find((district) => district.id === initialDestinationId) ||
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
  const selectedOriginCoverage = epsCoverageStatus(selectedOrigin?.distanceToDestination);

  const routeRequestKey = useMemo(
    () =>
      selectionComplete
        ? coordinateSignature([
            [selectedOrigin.lon, selectedOrigin.lat],
            secondRouteWaypoint
              ? [secondRouteWaypoint.center[1], secondRouteWaypoint.center[0]]
              : [0, 0],
            [selectedDestination.center[1], selectedDestination.center[0]],
          ])
        : "",
    [secondRouteWaypoint, selectedDestination, selectedOrigin, selectionComplete]
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
      };
    });
    const bestByMetric = {
      distancia: [...routes].sort((a, b) => a.distanceKm - b.distanceKm)[0]?.id,
      tiempo: [...routes].sort((a, b) => a.timeMin - b.timeMin)[0]?.id,
      costo: [...routes].sort((a, b) => a.cost - b.cost)[0]?.id,
      fragilidad: [...routes].sort(
        (a, b) =>
          Number(a.routeFragilityPenalty ?? 999) - Number(b.routeFragilityPenalty ?? 999)
      )[0]?.id,
    };
    return [...routes]
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
      .sort((a, b) => routeScore(a, criterion) - routeScore(b, criterion));
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
    return () => {
      routeAbortControllerRef.current?.abort();
    };
  }, []);

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
    setSelectedGroupId("");
    setSelectedSectorKey("");
    setSelectedDistrictId("");
    setCriterion("distancia");
    resetRouteState();
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
        });
      }

      const payload = await fetchRouteGeoJsonBatch(routeRequests, { signal: controller.signal });
      if (routeRequestSeqRef.current !== requestSeq || controller.signal.aborted) return;
      const routes = (payload.routes || [])
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
        )
        .map((route, index) => ({
          ...route,
          nombre: `Ruta candidata ${index + 1}`,
          via: route.id.startsWith("ruta-real-1")
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
      <section className="page-section route-explorer-page">
        <article className="page-card route-explorer-hero">
          <div>
            <h2 className="page-title">Exploración de rutas</h2>
            <p className="page-subtitle">
              Compara rutas candidatas entre una EPS de referencia y una zona de destino.
            </p>
          </div>
        </article>

        <article className="panel route-explorer-controls">
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
                    <option value="">Seleccionar grupo</option>
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
                    <option value="">Seleccionar sector</option>
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
                    <option value="">Seleccionar zona</option>
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
                    <option value="fragilidad">Menor fragilidad de ruta</option>
                  </select>
                </label>

                <label className="control-group">
                  <span className="control-label">Tipo de visualización</span>
                  <select
                    className="control-select"
                    value={mapView}
                    onChange={(event) => setMapView(event.target.value)}
                  >
                    <option value="road">Ruta vial</option>
                    <option value="network">Red local</option>
                  </select>
                </label>

                <div className="route-origin-summary">
                  <span>EPS de referencia</span>
                  <strong>{selectedOrigin?.prestador || "No disponible"}</strong>
                  <small>
                    {selectedOrigin
                      ? `${formatKm(selectedOrigin.distanceToDestination)} hasta el destino`
                      : "Completa el destino para calcular la EPS"}
                  </small>
                </div>

                {selectedOrigin && (
                  <div className="route-origin-summary">
                    <span className={`territory-eps-status ${selectedOriginCoverage.key}`}>
                      {selectedOriginCoverage.label}
                    </span>
                    <small>{selectedOriginCoverage.description}</small>
                  </div>
                )}

                {epsRequiresValidation(selectedOriginCoverage) && (
                  <div className="territory-route-status warning">
                    <strong>Validación operativa requerida</strong>
                    <span>
                      La EPS de referencia requiere validación antes de usarla como origen de ruta.
                    </span>
                  </div>
                )}

                <div className="route-control-actions">
                  <button
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

        <section className="route-explorer-layout">
          <CandidateRoutesMap
            origin={selectedOrigin}
            destination={selectedDestination}
            routes={enrichedRoutes}
            bestRouteId={bestRouteId}
            selectedRouteId={selectedRouteId}
            highlightedRouteId={highlightedRouteId}
            mapView={mapView}
            onHighlightRoute={setHighlightedRouteId}
            onToggleRoute={(routeId) => {
              setSelectedInfoRouteId((current) => (current === routeId ? "" : routeId));
            }}
          />

          <article className={`panel route-result-panel ${hasCalculatedRoutes ? "" : "empty"}`}>
            <h3 className="panel-title">Resultado</h3>
            {hasCalculatedRoutes ? (
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
                <div className="selected">
                  <span>PenalizaciÃ³n de fragilidad</span>
                  <strong>{formatDecimal(selectedRoute?.routeFragilityPenalty)}</strong>
                </div>
                <div className="selected">
                  <span>Peso operativo de arista</span>
                  <strong>{formatDecimal(selectedRoute?.edgeOperationalWeight)}</strong>
                </div>
              </div>
            ) : (
              <div className="route-result-empty">
                {routeLoading
                  ? "Calculando rutas sobre la red vial..."
                  : selectionComplete
                  ? "Calcula para ver el resultado."
                  : "Selecciona grupo, sector y zona destino para calcular rutas candidatas."}
              </div>
            )}

            <p className="territory-context-note">
              Las rutas son candidatas de apoyo operativo. Deben validarse con condiciones reales
              de tránsito, disponibilidad de vehículos y restricciones locales.
            </p>

            {activeRouteError && (
              <div className="route-error-message">
                <strong>No se pudo cargar la ruta</strong>
                <span>{activeRouteError}</span>
              </div>
            )}

            <div className="route-candidate-list">
              <div className="route-list-heading">
                <span>Alternativas disponibles</span>
                <small>Hover resalta; clic fija o libera.</small>
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
                  <small>{route.via}</small>
                  <em>
                    {formatKm(route.distanceKm)} / {formatTime(route.timeMin)} / {formatMoney(route.cost)} / Frag. {formatDecimal(route.routeFragilityPenalty)}
                  </em>
                </button>
              ))}
            </div>
          </article>
        </section>
      </section>
    </MainLayout>
  );
}
