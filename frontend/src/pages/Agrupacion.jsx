import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import MainLayout from "../components/layout/MainLayout";
import TerritoryTopFilters from "../components/grouping/TerritoryTopFilters";
import TerritoryCoverageMap from "../components/grouping/TerritoryCoverageMap";
import TerritorySidePanel from "../components/grouping/TerritorySidePanel";
import TerritoryResultsTable from "../components/grouping/TerritoryResultsTable";
import { fetchRouteGeoJson } from "../services/mapApi";
import { aquaRutaData } from "../data/aquaRutaData";

const priorityRank = { critica: 4, alta: 3, media: 2, baja: 1 };
const statusLabels = {
  pendiente: "Pendiente",
  priorizado: "Priorizado",
  revision: "En revisión",
  rutas: "Listo para ruteo",
};
const coverageLabels = {
  suficiente: "Suficiente",
  intermedia: "Intermedia",
  insuficiente: "Insuficiente",
};
const routeTypeLabels = {
  grupal: "Cobertura grupal",
  individual: "Ruta individual",
};

const MAX_STOPS_PER_STREET_ROUTE = 7;

const initialFilters = {
  viewMode: "grupos",
  blockId: "todos",
  criticidad: "todas",
  epsOriginId: "todos",
  zoneSize: "todos",
  nodeSize: "todos",
  priority: "todos",
  nodeStatus: "todos",
  routeType: "grupal",
  routeStatus: "todos",
  optimization: "balanceado",
};

const initialLayers = {
  showEps: true,
  showBlocks: true,
  showRoutes: true,
  showNodes: true,
};

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function hasValidCenter(item) {
  const center = item?.center;
  return (
    Array.isArray(center) &&
    center.length === 2 &&
    Number.isFinite(center[0]) &&
    Number.isFinite(center[1])
  );
}

