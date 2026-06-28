import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import MainLayout from "../components/layout/MainLayout";
import AquaMap from "../components/map/AquaMap";
import { aquaRutaData } from "../data/aquaRutaData";
import { runBacktrackingExploration } from "../services/backtrackingApi";
import { runDijkstraExploration } from "../services/dijkstraApi";
import { fetchRouteGeoJson } from "../services/mapApi";
import { runTspExploration } from "../services/tspApi";
import { runGraphTraversal } from "../services/traversalApi";
import { epsCoverageStatus, epsRequiresValidation } from "../utils/epsCoverage";

const CRITERIA = {
  distancia: {
    label: "menor distancia",
    metric: "distancia normalizada",
    edgeLabel: "Peso distancia",
    factor: 1,
  },
  tiempo: {
    label: "menor tiempo",
    metric: "tiempo estimado",
    edgeLabel: "Peso tiempo",
    factor: 1.18,
  },
  costo: {
    label: "menor costo",
    metric: "costo estimado",
    edgeLabel: "Peso costo",
    factor: 1.32,
  },
};

const DEFAULT_SECTOR_CRITERION = "mixto";

function formatNumber(value, digits = 2) {
  return Number(value || 0).toLocaleString("es-PE", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function formatWeight(value, criterion) {
  if (!Number.isFinite(value)) return "No disponible";
  if (criterion === "tiempo") return `${formatNumber(value * 60, 1)} min`;
  if (criterion === "costo") return `S/ ${formatNumber(value * 120, 2)}`;
  return `${formatNumber(value * 111.32, 1)} km aprox.`;
}

function formatDijkstraWeight(value, criterion) {
  if (!Number.isFinite(value)) return "No disponible";
  if (criterion === "tiempo") return `${formatNumber(value, 1)} min`;
  if (criterion === "costo") return `S/ ${formatNumber(value, 2)}`;
  return `${formatNumber(value, 1)} km`;
}

function edgeWeight(edge, criterion) {
  return Number(edge?.weight || 0) * (CRITERIA[criterion]?.factor || 1);
}

function normalizedDistance(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot(Number(a[0]) - Number(b[0]), Number(a[1]) - Number(b[1]));
}

function distanceKm(a, b) {
  if (!a || !b) return Infinity;
  const [lat1, lon1] = a.map((value) => (Number(value) * Math.PI) / 180);
  const [lat2, lon2] = b.map((value) => (Number(value) * Math.PI) / 180);
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const value =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function sectorCenter(nodes) {
  const centers = nodes.map((node) => node.center).filter(Boolean);
  if (!centers.length) return null;
  return [
    centers.reduce((acc, center) => acc + Number(center[0]), 0) / centers.length,
    centers.reduce((acc, center) => acc + Number(center[1]), 0) / centers.length,
  ];
}

function nearestOriginToPoint(center, origins) {
  if (!center) return null;
  return [...origins]
    .map((origin) => ({
      ...origin,
      distanceToSector: distanceKm(center, [origin.lat, origin.lon]),
    }))
    .sort((a, b) => a.distanceToSector - b.distanceToSector)[0] || null;
}

function buildSectorEdges(nodes, criterion, neighbors = 3) {
  const edgeMap = new Map();
  nodes.forEach((source) => {
    const nearest = nodes
      .filter((target) => target.id !== source.id)
      .map((target) => ({
        target,
        distance: normalizedDistance(source.center, target.center),
      }))
      .filter((item) => Number.isFinite(item.distance))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, neighbors);

    nearest.forEach(({ target, distance }) => {
      const key = [source.id, target.id].sort().join("::");
      if (!edgeMap.has(key)) {
        edgeMap.set(key, {
          source: source.id,
          target: target.id,
          weight: distance,
          weightLabel: formatWeight(edgeWeight({ weight: distance }, criterion), criterion),
        });
      }
    });
  });
  return [...edgeMap.values()];
}

function routeCoordinateKey(coordinates) {
  return (coordinates || [])
    .map(([lon, lat]) => `${Number(lon).toFixed(5)},${Number(lat).toFixed(5)}`)
    .join("|");
}

export default function ExploracionLocal() {
  const [searchParams] = useSearchParams();
  const districts = useMemo(
    () => (aquaRutaData.districts || []).filter((district) => district.center),
    []
  );
  const districtMap = useMemo(
    () => new Map(districts.map((district) => [district.id, district])),
    [districts]
  );
  const epsOrigins = useMemo(() => aquaRutaData.epsOrigins || [], []);
  const groupedZones = useMemo(() => aquaRutaData.groupedZones || [], []);
  const sectorizedZones = useMemo(() => aquaRutaData.sectorizedZones || {}, []);
  const requestedDistrictId = searchParams.get("distrito") || "";
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
  const requestedGroup = useMemo(
    () =>
      groupOptions.find((group) => (group.zoneIds || []).includes(requestedDistrictId)),
    [groupOptions, requestedDistrictId]
  );

  const [selectedGroupId, setSelectedGroupId] = useState(
    requestedGroup?.groupId || groupOptions[0]?.groupId || ""
  );
  const [selectedSectorKey, setSelectedSectorKey] = useState("");
  const [criterion, setCriterion] = useState("distancia");
  const [mapView, setMapView] = useState("road");
  const [disabledNodeIds, setDisabledNodeIds] = useState(() => new Set());
  const [roadRouteGeoJson, setRoadRouteGeoJson] = useState(null);
  const [roadRouteKey, setRoadRouteKey] = useState("");
  const [roadRouteLoading, setRoadRouteLoading] = useState(false);
  const [roadRouteError, setRoadRouteError] = useState("");
  const [tspStatus, setTspStatus] = useState("idle");
  const [tspError, setTspError] = useState("");
  const [tspPayload, setTspPayload] = useState(null);
  const [tspRetryToken, setTspRetryToken] = useState(0);
  const [selectedTargetId, setSelectedTargetId] = useState("");
  const [dijkstraStatus, setDijkstraStatus] = useState("idle");
  const [dijkstraError, setDijkstraError] = useState("");
  const [dijkstraPayload, setDijkstraPayload] = useState(null);
  const [dijkstraRetryToken, setDijkstraRetryToken] = useState(0);
  const [traversalAlgorithm, setTraversalAlgorithm] = useState("bfs");
  const [selectedTraversalOriginId, setSelectedTraversalOriginId] = useState("");
  const [traversalStatus, setTraversalStatus] = useState("idle");
  const [traversalError, setTraversalError] = useState("");
  const [traversalPayload, setTraversalPayload] = useState(null);
  const [traversalRetryToken, setTraversalRetryToken] = useState(0);
  const [backtrackingStatus, setBacktrackingStatus] = useState("idle");
  const [backtrackingError, setBacktrackingError] = useState("");
  const [backtrackingPayload, setBacktrackingPayload] = useState(null);
  const [backtrackingRetryToken, setBacktrackingRetryToken] = useState(0);
  const [controlPanelOpen, setControlPanelOpen] = useState(true);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [backtrackingConstraints, setBacktrackingConstraints] = useState({
    maxVisits: 4,
    maxDistanceKm: 250,
    maxDurationMin: 480,
    maxOperationalCost: 1500,
  });

  useEffect(() => {
    const timer = window.setTimeout(() => window.dispatchEvent(new Event("resize")), 220);
    return () => window.clearTimeout(timer);
  }, [controlPanelOpen, mapExpanded]);

  const selectedGroup =
    groupOptions.find((group) => group.groupId === selectedGroupId) || groupOptions[0] || null;
  const selectedSectorizedGroup = selectedGroup?.groupId
    ? sectorizedZones[selectedGroup.groupId] || null
    : null;
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
    sectorOptions.find((sector) =>
      (sector.zona_ids || []).includes(requestedDistrictId)
    ) ||
    sectorOptions[0] ||
    null;
  const sectorDistricts = selectedSector?.zones?.length ? selectedSector.zones : districts;
  const selectedSectorCenter = useMemo(() => sectorCenter(sectorDistricts), [sectorDistricts]);
  const selectedOrigin = useMemo(
    () => nearestOriginToPoint(selectedSectorCenter, epsOrigins),
    [epsOrigins, selectedSectorCenter]
  );
  const selectedOriginCoverage = epsCoverageStatus(selectedOrigin?.distanceToSector);
  const originNode = useMemo(
    () =>
      selectedOrigin
        ? {
            id: selectedOrigin.id,
            nombre: selectedOrigin.prestador,
            center: [selectedOrigin.lat, selectedOrigin.lon],
            interrupciones: 0,
            criticidad: "baja",
            isEpsNode: true,
          }
        : null,
    [selectedOrigin]
  );
  const activeSectorNodes = useMemo(
    () => sectorDistricts.filter((district) => !disabledNodeIds.has(district.id)),
    [disabledNodeIds, sectorDistricts]
  );
  const selectedTarget =
    activeSectorNodes.find((node) => node.id === selectedTargetId) ||
    activeSectorNodes[activeSectorNodes.length - 1] ||
    null;
  const selectedTraversalOrigin =
    activeSectorNodes.find((node) => node.id === selectedTraversalOriginId) ||
    activeSectorNodes[0] ||
    null;
  const tspRequest = useMemo(
    () => ({
      originId: selectedOrigin?.id || "",
      destinationIds: activeSectorNodes.map((node) => node.id),
      criterion,
      maxExactNodes: 12,
      maxDestinations: 60,
    }),
    [activeSectorNodes, criterion, selectedOrigin?.id]
  );
  const tspResult = useMemo(
    () => ({
      bestOrder: tspPayload?.sequence || [],
      totalDistance: tspPayload?.summary?.totalCost || 0,
      exploredStates: tspPayload?.summary?.exploredStates || 0,
      cacheHits: tspPayload?.summary?.cacheHits || 0,
      usedFallback: Boolean(tspPayload?.summary?.usedFallback),
      routePoints: tspPayload?.routePoints || (originNode?.center ? [originNode.center] : []),
    }),
    [originNode, tspPayload]
  );
  const sequenceNodes = useMemo(
    () =>
      (tspPayload?.sequence || [])
        .map((item) => {
          const district = districtMap.get(item.nodeId);
          if (!district) return null;
          return {
            ...district,
            mapOrder: item.order,
            transitionCost: item.transitionCost,
            accumulatedCost: item.accumulatedCost,
          };
        })
        .filter(Boolean),
    [districtMap, tspPayload]
  );
  const routePoints = useMemo(() => tspResult.routePoints || [], [tspResult.routePoints]);
  const dijkstraRoutePoints = useMemo(
    () => dijkstraPayload?.routePoints || (originNode?.center ? [originNode.center] : []),
    [dijkstraPayload, originNode]
  );
  const orderMap = new Map(sequenceNodes.map((node, index) => [node.id, index + 1]));
  const sectorBaseEdges = useMemo(
    () => buildSectorEdges(sectorDistricts, criterion),
    [criterion, sectorDistricts]
  );
  const sequenceEdges = useMemo(
    () => (tspPayload?.edges || []).map((edge) => ({
      ...edge,
      weightLabel: formatWeight(Number(edge.weight || 0), criterion),
    })),
    [criterion, tspPayload]
  );
  const dijkstraEdges = useMemo(
    () => (dijkstraPayload?.edges || []).map((edge) => ({
      source: edge.source,
      target: edge.target,
      weight: edge.selectedWeight,
      weightLabel: formatDijkstraWeight(Number(edge.selectedWeight || 0), criterion),
      isShortestPath: true,
    })),
    [criterion, dijkstraPayload]
  );
  const traversalOrderMap = useMemo(
    () =>
      new Map((traversalPayload?.order || []).map((item) => [item.nodeId, item.position])),
    [traversalPayload]
  );
  const traversalUnreachableIds = useMemo(
    () => new Set((traversalPayload?.unreachableNodes || []).map((node) => node.id)),
    [traversalPayload]
  );
  const traversalEdges = useMemo(
    () => (traversalPayload?.treeEdges || []).map((edge) => ({
      source: edge.source,
      target: edge.target,
      weight: edge.order,
      weightLabel: `#${edge.order}`,
      isTraversalEdge: true,
    })),
    [traversalPayload]
  );
  const backtrackingOrderMap = useMemo(
    () =>
      new Map((backtrackingPayload?.sequence || []).map((item) => [item.nodeId, item.order])),
    [backtrackingPayload]
  );
  const backtrackingUnvisitedIds = useMemo(
    () => new Set((backtrackingPayload?.unvisitedDestinations || []).map((node) => node.id)),
    [backtrackingPayload]
  );
  const backtrackingEdges = useMemo(
    () => (backtrackingPayload?.edges || []).map((edge, index) => ({
      source: edge.source,
      target: edge.target,
      weight: edge.operationalCost,
      weightLabel: `#${index + 1}`,
      isSelected: true,
    })),
    [backtrackingPayload]
  );
  const visibleEdges =
    mapView === "network"
      ? [...sectorBaseEdges, ...sequenceEdges]
      : mapView === "dijkstra"
      ? dijkstraEdges
      : mapView === "traversal"
      ? traversalEdges
      : mapView === "backtracking"
      ? backtrackingEdges
      : [];
  const highlightedPathEdges =
    mapView === "network"
      ? sequenceEdges
      : mapView === "dijkstra"
      ? dijkstraEdges
      : mapView === "traversal"
      ? traversalEdges
      : mapView === "backtracking"
      ? backtrackingEdges
      : [];
  const districtPoints = mapView === "network" || mapView === "dijkstra" || mapView === "traversal" || mapView === "backtracking"
    ? [
        ...(originNode ? [originNode] : []),
        ...sectorDistricts.map((node) => ({
          ...node,
          isActiveNode: !disabledNodeIds.has(node.id),
          isExcluded:
            disabledNodeIds.has(node.id) ||
            (mapView === "traversal" && traversalUnreachableIds.has(node.id)) ||
            (mapView === "backtracking" && backtrackingUnvisitedIds.has(node.id)),
          isGoal:
            mapView === "dijkstra"
              ? node.id === selectedTarget?.id
              : mapView === "traversal"
              ? node.id === selectedTraversalOrigin?.id
              : mapView === "backtracking"
              ? false
              : false,
          mapOrder:
            mapView === "traversal"
              ? traversalOrderMap.get(node.id) || null
              : mapView === "backtracking"
              ? backtrackingOrderMap.get(node.id) || null
              : orderMap.get(node.id) || null,
        })),
      ]
    : [];

  const activeNodeCount = activeSectorNodes.length;
  const excludedNodeCount = sectorDistricts.length - activeNodeCount;
  const localEdgeCount = sectorBaseEdges.length;
  const criterionInfo = CRITERIA[criterion];
  const viewMode =
    mapView === "road"
      ? "Ruta vial"
      : mapView === "dijkstra"
      ? "Camino minimo"
      : mapView === "traversal"
      ? "Recorrido logico"
      : mapView === "backtracking"
      ? "Backtracking"
      : "Red local";
  const roadRouteCoordinates = useMemo(
    () =>
      routePoints.length > 1
        ? routePoints.map((point) => [point[1], point[0]])
        : null,
    [routePoints]
  );
  const currentRoadRouteKey = routeCoordinateKey(roadRouteCoordinates);
  const dijkstraRequest = useMemo(
    () => ({
      originId: selectedOrigin?.id || "",
      targetId: selectedTarget?.id || "",
      nodeIds: activeSectorNodes.map((node) => node.id),
      criterion,
      maxNodes: 80,
      maxNeighbors: 4,
    }),
    [activeSectorNodes, criterion, selectedOrigin?.id, selectedTarget?.id]
  );
  const traversalRequest = useMemo(
    () => ({
      originId: selectedTraversalOrigin?.id || "",
      nodeIds: activeSectorNodes.map((node) => node.id),
      algorithm: traversalAlgorithm,
      maxNodes: 100,
      maxNeighbors: 4,
    }),
    [activeSectorNodes, selectedTraversalOrigin?.id, traversalAlgorithm]
  );
  const backtrackingRequest = useMemo(
    () => ({
      originId: selectedOrigin?.id || "",
      destinationIds: activeSectorNodes.map((node) => node.id),
      criterion,
      constraints: backtrackingConstraints,
      maxExactNodes: 10,
    }),
    [activeSectorNodes, backtrackingConstraints, criterion, selectedOrigin?.id]
  );

  useEffect(() => {
    if (selectedTargetId && activeSectorNodes.some((node) => node.id === selectedTargetId)) {
      return;
    }
    const timer = window.setTimeout(() => {
      setSelectedTargetId(activeSectorNodes[activeSectorNodes.length - 1]?.id || "");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeSectorNodes, selectedTargetId]);

  useEffect(() => {
    if (
      selectedTraversalOriginId &&
      activeSectorNodes.some((node) => node.id === selectedTraversalOriginId)
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      setSelectedTraversalOriginId(activeSectorNodes[0]?.id || "");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeSectorNodes, selectedTraversalOriginId]);

  useEffect(() => {
    if (!tspRequest.originId) {
      const timer = window.setTimeout(() => {
        setTspStatus("idle");
        setTspPayload(null);
        setTspError("");
      }, 0);
      return () => window.clearTimeout(timer);
    }
    if (!tspRequest.destinationIds.length) {
      const timer = window.setTimeout(() => {
        setTspStatus("empty");
        setTspPayload(null);
        setTspError("");
      }, 0);
      return () => window.clearTimeout(timer);
    }

    const controller = new AbortController();
    const loadingTimer = window.setTimeout(() => {
      setTspStatus("loading");
      setTspError("");
    }, 0);

    runTspExploration(tspRequest, { signal: controller.signal })
      .then((payload) => {
        setTspPayload(payload);
        setTspStatus(payload.sequence.length ? "success" : "empty");
        setTspError("");
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        setTspPayload(null);
        setTspStatus("error");
        setTspError(error?.message || "No se pudo calcular la secuencia de visita.");
      });

    return () => {
      window.clearTimeout(loadingTimer);
      controller.abort();
    };
  }, [tspRequest, tspRetryToken]);

  useEffect(() => {
    if (mapView !== "dijkstra") return undefined;
    if (!dijkstraRequest.originId || !dijkstraRequest.targetId) {
      const timer = window.setTimeout(() => {
        setDijkstraStatus("idle");
        setDijkstraPayload(null);
        setDijkstraError("");
      }, 0);
      return () => window.clearTimeout(timer);
    }
    if (!dijkstraRequest.nodeIds.length) {
      const timer = window.setTimeout(() => {
        setDijkstraStatus("empty");
        setDijkstraPayload(null);
        setDijkstraError("");
      }, 0);
      return () => window.clearTimeout(timer);
    }

    const controller = new AbortController();
    const loadingTimer = window.setTimeout(() => {
      setDijkstraStatus("loading");
      setDijkstraError("");
    }, 0);

    runDijkstraExploration(dijkstraRequest, { signal: controller.signal })
      .then((payload) => {
        setDijkstraPayload(payload);
        setDijkstraStatus(payload.status === "unreachable" ? "unreachable" : "success");
        setDijkstraError("");
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        setDijkstraPayload(null);
        setDijkstraStatus("error");
        setDijkstraError(error?.message || "No se pudo calcular el camino minimo.");
      });

    return () => {
      window.clearTimeout(loadingTimer);
      controller.abort();
    };
  }, [dijkstraRequest, dijkstraRetryToken, mapView]);

  useEffect(() => {
    if (mapView !== "traversal") return undefined;
    if (!traversalRequest.originId) {
      const timer = window.setTimeout(() => {
        setTraversalStatus("idle");
        setTraversalPayload(null);
        setTraversalError("");
      }, 0);
      return () => window.clearTimeout(timer);
    }
    if (!traversalRequest.nodeIds.length) {
      const timer = window.setTimeout(() => {
        setTraversalStatus("empty");
        setTraversalPayload(null);
        setTraversalError("");
      }, 0);
      return () => window.clearTimeout(timer);
    }

    const controller = new AbortController();
    const loadingTimer = window.setTimeout(() => {
      setTraversalStatus("loading");
      setTraversalError("");
    }, 0);

    runGraphTraversal(traversalRequest, { signal: controller.signal })
      .then((payload) => {
        setTraversalPayload(payload);
        setTraversalStatus(payload.unreachableNodes?.length ? "partial" : "success");
        setTraversalError("");
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        setTraversalPayload(null);
        setTraversalStatus("error");
        setTraversalError(error?.message || "No se pudo calcular el recorrido.");
      });

    return () => {
      window.clearTimeout(loadingTimer);
      controller.abort();
    };
  }, [mapView, traversalRequest, traversalRetryToken]);

  useEffect(() => {
    if (mapView !== "backtracking") return undefined;
    if (!backtrackingRequest.originId) {
      const timer = window.setTimeout(() => {
        setBacktrackingStatus("idle");
        setBacktrackingPayload(null);
        setBacktrackingError("");
      }, 0);
      return () => window.clearTimeout(timer);
    }
    if (!backtrackingRequest.destinationIds.length) {
      const timer = window.setTimeout(() => {
        setBacktrackingStatus("empty");
        setBacktrackingPayload(null);
        setBacktrackingError("");
      }, 0);
      return () => window.clearTimeout(timer);
    }

    const controller = new AbortController();
    const loadingTimer = window.setTimeout(() => {
      setBacktrackingStatus("loading");
      setBacktrackingError("");
    }, 0);

    runBacktrackingExploration(backtrackingRequest, { signal: controller.signal })
      .then((payload) => {
        setBacktrackingPayload(payload);
        setBacktrackingStatus(
          payload.summary?.usedFallback
            ? "fallback"
            : payload.feasible
            ? "success"
            : "infeasible"
        );
        setBacktrackingError("");
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        setBacktrackingPayload(null);
        setBacktrackingStatus("error");
        setBacktrackingError(error?.message || "No se pudo evaluar la secuencia.");
      });

    return () => {
      window.clearTimeout(loadingTimer);
      controller.abort();
    };
  }, [backtrackingRequest, backtrackingRetryToken, mapView]);

  useEffect(() => {
    let cancelled = false;
    if (mapView !== "road" || !roadRouteCoordinates) return undefined;
    if (roadRouteKey === currentRoadRouteKey && (roadRouteGeoJson || roadRouteError)) {
      return undefined;
    }

    Promise.resolve().then(() => {
      if (cancelled) return;
      setRoadRouteLoading(true);
      setRoadRouteError("");
      setRoadRouteGeoJson(null);
    });
    fetchRouteGeoJson(roadRouteCoordinates)
      .then((payload) => {
        if (cancelled) return;
        setRoadRouteGeoJson(payload);
        setRoadRouteKey(currentRoadRouteKey);
      })
      .catch((error) => {
        if (cancelled) return;
        setRoadRouteGeoJson(null);
        setRoadRouteKey(currentRoadRouteKey);
        const message = error.message || "No se pudo cargar la ruta vial.";
        const waitMatch = message.match(/(\d+)\s*s/);
        setRoadRouteError(waitMatch ? `Reintenta en ${waitMatch[1]} s.` : message);
      })
      .finally(() => {
        if (!cancelled) setRoadRouteLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentRoadRouteKey, mapView, roadRouteCoordinates, roadRouteError, roadRouteGeoJson, roadRouteKey]);

  function toggleNode(node) {
    if (node.isEpsNode) return;
    setDisabledNodeIds((current) => {
      const next = new Set(current);
      if (next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
      return next;
    });
  }

  function retryTsp() {
    setTspRetryToken((current) => current + 1);
  }

  function retryDijkstra() {
    setDijkstraRetryToken((current) => current + 1);
  }

  function retryTraversal() {
    setTraversalRetryToken((current) => current + 1);
  }

  function retryBacktracking() {
    setBacktrackingRetryToken((current) => current + 1);
  }

  function updateBacktrackingConstraint(key, value) {
    setBacktrackingConstraints((current) => ({
      ...current,
      [key]: Number(value),
    }));
  }

  return (
    <MainLayout>
      <section className={`page-section local-explorer-page workspace-page ${mapExpanded ? "workspace-expanded" : ""} ${controlPanelOpen ? "" : "panel-collapsed"}`}>
        <article className="page-card local-explorer-hero">
          <div>
            <h2 className="page-title">Exploración local</h2>
            <p className="page-subtitle">
              Ordena las zonas de un sector para proponer una secuencia de atención local.
            </p>
          </div>
          <div className="local-hero-grid">
            <div>
              <span>Sector seleccionado</span>
              <strong>{selectedSector?.nombre || "No disponible"}</strong>
            </div>
            <div>
              <span>Priorizar secuencia por</span>
              <strong>{criterionInfo.label}</strong>
            </div>
            <div>
              <span>EPS de referencia</span>
              <strong>{selectedOrigin?.prestador || "No disponible"}</strong>
            </div>
          </div>
        </article>

        <div className="workspace-toolbar" aria-label="Herramientas de exploracion local">
          <div className="algorithm-tabs" role="tablist" aria-label="Algoritmo visible">
            {[
              ["network", "TSP"],
              ["dijkstra", "Dijkstra"],
              ["traversal", traversalAlgorithm.toUpperCase()],
              ["backtracking", "Backtracking"],
              ["road", "Ruta vial"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={mapView === id}
                className={mapView === id ? "active" : ""}
                onClick={() => setMapView(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-expanded={controlPanelOpen}
            aria-controls="local-control-panel"
            onClick={() => setControlPanelOpen((current) => !current)}
          >
            {controlPanelOpen ? "Ocultar controles" : "Mostrar controles"}
          </button>
          <button
            type="button"
            aria-pressed={mapExpanded}
            onClick={() => setMapExpanded((current) => !current)}
          >
            {mapExpanded ? "Salir de mapa ampliado" : "Ampliar mapa"}
          </button>
        </div>

        <article id="local-control-panel" className="panel local-control-panel workspace-side-panel">
            <h3 className="panel-title">Controles locales</h3>
            <p className="panel-subtitle">
              Selecciona grupo, sector, criterio y vista para recalcular la secuencia.
            </p>

            <div className="local-control-stack">
              <label className="control-group">
                <span className="control-label">Grupo operativo</span>
                <select
                  className="control-select"
                  value={selectedGroup?.groupId || ""}
                  onChange={(event) => {
                    setSelectedGroupId(event.target.value);
                    setSelectedSectorKey("");
                    setDisabledNodeIds(new Set());
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
                <span className="control-label">Sector a recorrer</span>
                <select
                  className="control-select"
                  value={selectedSector?.key || ""}
                  onChange={(event) => {
                    setSelectedSectorKey(event.target.value);
                    setDisabledNodeIds(new Set());
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
                <span className="control-label">Priorizar secuencia por</span>
                <select
                  className="control-select"
                  value={criterion}
                  onChange={(event) => setCriterion(event.target.value)}
                >
                  {Object.entries(CRITERIA).map(([id, option]) => (
                    <option key={id} value={id}>
                      Ruta por {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="control-group">
                <span className="control-label">Destino para camino minimo</span>
                <select
                  className="control-select"
                  value={selectedTarget?.id || ""}
                  onChange={(event) => setSelectedTargetId(event.target.value)}
                >
                  {activeSectorNodes.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.nombre}
                    </option>
                  ))}
                </select>
              </label>

              <label className="control-group">
                <span className="control-label">Origen del recorrido logico</span>
                <select
                  className="control-select"
                  value={selectedTraversalOrigin?.id || ""}
                  onChange={(event) => setSelectedTraversalOriginId(event.target.value)}
                >
                  {activeSectorNodes.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.nombre}
                    </option>
                  ))}
                </select>
              </label>

              <label className="control-group">
                <span className="control-label">Recorrido logico</span>
                <select
                  className="control-select"
                  value={traversalAlgorithm}
                  onChange={(event) => setTraversalAlgorithm(event.target.value)}
                >
                  <option value="bfs">BFS por niveles</option>
                  <option value="dfs">DFS en profundidad</option>
                </select>
              </label>

              <div className="local-summary-grid compact">
                <label className="control-group">
                  <span className="control-label">Max. visitas</span>
                  <input
                    className="control-input"
                    type="number"
                    min="1"
                    max="10"
                    value={backtrackingConstraints.maxVisits}
                    onChange={(event) => updateBacktrackingConstraint("maxVisits", event.target.value)}
                  />
                </label>
                <label className="control-group">
                  <span className="control-label">Max. km</span>
                  <input
                    className="control-input"
                    type="number"
                    min="0"
                    max="2000"
                    value={backtrackingConstraints.maxDistanceKm}
                    onChange={(event) => updateBacktrackingConstraint("maxDistanceKm", event.target.value)}
                  />
                </label>
                <label className="control-group">
                  <span className="control-label">Max. min</span>
                  <input
                    className="control-input"
                    type="number"
                    min="0"
                    max="5000"
                    value={backtrackingConstraints.maxDurationMin}
                    onChange={(event) => updateBacktrackingConstraint("maxDurationMin", event.target.value)}
                  />
                </label>
                <label className="control-group">
                  <span className="control-label">Max. costo</span>
                  <input
                    className="control-input"
                    type="number"
                    min="0"
                    max="50000"
                    value={backtrackingConstraints.maxOperationalCost}
                    onChange={(event) => updateBacktrackingConstraint("maxOperationalCost", event.target.value)}
                  />
                </label>
              </div>

              <div className="local-metric-card">
                <span>Recorrido estimado</span>
                <strong>{routePoints.length > 1 ? formatWeight(tspResult.totalDistance, criterion) : "Sin secuencia"}</strong>
                <small>Calculado con {activeNodeCount} zonas incluidas del sector.</small>
              </div>

              {tspStatus === "idle" && (
                <div className="local-route-status">
                  Selecciona un sector y un punto de origen.
                </div>
              )}

              {tspStatus === "loading" && (
                <div className="local-route-status">
                  Calculando secuencia de visita...
                </div>
              )}

              {tspStatus === "empty" && (
                <div className="local-route-status">
                  No hay destinos disponibles en el sector seleccionado.
                </div>
              )}

              {tspStatus === "error" && (
                <div className="local-route-status error">
                  <span>{tspError || "No se pudo calcular la secuencia de visita."}</span>
                  <button type="button" onClick={retryTsp}>Reintentar</button>
                </div>
              )}

              {tspResult.usedFallback && (
                <div className="local-route-status warning">
                  Se muestra una ruta aproximada para mantener un tiempo de respuesta adecuado.
                </div>
              )}

              {mapView === "dijkstra" && dijkstraStatus === "idle" && (
                <div className="local-route-status">
                  Selecciona un origen, un destino y un criterio.
                </div>
              )}

              {mapView === "dijkstra" && dijkstraStatus === "loading" && (
                <div className="local-route-status">
                  Calculando el camino minimo...
                </div>
              )}

              {mapView === "dijkstra" && dijkstraStatus === "empty" && (
                <div className="local-route-status">
                  No hay destinos disponibles en el sector seleccionado.
                </div>
              )}

              {mapView === "dijkstra" && dijkstraStatus === "unreachable" && (
                <div className="local-route-status warning">
                  No existe una conexion disponible entre los nodos seleccionados.
                </div>
              )}

              {mapView === "dijkstra" && dijkstraStatus === "error" && (
                <div className="local-route-status error">
                  <span>{dijkstraError || "No se pudo calcular el camino minimo."}</span>
                  <button type="button" onClick={retryDijkstra}>Reintentar</button>
                </div>
              )}

              {mapView === "traversal" && traversalStatus === "idle" && (
                <div className="local-route-status">
                  Selecciona un origen y un recorrido.
                </div>
              )}

              {mapView === "traversal" && traversalStatus === "loading" && (
                <div className="local-route-status">
                  Calculando recorrido...
                </div>
              )}

              {mapView === "traversal" && traversalStatus === "empty" && (
                <div className="local-route-status">
                  No hay nodos disponibles en el sector seleccionado.
                </div>
              )}

              {mapView === "traversal" && traversalStatus === "partial" && (
                <div className="local-route-status warning">
                  Algunos distritos no son alcanzables desde el origen.
                </div>
              )}

              {mapView === "traversal" && traversalStatus === "error" && (
                <div className="local-route-status error">
                  <span>{traversalError || "No se pudo calcular el recorrido."}</span>
                  <button type="button" onClick={retryTraversal}>Reintentar</button>
                </div>
              )}

              {mapView === "backtracking" && backtrackingStatus === "idle" && (
                <div className="local-route-status">
                  Selecciona un origen y los destinos.
                </div>
              )}

              {mapView === "backtracking" && backtrackingStatus === "loading" && (
                <div className="local-route-status">
                  Evaluando secuencias factibles...
                </div>
              )}

              {mapView === "backtracking" && backtrackingStatus === "empty" && (
                <div className="local-route-status">
                  No hay destinos disponibles en el sector seleccionado.
                </div>
              )}

              {mapView === "backtracking" && backtrackingStatus === "success" && (
                <div className="local-route-status">
                  Se encontro una secuencia operativa.
                </div>
              )}

              {mapView === "backtracking" && backtrackingStatus === "infeasible" && (
                <div className="local-route-status warning">
                  No se encontro una secuencia que cumpla las restricciones.
                </div>
              )}

              {mapView === "backtracking" && backtrackingStatus === "fallback" && (
                <div className="local-route-status warning">
                  Se utilizo una aproximacion por el tamano del conjunto.
                </div>
              )}

              {mapView === "backtracking" && backtrackingStatus === "error" && (
                <div className="local-route-status error">
                  <span>{backtrackingError || "No se pudo evaluar la secuencia."}</span>
                  <button type="button" onClick={retryBacktracking}>Reintentar</button>
                </div>
              )}

              <label className="control-group">
                <span className="control-label">Tipo de visualización</span>
                <select
                  className="control-select"
                  value={mapView}
                  onChange={(event) => setMapView(event.target.value)}
                >
                  <option value="road">Ruta vial</option>
                  <option value="network">Red local</option>
                  <option value="dijkstra">Camino minimo</option>
                  <option value="traversal">Recorrido logico</option>
                  <option value="backtracking">Backtracking</option>
                </select>
              </label>

            </div>
          </article>

        <section className="local-explorer-layout">

          <div className="local-map-panel">
            <AquaMap
              mapTitle="Mapa de exploración local"
              mapSubtitle={`${viewMode}: secuencia de atención del sector completo.`}
              origins={selectedOrigin ? [selectedOrigin] : []}
              districtPoints={districtPoints}
              activeCenter={selectedSectorCenter}
              routePoints={mapView === "road" ? routePoints : mapView === "dijkstra" ? dijkstraRoutePoints : []}
              routeGeoJson={mapView === "road" ? roadRouteGeoJson : null}
              routeColor={mapView === "dijkstra" ? "#2563eb" : mapView === "traversal" ? "#9333ea" : mapView === "backtracking" ? "#b45309" : "#16a34a"}
              showConceptRouteFallback={mapView !== "road"}
              graphEdges={visibleEdges}
              highlightedPathEdges={mapView === "network" || mapView === "traversal" || mapView === "backtracking" ? highlightedPathEdges : []}
              showEdgeWeights={mapView === "network" || mapView === "traversal" || mapView === "backtracking"}
              edgeWeightLabel={criterionInfo.edgeLabel}
              showDistrictMarkers
              onDistrictClick={toggleNode}
              height={760}
            />

            {mapView === "road" && (roadRouteLoading || roadRouteError) && (
              <div className={roadRouteError ? "local-route-status error" : "local-route-status"}>
                {roadRouteLoading ? "Cargando ruta vial..." : roadRouteError}
              </div>
            )}

            <div className="local-legend">
              <div><i className="eps" /> EPS de referencia</div>
              <div><i className="visited" /> Zonas incluidas</div>
              <div><i className="excluded" /> Zonas excluidas</div>
              <div><i className="route" /> Secuencia TSP</div>
              {mapView === "network" && <div><i className="edge" /> Conexiones locales</div>}
              {mapView === "network" && <div><i className="weight" /> Valor por tramo</div>}
              {mapView === "traversal" && <div><i className="edge" /> Recorrido sobre conexiones logicas</div>}
              {mapView === "backtracking" && <div><i className="edge" /> Secuencia logica bajo restricciones</div>}
            </div>
          </div>

          <article className="panel local-summary-panel">
            <h3 className="panel-title">Resumen local</h3>
            <p className="panel-subtitle">
              Secuencia calculada con las zonas incluidas del sector.
            </p>

            <div className="local-summary-groups">
              <section className="local-summary-group">
                <strong>Sector seleccionado</strong>
                <div className="local-summary-grid compact">
                  <div>
                    <span>Sector</span>
                    <strong>{selectedSector?.nombre || "No disponible"}</strong>
                  </div>
                  <div>
                    <span>Zonas incluidas</span>
                    <strong>{activeNodeCount}</strong>
                  </div>
                  <div>
                    <span>Zonas excluidas</span>
                    <strong>{excludedNodeCount}</strong>
                  </div>
                  <div>
                    <span>Criterio</span>
                    <strong>{criterionInfo.label}</strong>
                  </div>
                  <div>
                    <span>Recorrido estimado</span>
                    <strong>{routePoints.length > 1 ? formatWeight(tspResult.totalDistance, criterion) : "Sin secuencia"}</strong>
                  </div>
                  <div>
                    <span>Camino minimo</span>
                    <strong>
                      {dijkstraPayload?.summary
                        ? formatDijkstraWeight(dijkstraPayload.summary.totalWeight, criterion)
                        : "Sin camino"}
                    </strong>
                  </div>
                  <div>
                    <span>Recorrido logico</span>
                    <strong>
                      {traversalPayload?.summary
                        ? `${traversalPayload.summary.visitedNodes}/${traversalPayload.summary.totalNodes}`
                        : "Sin recorrido"}
                    </strong>
                  </div>
                  <div>
                    <span>Backtracking</span>
                    <strong>
                      {backtrackingPayload?.summary
                        ? `${backtrackingPayload.summary.visitedDestinations} destino(s)`
                        : "Sin secuencia"}
                    </strong>
                  </div>
                  <div>
                    <span>EPS de referencia</span>
                    <strong>{selectedOrigin?.prestador || "No disponible"}</strong>
                  </div>
                </div>
              </section>

              <section className="local-summary-group">
                <strong>Secuencia recomendada</strong>
                <div className="local-summary-grid compact">
                  <div>
                    <span>Inicio</span>
                    <strong>{originNode?.nombre || "No disponible"}</strong>
                  </div>
                  <div>
                    <span>Primera zona</span>
                    <strong>{sequenceNodes[0]?.nombre || "No disponible"}</strong>
                  </div>
                  <div>
                    <span>Última zona</span>
                    <strong>{sequenceNodes[sequenceNodes.length - 1]?.nombre || "No disponible"}</strong>
                  </div>
                  <div>
                    <span>Zonas en secuencia</span>
                    <strong>{sequenceNodes.length}</strong>
                  </div>
                </div>
              </section>

              <section className="local-summary-group">
                <strong>Cobertura local</strong>
                <div className="local-summary-grid compact">
                  <div>
                    <span>Zonas incluidas</span>
                    <strong>{activeNodeCount}</strong>
                  </div>
                  <div>
                    <span>Zonas excluidas</span>
                    <strong>{excludedNodeCount}</strong>
                  </div>
                  <div>
                    <span>Alternativas evaluadas</span>
                    <strong>{tspResult.exploredStates}</strong>
                  </div>
                  <div>
                    <span>Estados en cache</span>
                    <strong>{tspResult.cacheHits}</strong>
                  </div>
                  <div>
                    <span>Conexiones evaluadas</span>
                    <strong>{localEdgeCount}</strong>
                  </div>
                  <div>
                    <span>Relajaciones Dijkstra</span>
                    <strong>{dijkstraPayload?.summary?.relaxedEdges || 0}</strong>
                  </div>
                  <div>
                    <span>Aristas de recorrido</span>
                    <strong>{traversalPayload?.summary?.treeEdges || 0}</strong>
                  </div>
                  <div>
                    <span>Podas Backtracking</span>
                    <strong>{backtrackingPayload?.summary?.prunedBranches || 0}</strong>
                  </div>
                  <div>
                    <span>Retrocesos</span>
                    <strong>{backtrackingPayload?.summary?.backtracks || 0}</strong>
                  </div>
                </div>
              </section>
            </div>

            <div className="local-explanation-card">
              <strong>EPS de referencia</strong>
              <p>
                {selectedOrigin
                  ? `${selectedOrigin.prestador} es el origen EPS referencial más cercano al sector seleccionado.`
                  : "No se encontró una EPS viable con la información disponible."}
              </p>
              <span className={`territory-eps-status ${selectedOriginCoverage.key}`}>
                {selectedOriginCoverage.label}
              </span>
            </div>

            {epsRequiresValidation(selectedOriginCoverage) && (
              <div className="territory-route-status warning">
                <strong>Validación operativa requerida</strong>
                <span>La EPS de referencia debe revisarse antes de iniciar el recorrido.</span>
              </div>
            )}

            {excludedNodeCount > 0 && (
              <p className="territory-context-note">
                Algunas zonas pueden excluirse por falta de coordenadas o por límites del cálculo.
              </p>
            )}

            <div className="local-explanation-card">
              <strong>Resumen del recorrido</strong>
              <p>
                {sequenceNodes.length
                  ? `La secuencia parte de ${originNode?.nombre} y ordena ${sequenceNodes.length} zona(s) del sector, priorizando ${criterionInfo.label}.`
                  : "Selecciona al menos una zona para calcular la secuencia local."}
              </p>
            </div>

            {dijkstraPayload?.metadata && (
              <div className="local-explanation-card">
                <strong>Conexion logica optimizada</strong>
                <p>
                  {dijkstraPayload.status === "success"
                    ? `Camino de ${dijkstraPayload.path.length} nodo(s), calculado por ${criterionInfo.label}.`
                    : "No existe una conexion entre el origen y el destino dentro del grafo logico seleccionado."}
                </p>
                <span>{dijkstraPayload.metadata.weightField}</span>
              </div>
            )}

            {traversalPayload?.metadata && (
              <div className="local-explanation-card">
                <strong>Recorrido sobre conexiones logicas</strong>
                <p>
                  {traversalPayload.unreachableNodes?.length
                    ? `Se visitaron ${traversalPayload.summary.visitedNodes} de ${traversalPayload.summary.totalNodes} zona(s).`
                    : `Se visitaron ${traversalPayload.summary.visitedNodes} zona(s) desde ${traversalPayload.origin.name}.`}
                </p>
                <span>{traversalPayload.algorithm.toUpperCase()}</span>
              </div>
            )}

            {backtrackingPayload?.metadata && (
              <div className="local-explanation-card">
                <strong>Secuencia logica bajo restricciones</strong>
                <p>
                  {backtrackingPayload.feasible
                    ? `Se seleccionaron ${backtrackingPayload.summary.visitedDestinations} destino(s), con ${backtrackingPayload.summary.prunedBranches} poda(s) y ${backtrackingPayload.summary.backtracks} retroceso(s).`
                    : "No se encontro una secuencia que cumpla las restricciones seleccionadas."}
                </p>
                <span>{backtrackingPayload.objective}</span>
              </div>
            )}

            <p className="territory-context-note">
              La secuencia es una propuesta de apoyo. En sectores grandes puede priorizar zonas
              representativas para mantener el cálculo manejable.
            </p>

            <div className="local-route-list">
              <span>Secuencia propuesta</span>
              {sequenceNodes.map((node, index) => (
                <button key={node.id} type="button" onClick={() => toggleNode(node)}>
                  <strong>{index + 1}. {node.nombre}</strong>
                  <small>{node.interrupciones?.toLocaleString("es-PE") || 0} interrupciones</small>
                </button>
              ))}
            </div>

            {traversalPayload?.order?.length > 0 && (
              <div className="local-route-list">
                <span>Orden de recorrido {traversalPayload.algorithm.toUpperCase()}</span>
                {traversalPayload.order.map((item) => (
                  <button key={item.nodeId} type="button">
                    <strong>{item.position}. {item.name}</strong>
                    <small>
                      {traversalPayload.algorithm === "bfs"
                        ? `Nivel ${item.level ?? 0}`
                        : `Profundidad ${item.depth ?? 0}`}
                    </small>
                  </button>
                ))}
              </div>
            )}

            {backtrackingPayload?.sequence?.length > 0 && (
              <div className="local-route-list">
                <span>Secuencia Backtracking</span>
                {backtrackingPayload.sequence.map((item) => (
                  <button key={item.nodeId} type="button">
                    <strong>{item.order}. {item.nombre}</strong>
                    <small>
                      {formatNumber(item.accumulatedDistanceKm, 1)} km - S/ {formatNumber(item.accumulatedCost, 1)}
                    </small>
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
