import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import MainLayout from "../components/layout/MainLayout";
import AquaMap from "../components/map/AquaMap";
import { aquaRutaData } from "../data/aquaRutaData";
import { fetchRouteGeoJson } from "../services/mapApi";

const CRITERIA = {
  distancia: "menor distancia",
  tiempo: "menor tiempo",
  costo: "menor costo",
};

function formatNumber(value, digits = 1) {
  return Number(value || 0).toLocaleString("es-PE", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function sectorOptionsFromGroup(group) {
  return Object.values(group?.sectors || {}).sort((a, b) =>
    a.sectorName.localeCompare(b.sectorName)
  );
}

function featureCollectionFromFeature(feature) {
  if (!feature) return null;
  return {
    type: "FeatureCollection",
    features: [feature],
  };
}

function routeSummary(feature) {
  const summary = feature?.properties?.summary || {};
  return {
    distanceKm: Number(summary.distance || 0) / 1000,
    durationMin: Number(summary.duration || 0) / 60,
  };
}

function haversineKm(a, b) {
  if (!a || !b) return 0;
  const toRad = (value) => (Number(value) * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * earthRadiusKm * Math.asin(Math.sqrt(h));
}

function routeMetricsFromPoints(points) {
  const distanceKm = points.reduce(
    (total, point, index) =>
      index === 0 ? total : total + haversineKm(points[index - 1], point),
    0
  );

  return {
    distanceKm,
    durationMin: (distanceKm / 35) * 60,
  };
}

function candidateCost(feature, criterion) {
  const summary = routeSummary(feature);
  if (criterion === "tiempo") return summary.durationMin;
  if (criterion === "costo") return summary.distanceKm * 120;
  return summary.distanceKm;
}

function formatRoadCandidateValue(summary, criterion) {
  if (!summary) return "Sin datos";
  if (criterion === "tiempo") return `${formatNumber(summary.durationMin, 1)} min`;
  if (criterion === "costo") return `S/ ${formatNumber(summary.distanceKm * 120, 2)}`;
  return `${formatNumber(summary.distanceKm, 1)} km aprox.`;
}

export default function MapaOperativo() {
  const [searchParams] = useSearchParams();
  const routeExplorations = useMemo(() => aquaRutaData.routeExplorations || {}, []);
  const requestedGroupId = searchParams.get("grupo") || "";
  const requestedCriterion = searchParams.get("criterio") || "distancia";

  const groupOptions = useMemo(
    () =>
      Object.values(routeExplorations).sort((a, b) =>
        a.groupName.localeCompare(b.groupName)
      ),
    [routeExplorations]
  );
  const [selectedGroupId, setSelectedGroupId] = useState(
    routeExplorations[requestedGroupId]?.groupId || groupOptions[0]?.groupId || ""
  );
  const [selectedSectorKey, setSelectedSectorKey] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState(searchParams.get("distrito") || "");
  const [criterion, setCriterion] = useState(
    Object.keys(CRITERIA).includes(requestedCriterion) ? requestedCriterion : "distancia"
  );
  const [roadRouteState, setRoadRouteState] = useState({
    loading: false,
    error: "",
    features: [],
  });
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [hoveredCandidateId, setHoveredCandidateId] = useState("");

  const selectedGroup =
    routeExplorations[selectedGroupId] || groupOptions[0] || null;
  const sectorOptions = useMemo(() => sectorOptionsFromGroup(selectedGroup), [selectedGroup]);
  const selectedSector =
    sectorOptions.find((sector) => sector.sectorKey === selectedSectorKey) ||
    sectorOptions[0] ||
    null;
  const nodeOptions = selectedSector?.nodes || [];
  const selectedNode =
    nodeOptions.find((node) => node.id === selectedNodeId) ||
    nodeOptions[0] ||
    null;
  const selectedDestinationRoute =
    selectedNode && selectedSector?.routesByDestination?.[selectedNode.id];
  const selectedOrigin = selectedDestinationRoute?.origin || selectedSector?.origin || null;
  const selectedOriginId = selectedOrigin?.id || "";
  const selectedOriginLat = selectedOrigin?.lat;
  const selectedOriginLon = selectedOrigin?.lon;
  const selectedNodeCenter = selectedNode?.center || null;
  const roadSelectionKey = `${selectedOriginId}:${selectedNode?.id || ""}`;
  const localRoute = selectedDestinationRoute?.criteria?.[criterion] || null;
  const localRoutePoints = localRoute?.route_points || [];
  const localRouteNodeIds = new Set(localRoute?.path || []);
  const districtPoints = [
    ...nodeOptions
      .filter((node) => localRouteNodeIds.has(node.id) || node.id === selectedNode?.id)
      .map((node) => ({
        ...node,
        isVisited: localRouteNodeIds.has(node.id),
        isGoal: node.id === selectedNode?.id,
        mapOrder: node.id === selectedNode?.id ? "Fin" : "",
      })),
  ];
  const localRouteSummary = localRoutePoints.length > 1
    ? routeMetricsFromPoints(localRoutePoints)
    : null;
  const roadCandidates = useMemo(
    () =>
      roadRouteState.features
        .map((feature, index) => ({
          id: `${roadSelectionKey}:candidate-${index}`,
          index,
          feature,
          cost: candidateCost(feature, criterion),
          summary: routeSummary(feature),
        }))
        .sort((a, b) => a.cost - b.cost),
    [criterion, roadRouteState.features, roadSelectionKey]
  );
  const bestCandidate = roadCandidates[0] || null;
  const activeCandidate =
    roadCandidates.find((candidate) => candidate.id === selectedCandidateId) ||
    bestCandidate ||
    null;
  const displayCandidate =
    roadCandidates.find((candidate) => candidate.id === hoveredCandidateId) ||
    activeCandidate;
  const selectedRoadGeoJson = featureCollectionFromFeature(displayCandidate?.feature);
  const selectedRouteSummary = displayCandidate?.summary || localRouteSummary;
  const isUsingLocalRoute = !selectedRoadGeoJson && localRoutePoints.length > 1;

  useEffect(() => {
    let cancelled = false;

    if (!selectedOriginLat || !selectedOriginLon || !selectedNodeCenter) {
      queueMicrotask(() => {
        if (!cancelled) {
          setRoadRouteState({ loading: false, error: "", features: [] });
        }
      });
      return () => {
        cancelled = true;
      };
    }

    queueMicrotask(() => {
      if (!cancelled) {
        setRoadRouteState({ loading: true, error: "", features: [] });
      }
    });

    fetchRouteGeoJson(
      [
        [selectedOriginLon, selectedOriginLat],
        [selectedNodeCenter[1], selectedNodeCenter[0]],
      ],
      {
        alternativeRoutes: {
          target_count: 3,
          weight_factor: 1.6,
          share_factor: 0.6,
        },
      }
    )
      .then((geoJson) => {
        if (cancelled) return;
        setRoadRouteState({
          loading: false,
          error: "",
          features: geoJson?.features || [],
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setRoadRouteState({
          loading: false,
          error: error.message || "No se pudo calcular la ruta vial.",
          features: [],
        });
      });

    return () => {
      cancelled = true;
    };
  }, [
    selectedNode?.id,
    selectedNodeCenter,
    selectedOriginId,
    selectedOriginLat,
    selectedOriginLon,
  ]);

  return (
    <MainLayout>
      <section className="page-section route-explorer-page">
        <article className="page-card route-explorer-hero">
          <div>
            <h2 className="page-title">Exploracion de rutas</h2>
            <p className="page-subtitle">
              Compara rutas viales candidatas desde la EPS mas cercana hasta el nodo elegido.
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
                value={selectedGroup?.groupId || ""}
                onChange={(event) => {
                  setSelectedGroupId(event.target.value);
                  setSelectedSectorKey("");
                  setSelectedNodeId("");
                }}
              >
                {groupOptions.map((group) => (
                  <option key={group.groupId} value={group.groupId}>
                    {group.groupName}
                  </option>
                ))}
              </select>
            </label>

            <label className="control-group">
              <span className="control-label">Sector</span>
              <select
                className="control-select"
                value={selectedSector?.sectorKey || ""}
                onChange={(event) => {
                  setSelectedSectorKey(event.target.value);
                  setSelectedNodeId("");
                }}
              >
                {sectorOptions.map((sector) => (
                  <option key={sector.sectorKey} value={sector.sectorKey}>
                    {sector.sectorName} - {sector.nodes.length} zonas
                  </option>
                ))}
              </select>
            </label>

            <label className="control-group">
              <span className="control-label">Nodo destino</span>
              <select
                className="control-select"
                value={selectedNode?.id || ""}
                onChange={(event) => setSelectedNodeId(event.target.value)}
              >
                {nodeOptions.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.nombre} - {node.provincia}
                  </option>
                ))}
              </select>
            </label>

            <label className="control-group">
              <span className="control-label">Criterio de optimizacion</span>
              <select
                className="control-select"
                value={criterion}
                onChange={(event) => setCriterion(event.target.value)}
              >
                {Object.entries(CRITERIA).map(([id, label]) => (
                  <option key={id} value={id}>
                    Ruta por {label}
                  </option>
                ))}
              </select>
            </label>

            <div className="route-origin-summary">
              <span>EPS mas cercana al nodo</span>
              <strong>{selectedOrigin?.prestador || "No disponible"}</strong>
            </div>
          </div>
        </article>

        <section className="route-explorer-layout">
          <div className="local-map-panel">
            <AquaMap
              mapTitle="Mapa de exploracion de rutas"
              mapSubtitle={`Ruta vial al nodo por ${CRITERIA[criterion]}.`}
              origins={selectedOrigin ? [selectedOrigin] : []}
              districtPoints={districtPoints}
              activeCenter={selectedNode?.center || selectedSector?.sectorCenter || null}
              routeGeoJson={selectedRoadGeoJson}
              routeColor={
                isUsingLocalRoute
                  ? "#0f766e"
                  : displayCandidate?.id === bestCandidate?.id
                  ? "#16a34a"
                  : "#2563eb"
              }
              routePoints={localRoutePoints}
              graphEdges={isUsingLocalRoute ? selectedDestinationRoute?.edges || [] : []}
              highlightedPathEdges={isUsingLocalRoute ? localRoute?.path_edges || [] : []}
              showConceptRouteFallback={isUsingLocalRoute}
              showEdgeWeights={false}
              showDistrictMarkers
              height={720}
            />
          </div>

          <article className="panel route-result-panel">
            <h3 className="panel-title">Resultado de ruta</h3>
            <div className="route-result-grid">
              <div>
                <span>Grupo</span>
                <strong>{selectedGroup?.groupName || "No disponible"}</strong>
              </div>
              <div>
                <span>Sector</span>
                <strong>{selectedSector?.sectorName || "No disponible"}</strong>
              </div>
              <div>
                <span>Nodo destino</span>
                <strong>{selectedNode?.nombre || "No disponible"}</strong>
              </div>
              <div className="selected">
                <span>Costo del camino</span>
                <strong>
                  {selectedRouteSummary
                    ? formatRoadCandidateValue(selectedRouteSummary, criterion)
                    : roadRouteState.loading
                    ? "Calculando"
                    : "Sin datos"}
                </strong>
              </div>
              <div className="selected">
                <span>Nodos visitados</span>
                <strong>Inicio y fin</strong>
              </div>
              <div className="selected">
                <span>Ruta</span>
                <strong>
                  {roadRouteState.loading
                    ? "Calculando"
                    : roadCandidates.length
                    ? `${roadCandidates.length} candidatas`
                    : isUsingLocalRoute
                    ? "Ruta local"
                    : "Sin datos"}
                </strong>
              </div>
            </div>

            <div className="route-candidate-list">
              <div className="route-list-heading">
                <span>Rutas viales candidatas</span>
                <small>Pasa el cursor o selecciona una opcion para verla en el mapa.</small>
              </div>
              {roadRouteState.error && (
                <div className="route-error-message">
                  <strong>Ruta vial externa no disponible</strong>
                  <span>
                    {isUsingLocalRoute
                      ? `Se muestra la ruta local por Dijkstra. Detalle: ${roadRouteState.error}`
                      : roadRouteState.error}
                  </span>
                </div>
              )}
              {roadRouteState.loading && (
                <button type="button" disabled>
                  <div className="route-card-head">
                    <strong>Calculando rutas por calles</strong>
                    <span>Vial</span>
                  </div>
                  <em>Consultando rutas candidatas...</em>
                </button>
              )}
              {!roadRouteState.loading &&
                roadCandidates.map((candidate, index) => (
                  <button
                    key={candidate.id}
                    type="button"
                    className={`${candidate.id === activeCandidate?.id ? "active" : ""} ${
                      candidate.id === bestCandidate?.id ? "best" : ""
                    }`}
                    onClick={() => setSelectedCandidateId(candidate.id)}
                    onMouseEnter={() => setHoveredCandidateId(candidate.id)}
                    onMouseLeave={() => setHoveredCandidateId("")}
                  >
                    <div className="route-card-head">
                      <strong>Ruta candidata {index + 1}</strong>
                      <span>{candidate.id === bestCandidate?.id ? "Mejor" : "Alternativa"}</span>
                    </div>
                    <div className="route-card-metrics">
                      <span>
                        Distancia
                        <strong>{formatNumber(candidate.summary.distanceKm, 1)} km</strong>
                      </span>
                      <span>
                        Tiempo
                        <strong>{formatNumber(candidate.summary.durationMin, 1)} min</strong>
                      </span>
                      <span>
                        Criterio
                        <strong>{CRITERIA[criterion]}</strong>
                      </span>
                    </div>
                    <em>Click para fijar esta ruta en el mapa.</em>
                  </button>
                ))}
              {!roadRouteState.loading && !roadCandidates.length && isUsingLocalRoute && (
                <button type="button" className="active best">
                  <div className="route-card-head">
                    <strong>Ruta local por Dijkstra</strong>
                    <span>Respaldo</span>
                  </div>
                  <div className="route-card-metrics">
                    <span>
                      Distancia
                      <strong>{formatNumber(localRouteSummary.distanceKm, 1)} km</strong>
                    </span>
                    <span>
                      Tiempo
                      <strong>{formatNumber(localRouteSummary.durationMin, 1)} min</strong>
                    </span>
                    <span>
                      Criterio
                      <strong>{CRITERIA[criterion]}</strong>
                    </span>
                  </div>
                  <em>Estimacion local disponible sin depender del servicio vial externo.</em>
                </button>
              )}
            </div>
          </article>
        </section>
      </section>
    </MainLayout>
  );
}