function distanceKm(center, origin) {
  if (!center || !origin) return Infinity;
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

function nearestOrigin(center, epsOrigins) {
  if (!center || !epsOrigins.length) return { origin: null, distance: Infinity };
  return epsOrigins
    .map((origin) => ({ origin, distance: distanceKm(center, origin) }))
    .sort((a, b) => a.distance - b.distance)[0];
}

function weightedAverage(items, field) {
  const totalWeight = items.reduce((acc, item) => acc + (item.interrupciones || 0), 0);
  if (!totalWeight) return 0;
  return (
    items.reduce(
      (acc, item) => acc + (Number(item[field]) || 0) * (item.interrupciones || 0),
      0
    ) / totalWeight
  );
}

function coverageFromDistance(distance) {
  if (!Number.isFinite(distance) || distance > 60) return "insuficiente";
  if (distance > 30) return "intermedia";
  return "suficiente";
}

function derivedStatus(group, hasRouteScenario) {
  if (hasRouteScenario) return "rutas";
  if (group.criticidad === "critica") return "priorizado";
  if (group.criticidad === "alta" || group.criticidad === "media") return "revision";
  return "pendiente";
}

function priorityLabel(item) {
  if (item.criticidad === "critica" || item.estimatedPopulation > 1_000_000) {
    return "Atención inmediata";
  }
  if (item.criticidad === "alta" || item.nearestOriginDistanceKm > 30) {
    return "Alta prioridad";
  }
  if (item.criticidad === "media") return "Programar supervisión";
  return "Seguimiento";
}

function scopeLabel(departments, provinces) {
  if (departments.length === 1 && provinces.length === 1) {
    return `${provinces[0]}, ${departments[0]}`;
  }
  if (departments.length === 1) return `${provinces.length} provincias, ${departments[0]}`;
  return `${departments.length} departamentos`;
}

function trafficFactor(node) {
  const base =
    node.criticidad === "critica"
      ? 1.35
      : node.criticidad === "alta"
      ? 1.22
      : node.criticidad === "media"
      ? 1.1
      : 1;
  return base + Math.min(0.35, (node.interrupciones || 0) / 8000);
}

function edgeMetrics(fromCenter, node) {
  const distance = distanceKm(fromCenter, {
    lat: node.center?.[0],
    lon: node.center?.[1],
  });
  const traffic = trafficFactor(node);
  const duration = (distance / 28) * 60 * traffic;
  const cost = distance * 4.6 + duration * 0.85 + (node.camiones_puntos <= 2 ? 18 : 0);
  return { distance, duration, cost };
}

function edgeScore(metrics, optimization) {
  if (optimization === "distancia") return metrics.distance;
  if (optimization === "tiempo") return metrics.duration;
  if (optimization === "costo") return metrics.cost;
  return metrics.distance * 0.45 + metrics.duration * 0.35 + metrics.cost * 0.2;
}

function orderNodesForCoverage(origin, nodes, optimization) {
  const pending = [...nodes];
  const ordered = [];
  let currentCenter = [origin.lat, origin.lon];
  let distanceKmTotal = 0;
  let durationMinTotal = 0;
  let costTotal = 0;

  while (pending.length) {
    const next = pending
      .map((node) => ({ node, metrics: edgeMetrics(currentCenter, node) }))
      .sort(
        (a, b) =>
          edgeScore(a.metrics, optimization) - edgeScore(b.metrics, optimization)
      )[0];

    ordered.push(next.node);
    distanceKmTotal += next.metrics.distance;
    durationMinTotal += next.metrics.duration;
    costTotal += next.metrics.cost;
    currentCenter = next.node.center;
    pending.splice(
      pending.findIndex((node) => node.id === next.node.id),
      1
    );
  }

  return { ordered, distanceKmTotal, durationMinTotal, costTotal };
}

function chunkNodes(nodes, size) {
  const chunks = [];
  for (let index = 0; index < nodes.length; index += size) {
    chunks.push(nodes.slice(index, index + size));
  }
  return chunks;
}

function coordinateSignature(coordinates = []) {
  return coordinates
    .map(([lon, lat]) => `${Number(lon).toFixed(5)},${Number(lat).toFixed(5)}`)
    .join("|");
}

function matchesSizeBucket(value, bucket) {
  if (bucket === "todos") return true;
  if (bucket === "pequeno") return value <= 5;
  if (bucket === "mediano") return value >= 6 && value <= 15;
  if (bucket === "grande") return value >= 16;
  return true;
}

function selectedOriginFor({ activeBlock, activeNode, epsOriginId, epsOrigins }) {
  if (epsOriginId !== "todos") {
    return epsOrigins.find((origin) => origin.id === epsOriginId) || null;
  }
  return activeNode?.nearestOrigin || activeBlock?.nearestOrigin || null;
}

function buildRoutePlan({ block, node, routeType, optimization, origin }) {
  if (!block || !origin) return null;

  const allGroupNodes = (block.districts || []).filter(Boolean);
  const validGroupNodes = allGroupNodes.filter(hasValidCenter);
  const invalidGroupNodes = allGroupNodes.filter((item) => !hasValidCenter(item));
  const selectedNode = node && validGroupNodes.find((item) => item.id === node.id);
  const sourceNodes =
    routeType === "individual" && selectedNode ? [selectedNode] : validGroupNodes;

  if (!sourceNodes.length) {
    return {
      id: `${block.id}-${routeType}-${optimization}-sin-nodos`,
      type: routeType,
      typeLabel: routeTypeLabels[routeType],
      block,
      node: selectedNode || null,
      origin,
      stops: [],
      subroutes: [],
      invalidNodes: invalidGroupNodes,
      distanceKm: 0,
      durationMin: 0,
      cost: 0,
      optimization,
    };
  }

  const orderedResult = orderNodesForCoverage(origin, sourceNodes, optimization);
  const subroutes = chunkNodes(orderedResult.ordered, MAX_STOPS_PER_STREET_ROUTE).map(
    (stops, index) => ({
      id: `${block.id}-${routeType}-${optimization}-${index + 1}`,
      index,
      stops,
      coordinates: [
        [origin.lon, origin.lat],
        ...stops.map((item) => [item.center[1], item.center[0]]),
      ],
    })
  );

  return {
    id: [
      block.id,
      routeType,
      optimization,
      origin.id,
      selectedNode?.id || "grupo",
      coordinateSignature(subroutes.flatMap((item) => item.coordinates)),
    ].join("|"),
    type: routeType,
    typeLabel: routeTypeLabels[routeType],
    block,
    node: selectedNode || null,
    origin,
    stops: orderedResult.ordered,
    subroutes,
    invalidNodes: invalidGroupNodes,
    distanceKm: orderedResult.distanceKmTotal,
    durationMin: orderedResult.durationMinTotal,
    cost: Math.round(orderedResult.costTotal),
    optimization,
  };
}

function summaryFromGeoJson(geoJson) {
  const summary = geoJson?.features?.[0]?.properties?.summary;
  if (!summary) return { distanceKm: 0, durationMin: 0 };
  return {
    distanceKm: (summary.distance || 0) / 1000,
    durationMin: (summary.duration || 0) / 60,
  };
}

export default function Agrupacion() {
  const [searchParams] = useSearchParams();
  const districts = useMemo(() => aquaRutaData.districts || [], []);
  const groupedZones = useMemo(() => aquaRutaData.groupedZones || [], []);
  const epsOrigins = useMemo(() => aquaRutaData.epsOrigins || [], []);
  const operationalRoutes = useMemo(() => aquaRutaData.operationalRoutes || {}, []);

  const requestedGroupId = searchParams.get("grupo") || "";
  const requestedDistrictId = searchParams.get("distrito") || "";
  const requestedCriticity = searchParams.get("criticidad") || "todas";

  const districtMap = useMemo(
    () => new Map(districts.map((district) => [district.id, district])),
    [districts]
  );
  const requestedGroup = groupedZones.find((group) => group.id === requestedGroupId);
  const districtGroup = groupedZones.find((group) =>
    (group.zona_ids || []).includes(requestedDistrictId)
  );

  const [filters, setFilters] = useState({
    ...initialFilters,
    blockId: requestedGroup?.id || districtGroup?.id || "todos",
    criticidad: ["critica", "alta", "media", "baja"].includes(requestedCriticity)
      ? requestedCriticity
      : "todas",
    viewMode: requestedDistrictId || requestedGroup ? "nodos" : "grupos",
  });
  const [isDetailOpen, setIsDetailOpen] = useState(Boolean(requestedGroup || districtGroup));
  const [layers] = useState(initialLayers);
  const [statusOverrides] = useState({});
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("criticidad");
  const [activeBlockId, setActiveBlockId] = useState(
    requestedGroup?.id || districtGroup?.id || groupedZones[0]?.id || ""
  );
  const [activeNodeId, setActiveNodeId] = useState(requestedDistrictId);
  const [routeSegments, setRouteSegments] = useState([]);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState("");
  const [failedSubrouteIds, setFailedSubrouteIds] = useState([]);

  const blocks = useMemo(() => {
    return groupedZones
      .map((group) => {
        const nodeMetaById = new Map((group.nodos || []).map((node) => [node.id, node]));
        const groupDistricts = (group.zona_ids || [])
          .map((id) => districtMap.get(id))
          .filter(Boolean);
        const groupDistrictsWithUfds = groupDistricts.map((district) => ({
          ...district,
          ufds: nodeMetaById.get(district.id) || null,
        }));
        const centeredDistricts = groupDistrictsWithUfds.filter(hasValidCenter);
        const nearest = nearestOrigin(group.center, epsOrigins);
        const departments = [
          ...new Set(groupDistrictsWithUfds.map((district) => district.departamento).filter(Boolean)),
        ].sort();
        const provinces = [
          ...new Set(groupDistrictsWithUfds.map((district) => district.provincia).filter(Boolean)),
        ].sort();
        const eps = [
          ...new Set(groupDistrictsWithUfds.map((district) => district.eps_principal).filter(Boolean)),
        ].sort();
        const connections = groupDistrictsWithUfds.reduce(
          (acc, district) => acc + (district.conexiones_afectadas || 0),
          0
        );
        const estimatedPopulation = groupDistrictsWithUfds.reduce(
          (acc, district) => acc + (district.unidades_afectadas || 0),
          0
        );
        const maxDurationHours = Math.max(
          0,
          ...groupDistrictsWithUfds.map((district) => district.duracion_maxima_horas || 0)
        );
        const avgDurationHours = weightedAverage(groupDistrictsWithUfds, "duracion_promedio_horas");
        const mainDistrict =
          [...centeredDistricts].sort(
            (a, b) => (b.interrupciones || 0) - (a.interrupciones || 0)
          )[0] ||
          groupDistrictsWithUfds[0] ||
          null;
        const spreadDistances = centeredDistricts
          .map((district) =>
            distanceKm(group.center, {
              lat: district.center[0],
              lon: district.center[1],
            })
          )
          .filter(Number.isFinite);
        const spreadKm = Math.max(4, ...spreadDistances);
        const status =
          statusOverrides[group.id] || derivedStatus(group, Boolean(operationalRoutes[group.id]));
        const coverage = coverageFromDistance(nearest.distance);
        const block = {
          ...group,
          districts: groupDistrictsWithUfds,
          validNodes: centeredDistricts,
          invalidNodes: groupDistrictsWithUfds.filter((district) => !hasValidCenter(district)),
          districtIds: new Set(groupDistrictsWithUfds.map((district) => district.id)),
          departments,
          provinces,
          eps,
          scopeLabel: scopeLabel(departments, provinces),
          connections,
          estimatedPopulation,
          maxDurationHours,
          avgDurationHours,
          mainDistrict,
          spreadKm,
          nearestOrigin: nearest.origin,
          nearestOriginId: nearest.origin?.id || "",
          nearestOriginDistanceKm: nearest.distance,
          coverage,
          coverageLabel: coverageLabels[coverage],
          status,
          statusLabel: statusLabels[status],
          groupingCriterion: group.criterio_agrupacion || null,
          groupingExplanation: group.explicabilidad || null,
          ufdsSummary: group.resumen_ufds || null,
        };
        block.priorityLabel = priorityLabel(block);
        return block;
      })
      .filter((block) => block.districts.length > 0);
  }, [districtMap, epsOrigins, groupedZones, operationalRoutes, statusOverrides]);

  const blockById = useMemo(() => new Map(blocks.map((block) => [block.id, block])), [blocks]);

  const enrichedNodes = useMemo(() => {
    return blocks.flatMap((block) =>
      block.districts.filter(hasValidCenter).map((district) => {
        const nearest = nearestOrigin(district.center, epsOrigins);
        const status = statusOverrides[district.id] || block.status;
          return {
            ...district,
            blockId: block.id,
            blockName: block.nombre,
            ufds: district.ufds || null,
            nearestOrigin: nearest.origin,
          nearestOriginId: nearest.origin?.id || "",
          nearestOriginDistanceKm: nearest.distance,
          status,
          statusLabel: statusLabels[status],
        };
      })
    );
  }, [blocks, epsOrigins, statusOverrides]);

  const activeBlock = blockById.get(activeBlockId) || blocks[0] || null;
  const activeNode =
    enrichedNodes.find((node) => node.id === activeNodeId) ||
    enrichedNodes.find((node) => node.blockId === activeBlock?.id) ||
    enrichedNodes[0] ||
    null;

  const routeNode = useMemo(() => {
    if (filters.routeType !== "individual") return null;
    if (activeNode?.blockId === activeBlock?.id) return activeNode;
    return enrichedNodes.find((node) => node.blockId === activeBlock?.id) || null;
  }, [activeBlock, activeNode, enrichedNodes, filters.routeType]);

  const selectedRouteOrigin = useMemo(
    () =>
      selectedOriginFor({
        activeBlock,
        activeNode: routeNode,
        epsOriginId: filters.epsOriginId,
        epsOrigins,
      }),
    [activeBlock, epsOrigins, filters.epsOriginId, routeNode]
  );

  const options = useMemo(
    () => ({
      blocks,
      epsOrigins,
      groupingCriterion: blocks[0]?.groupingCriterion || null,
      ufdsSummary: blocks[0]?.ufdsSummary || null,
      priorities: [...new Set(blocks.map((block) => block.prioridad).filter(Boolean))].sort(
        (a, b) => a - b
      ),
    }),
    [blocks, epsOrigins]
  );

  const filteredBlocks = useMemo(() => {
    const selectedBlockExists =
      filters.blockId === "todos" || blocks.some((block) => block.id === filters.blockId);

    return blocks.filter((block) => {
      if (selectedBlockExists && filters.blockId !== "todos" && block.id !== filters.blockId) {
        return false;
      }
      if (filters.criticidad !== "todas" && block.criticidad !== filters.criticidad) return false;
      if (filters.epsOriginId !== "todos" && block.nearestOriginId !== filters.epsOriginId) {
        return false;
      }
      if (!matchesSizeBucket(block.cantidad_zonas || 0, filters.zoneSize)) return false;
      if (!matchesSizeBucket(block.validNodes.length || 0, filters.nodeSize)) return false;
      if (filters.priority !== "todos" && String(block.prioridad) !== String(filters.priority)) {
        return false;
      }
      return true;
    });
  }, [blocks, filters]);

  const filteredNodes = useMemo(() => {
    const selectedBlockExists =
      filters.blockId === "todos" || blocks.some((block) => block.id === filters.blockId);
    const allowedBlockIds = new Set(
      (filters.blockId === "todos" || !selectedBlockExists
        ? blocks
        : blocks.filter((block) => block.id === filters.blockId)
      ).map(
        (block) => block.id
      )
    );

    return enrichedNodes.filter((node) => {
      if (!allowedBlockIds.has(node.blockId)) return false;
      if (filters.criticidad !== "todas" && node.criticidad !== filters.criticidad) return false;
      if (filters.nodeStatus !== "todos" && node.status !== filters.nodeStatus) return false;
      if (filters.epsOriginId !== "todos" && node.nearestOriginId !== filters.epsOriginId) {
        return false;
      }
      return true;
    });
  }, [blocks, enrichedNodes, filters]);

  const searchedBlocks = useMemo(() => {
    const query = normalizeText(search);
    const result = !query
      ? filteredBlocks
      : filteredBlocks.filter((block) =>
          normalizeText([
            block.nombre,
            block.scopeLabel,
            block.nearestOrigin?.prestador,
            ...block.zonas,
          ].join(" ")).includes(query)
        );

    return [...result].sort((a, b) => {
      if (sortBy === "interrupciones") return b.interrupciones - a.interrupciones;
      if (sortBy === "poblacion") return b.estimatedPopulation - a.estimatedPopulation;
      if (sortBy === "zonas") return b.cantidad_zonas - a.cantidad_zonas;
      if (sortBy === "nodos") return b.validNodes.length - a.validNodes.length;
      if (sortBy === "distancia") return a.nearestOriginDistanceKm - b.nearestOriginDistanceKm;
      if (sortBy === "prioridad") return (a.prioridad || 999) - (b.prioridad || 999);
      return (priorityRank[b.criticidad] || 0) - (priorityRank[a.criticidad] || 0);
    });
  }, [filteredBlocks, search, sortBy]);

  const searchedNodes = useMemo(() => {
    const query = normalizeText(search);
    const result = !query
      ? filteredNodes
      : filteredNodes.filter((node) =>
          normalizeText([
            node.id,
            node.nombre,
            node.blockName,
            node.provincia,
            node.nearestOrigin?.prestador,
          ].join(" ")).includes(query)
        );

    return [...result].sort((a, b) => {
      if (sortBy === "interrupciones") return b.interrupciones - a.interrupciones;
      if (sortBy === "distancia") return a.nearestOriginDistanceKm - b.nearestOriginDistanceKm;
      return (priorityRank[b.criticidad] || 0) - (priorityRank[a.criticidad] || 0);
    });
  }, [filteredNodes, search, sortBy]);

  const routePlan = useMemo(
    () =>
      buildRoutePlan({
        block: activeBlock,
        node: routeNode,
        routeType: filters.routeType,
        optimization: filters.optimization,
        origin: selectedRouteOrigin,
      }),
    [activeBlock, filters.optimization, filters.routeType, routeNode, selectedRouteOrigin]
  );

  const routeRequestKey = useMemo(() => {
    if (filters.viewMode !== "rutas" || !routePlan?.subroutes?.length) return "";
    return `${routePlan.id}|${routePlan.subroutes
      .map((route) => coordinateSignature(route.coordinates))
      .join("::")}`;
  }, [filters.viewMode, routePlan]);

  useEffect(() => {
    let cancelled = false;

    async function loadCoverageRoutes() {
      if (!routeRequestKey || !routePlan?.subroutes?.length) {
        setRouteSegments([]);
        setRouteError("");
        setRouteLoading(false);
        setFailedSubrouteIds([]);
        return;
      }

      setRouteLoading(true);
      setRouteError("");
      setRouteSegments([]);
      setFailedSubrouteIds([]);

      const results = await Promise.allSettled(
        routePlan.subroutes.map((subroute) => fetchRouteGeoJson(subroute.coordinates))
      );

      if (cancelled) return;

      const okSegments = [];
      const failed = [];

      results.forEach((result, index) => {
        const subroute = routePlan.subroutes[index];
        if (result.status === "fulfilled") {
          okSegments.push({
            id: subroute.id,
            index,
            stops: subroute.stops,
            geoJson: result.value,
            summary: summaryFromGeoJson(result.value),
          });
        } else {
          console.error(result.reason);
          failed.push(subroute.id);
        }
      });

      setRouteSegments(okSegments);
      setFailedSubrouteIds(failed);
      setRouteError(
        failed.length
          ? "Una o más subrutas no pudieron resolverse sobre la red vial real."
          : ""
      );
      setRouteLoading(false);
    }

    loadCoverageRoutes();
    return () => {
      cancelled = true;
    };
  }, [routePlan, routeRequestKey]);

  const routeResult = useMemo(() => {
    if (!routePlan) return null;

    const failedRouteIds = new Set(failedSubrouteIds);
    const failedNodeIds = new Set(
      routePlan.subroutes
        .filter((subroute) => failedRouteIds.has(subroute.id))
        .flatMap((subroute) => subroute.stops.map((node) => node.id))
    );
    const coveredNodes = routePlan.stops.filter((node) => !failedNodeIds.has(node.id));
    const noConnectionNodes = [
      ...routePlan.invalidNodes,
      ...routePlan.stops.filter((node) => failedNodeIds.has(node.id)),
    ];
    const pendingNodes = routeLoading ? routePlan.stops : [];
    const realDistanceKm = routeSegments.reduce(
      (acc, segment) => acc + (segment.summary?.distanceKm || 0),
      0
    );
    const realDurationMin = routeSegments.reduce(
      (acc, segment) => acc + (segment.summary?.durationMin || 0),
      0
    );
    const distanceKm = realDistanceKm || routePlan.distanceKm;
    const durationMin = realDurationMin || routePlan.durationMin;
    const cost = Math.round(distanceKm * 4.6 + durationMin * 0.85 + routePlan.stops.length * 8);

    const status = routeLoading
      ? "pendiente"
      : !routePlan.stops.length || coveredNodes.length === 0
      ? "sin-conexion"
      : noConnectionNodes.length > 0 || coveredNodes.length < routePlan.stops.length
      ? "parcial"
      : "cubierta";

    return {
      status,
      coveredNodes,
      pendingNodes,
      noConnectionNodes,
      failedSubrouteIds,
      distanceKm,
      durationMin,
      cost,
      coverageType:
        routePlan.type === "individual"
          ? "ruta individual"
          : routePlan.subroutes.length > 1
          ? "subrutas múltiples"
          : "ruta única",
    };
  }, [failedSubrouteIds, routeLoading, routePlan, routeSegments]);

  const routeLayerKey = useMemo(() => {
    if (!routeRequestKey) return "";
    return [
      routeRequestKey,
      routeSegments.map((segment) => segment.id).join(","),
      failedSubrouteIds.join(","),
      routeLoading ? "loading" : "ready",
    ].join("|");
  }, [failedSubrouteIds, routeLoading, routeRequestKey, routeSegments]);

  const routeVisible =
    filters.routeStatus === "todos" || routeResult?.status === filters.routeStatus;
  const visibleRoutePlan = routeVisible ? routePlan : null;
  const visibleRouteSegments = routeVisible ? routeSegments : [];

  function handleFilterChange(key, value) {
    setFilters((current) => {
      const next = { ...current, [key]: value };

      if (key === "viewMode") {
        if (value === "grupos") {
          next.routeType = "grupal";
          next.nodeStatus = "todos";
          next.routeStatus = "todos";
        }
        if (value === "nodos") {
          next.routeStatus = "todos";
        }
        if (value === "rutas") {
          next.zoneSize = "todos";
          next.nodeSize = "todos";
          next.nodeStatus = "todos";
        }
      }

      if (key === "routeType" && value === "individual") {
        next.viewMode = "rutas";
      }

      return next;
    });

    if (key === "blockId" && value !== "todos") {
      const block = blockById.get(value);
      setActiveBlockId(value);
      const firstNode = block?.validNodes?.[0];
      if (firstNode) setActiveNodeId(firstNode.id);
    }
  }

  function resetFilters() {
    setFilters(initialFilters);
    setSearch("");
    setSortBy("criticidad");
  }

  function switchMode(mode, block = activeBlock) {
    setFilters((current) => ({
      ...current,
      viewMode: mode,
      blockId: block?.id || current.blockId,
      routeType: mode === "rutas" ? current.routeType : "grupal",
    }));
    if (block?.id) {
      setActiveBlockId(block.id);
      const firstNode = block.validNodes?.[0];
      if (firstNode) setActiveNodeId(firstNode.id);
    }
  }

  function selectBlock(blockId) {
    const block = blockById.get(blockId);
    setActiveBlockId(blockId);
    const firstNode = block?.validNodes?.[0];
    if (firstNode) setActiveNodeId(firstNode.id);
  }

  function openGroupDetail(block) {
    if (!block?.id) return;
    selectBlock(block.id);
    setFilters((current) => ({
      ...current,
      blockId: "todos",
      viewMode: "nodos",
      routeType: "grupal",
      routeStatus: "todos",
    }));
    setIsDetailOpen(true);
  }

  function closeGroupDetail() {
    setIsDetailOpen(false);
    setFilters((current) => ({
      ...current,
      blockId: "todos",
      viewMode: "grupos",
      routeType: "grupal",
      routeStatus: "todos",
    }));
  }

  function selectNode(nodeId) {
    const node = enrichedNodes.find((item) => item.id === nodeId);
    if (!node) return;
    setActiveNodeId(node.id);
    setActiveBlockId(node.blockId);
    if (filters.viewMode === "rutas") {
      setFilters((current) => ({ ...current, routeType: "individual" }));
    }
  }

  return (
    <MainLayout>
      <section className="territory-page">
        {!isDetailOpen ? (
          <>
            <TerritoryTopFilters
              filters={filters}
              options={options}
              onFilterChange={handleFilterChange}
              onReset={resetFilters}
            />

            <TerritoryResultsTable
              blocks={searchedBlocks}
              activeBlockId={activeBlock?.id}
              search={search}
              sortBy={sortBy}
              onSearchChange={setSearch}
              onSortChange={setSortBy}
              onOpenGroup={openGroupDetail}
            />
          </>
        ) : (
          <>
            <article className="territory-detail-header">
              <button type="button" onClick={closeGroupDetail}>
                Volver al listado
              </button>
              <div>
                <span>Detalle del grupo operativo</span>
                <h2>{activeBlock?.nombre || "Grupo no disponible"}</h2>
                <p>{activeBlock?.scopeLabel || "Selecciona un grupo para revisar detalle."}</p>
              </div>
              <div className="territory-detail-tabs">
                <button
                  type="button"
                  className={filters.viewMode === "nodos" ? "active" : ""}
                  onClick={() => switchMode("nodos", activeBlock)}
                >
                  Nodos
                </button>
              </div>
            </article>

            <div className="territory-main-grid">
              <TerritoryCoverageMap
                viewMode={filters.viewMode}
                blocks={activeBlock ? [activeBlock] : []}
                nodes={searchedNodes}
                epsOrigins={epsOrigins}
                activeBlock={activeBlock}
                activeNode={activeNode}
                routePlan={visibleRoutePlan}
                routeResult={routeVisible ? routeResult : null}
                routeSegments={visibleRouteSegments}
                routeKey={routeLayerKey}
                routeStatus={
                  routeLoading
                    ? "Calculando sobre red vial"
                    : !routeVisible
                    ? "Filtro de cobertura sin coincidencias"
                    : routeResult?.status === "cubierta"
                    ? "Cobertura vial completa"
                    : routeResult?.status === "parcial"
                    ? "Cobertura parcial"
                    : routeError || "Sin cobertura vial"
                }
                layers={layers}
                onSelectBlock={selectBlock}
                onSelectNode={selectNode}
              />

              <TerritorySidePanel
                viewMode={filters.viewMode}
                block={activeBlock}
                node={activeNode}
                routePlan={visibleRoutePlan}
                routeResult={routeVisible ? routeResult : null}
                routeLoading={routeLoading}
                routeError={routeError}
                onSelectNode={selectNode}
              />
            </div>
          </>
        )}
      </section>
    </MainLayout>
  );
}
