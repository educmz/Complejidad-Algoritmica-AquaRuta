import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import MainLayout from "../components/layout/MainLayout";
import TerritoryTopFilters from "../components/grouping/TerritoryTopFilters";
import TerritoryCoverageMap from "../components/grouping/TerritoryCoverageMap";
import TerritorySidePanel from "../components/grouping/TerritorySidePanel";
import TerritoryResultsTable from "../components/grouping/TerritoryResultsTable";
import { fetchRouteGeoJson } from "../services/mapApi";
import { DEFAULT_GROUPING_CONFIG, runGrouping } from "../services/groupingApi";
import { aquaRutaData } from "../data/aquaRutaData";
import { epsCoverageStatus } from "../utils/epsCoverage";

const priorityRank = { critica: 4, alta: 3, media: 2, baja: 1 };
const statusLabels = {
  pendiente: "Pendiente",
  priorizado: "Priorizado",
  revision: "En revisión",
  rutas: "Listo para ruteo",
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
  groupType: "todos",
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

function normalizeProviderName(value) {
  return normalizeText(value)
    .replace(/\bs\.?\s*a\.?\b/g, "")
    .replace(/\beps\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function preferredOriginForGroup(groupDistricts, center, epsOrigins) {
  if (!center || !epsOrigins.length) {
    return { origin: null, distance: Infinity };
  }

  const providers = [
    ...new Set(
      groupDistricts
        .map((district) => district.eps_principal)
        .filter(Boolean)
        .map(normalizeProviderName)
    ),
  ];

  const candidates = epsOrigins.filter((origin) => {
    const provider = normalizeProviderName(origin.prestador);
    return providers.some(
      (item) => provider.includes(item) || item.includes(provider)
    );
  });

  const source = candidates.length ? candidates : epsOrigins;
  return nearestOrigin(center, source);
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

function derivedStatus(group, hasRouteScenario) {
  if (hasRouteScenario) return "rutas";
  if (group.criticidad === "critica") return "priorizado";
  if (group.criticidad === "alta" || group.criticidad === "media") return "revision";
  return "pendiente";
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
  if (bucket === "individual") return value === 1;
  if (bucket === "pequeno") return value >= 2 && value <= 5;
  if (bucket === "mediano") return value >= 6 && value <= 15;
  if (bucket === "grande") return value >= 16;
  return true;
}

function groupTypeFor(block) {
  if ((block.validNodes?.length || 0) === 0 && (block.invalidNodes?.length || 0) > 0) {
    return "sin-georreferenciacion";
  }
  if (block.cantidad_zonas === 1 || block.validNodes?.length === 1) return "individual";
  if ((block.validNodes?.length || 0) >= 2) return "sectorizable";
  return "sin-georreferenciacion";
}

function groupTypeLabel(type) {
  if (type === "sectorizable") return "Sectorizable";
  if (type === "individual") return "Grupo individual";
  return "Sin georreferenciación";
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
  const groupingFilterKey = searchParams.toString();
  const districts = useMemo(() => aquaRutaData.districts || [], []);
  const precalculatedGroupedZones = useMemo(() => aquaRutaData.groupedZones || [], []);
  const epsOrigins = useMemo(() => aquaRutaData.epsOrigins || [], []);
  const operationalRoutes = useMemo(() => aquaRutaData.operationalRoutes || {}, []);
  const initialCriterionFromData = useMemo(
    () => aquaRutaData.groupedZones?.[0]?.criterio_agrupacion || null,
    []
  );
  const [groupingConfig] = useState(() => ({
    ...DEFAULT_GROUPING_CONFIG,
    criterio: initialCriterionFromData?.criterio || DEFAULT_GROUPING_CONFIG.criterio,
    umbral_distancia_geografica_km:
      Number(initialCriterionFromData?.umbral_distancia_geografica_km) ||
      DEFAULT_GROUPING_CONFIG.umbral_distancia_geografica_km,
    umbral_distancia_vial_km:
      Number(initialCriterionFromData?.umbral_distancia_vial_km) ||
      DEFAULT_GROUPING_CONFIG.umbral_distancia_vial_km,
    umbral_tiempo_min:
      Number(initialCriterionFromData?.umbral_tiempo_min) ||
      DEFAULT_GROUPING_CONFIG.umbral_tiempo_min,
    umbral_costo:
      Number(initialCriterionFromData?.umbral_costo) ||
      DEFAULT_GROUPING_CONFIG.umbral_costo,
  }));
  const groupingFilters = useMemo(
    () => {
      const params = new URLSearchParams(groupingFilterKey);
      return {
        departamento: params.get("departamento") || null,
        provincia: params.get("provincia") || null,
        distrito: params.get("distrito_nombre") || null,
        eps: params.get("eps") || null,
        criticidad: params.get("criticidad") || null,
      };
    },
    [groupingFilterKey]
  );
  const groupingRequest = useMemo(
    () => ({
      filters: groupingFilters,
      config: groupingConfig,
    }),
    [groupingConfig, groupingFilters]
  );
  const [groupedZones, setGroupedZones] = useState(precalculatedGroupedZones);
  const [groupingStatus, setGroupingStatus] = useState(
    precalculatedGroupedZones.length ? "idle" : "loading"
  );
  const [groupingError, setGroupingError] = useState("");
  const [groupingSummary, setGroupingSummary] = useState(null);
  const [groupingRunToken, setGroupingRunToken] = useState(0);

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
  const [detailPanelOpen, setDetailPanelOpen] = useState(true);
  const [mapExpanded, setMapExpanded] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => window.dispatchEvent(new Event("resize")), 220);
    return () => window.clearTimeout(timer);
  }, [detailPanelOpen, mapExpanded]);

  useEffect(() => {
    const controller = new AbortController();
    const loadingTimer = window.setTimeout(() => {
      setGroupingStatus("loading");
      setGroupingError("");
    }, 0);

    runGrouping(groupingRequest, { signal: controller.signal })
      .then((payload) => {
        const groups = payload.groups || [];
        setGroupedZones(groups);
        setGroupingSummary(payload.summary || null);
        setGroupingStatus(groups.length ? "success" : "empty");

        const groupIds = new Set(groups.map((group) => group.id));
        const selectedStillExists = activeBlockId && groupIds.has(activeBlockId);
        if (!selectedStillExists) {
          const firstGroup = groups[0] || null;
          setActiveBlockId(firstGroup?.id || "");
          setActiveNodeId(firstGroup?.zona_ids?.[0] || "");
          setIsDetailOpen(false);
          setFilters((current) => ({
            ...current,
            blockId: firstGroup?.id || "todos",
            viewMode: "grupos",
          }));
          return;
        }

        const selectedGroup = groups.find((group) => group.id === activeBlockId);
        if (
          activeNodeId &&
          selectedGroup &&
          !(selectedGroup.zona_ids || []).includes(activeNodeId)
        ) {
          setActiveNodeId(selectedGroup.zona_ids?.[0] || "");
        }
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        setGroupedZones([]);
        setGroupingSummary(null);
        setGroupingStatus("error");
        setGroupingError(error?.message || "No se pudo calcular la agrupacion operativa.");
      });

    return () => {
      window.clearTimeout(loadingTimer);
      controller.abort();
    };
  }, [activeBlockId, activeNodeId, groupingRequest, groupingRunToken]);

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
        const fallbackCenter = group.center || centeredDistricts[0]?.center || null;
        const nearest = preferredOriginForGroup(
          groupDistrictsWithUfds,
          fallbackCenter,
          epsOrigins
        );
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
          (acc, district) => acc + (district.personas_afectadas_estimadas || 0),
          0
        );
        const demandWeight = Math.max(
          0,
          ...groupDistrictsWithUfds.map((district) => Number(district.peso_demanda_familiar || 0))
        );
        const priorityScore =
          groupDistrictsWithUfds.reduce(
            (acc, district) => acc + Number(district.prioridad_score || 0),
            0
          ) / Math.max(1, groupDistrictsWithUfds.length);
        const avgHouseholdSize =
          groupDistrictsWithUfds.reduce(
            (acc, district) => acc + Number(district.promedio_integrantes_hogar || 0),
            0
          ) / Math.max(1, groupDistrictsWithUfds.length);
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
            fallbackCenter
              ? distanceKm(fallbackCenter, {
                  lat: district.center[0],
                  lon: district.center[1],
                })
              : 0
          )
          .filter(Number.isFinite);
        const spreadKm = Math.max(4, ...spreadDistances);
        const status =
          statusOverrides[group.id] || derivedStatus(group, Boolean(operationalRoutes[group.id]));
        const epsCoverage = epsCoverageStatus(nearest.distance);
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
          demandWeight,
          priorityScore,
          avgHouseholdSize,
          maxDurationHours,
          avgDurationHours,
          mainDistrict,
          spreadKm,
          nearestOrigin: nearest.origin,
          nearestOriginId: nearest.origin?.id || "",
          nearestOriginDistanceKm: nearest.distance,
          epsCoverageKey: epsCoverage.key,
          epsCoverageLabel: epsCoverage.label,
          epsCoverageDescription: epsCoverage.description,
          status,
          statusLabel: statusLabels[status],
          groupingExplanation: group.explicabilidad || null,
        };
        block.groupType = groupTypeFor(block);
        block.groupTypeLabel = groupTypeLabel(block.groupType);
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
  const detailNodes = useMemo(() => {
    if (!activeBlock) return [];

    return (activeBlock.validNodes || []).map((node) => {
      const nearest = activeBlock.nearestOrigin
        ? {
            origin: activeBlock.nearestOrigin,
            distance: distanceKm(node.center, activeBlock.nearestOrigin),
          }
        : nearestOrigin(node.center, epsOrigins);
      const status = statusOverrides[node.id] || activeBlock.status;
      return {
        ...node,
        blockId: activeBlock.id,
        blockName: activeBlock.nombre,
        nearestOrigin: nearest.origin || activeBlock.nearestOrigin,
        nearestOriginId: nearest.origin?.id || activeBlock.nearestOriginId || "",
        nearestOriginDistanceKm: Number.isFinite(nearest.distance)
          ? nearest.distance
          : activeBlock.nearestOriginDistanceKm,
        status,
        statusLabel: statusLabels[status],
      };
    });
  }, [activeBlock, epsOrigins, statusOverrides]);

  const activeNode =
    detailNodes.find((node) => node.id === activeNodeId) ||
    detailNodes[0] ||
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
      epsOrigins,
    }),
    [epsOrigins]
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
      if (filters.groupType === "con-eps" && !block.nearestOrigin) return false;
      if (filters.groupType === "sin-eps" && block.nearestOrigin) return false;
      if (
        !["todos", "con-eps", "sin-eps"].includes(filters.groupType) &&
        block.groupType !== filters.groupType
      ) {
        return false;
      }
      return true;
    });
  }, [blocks, filters]);

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
      if (sortBy === "demanda") return b.demandWeight - a.demandWeight;
      if (sortBy === "zonas") return b.cantidad_zonas - a.cantidad_zonas;
      if (sortBy === "nodos") return b.validNodes.length - a.validNodes.length;
      if (sortBy === "distancia") return a.nearestOriginDistanceKm - b.nearestOriginDistanceKm;
      if (sortBy === "prioridad") return (a.prioridad || 999) - (b.prioridad || 999);
      return (priorityRank[b.criticidad] || 0) - (priorityRank[a.criticidad] || 0);
    });
  }, [filteredBlocks, search, sortBy]);

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

  function retryGrouping() {
    setGroupingRunToken((current) => current + 1);
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
    setActiveBlockId(block.id);
    setActiveNodeId(block.validNodes?.[0]?.id || "");
    setSearch("");
    setFilters((current) => ({
      ...current,
      blockId: block.id,
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
      <section className={`territory-page workspace-page ${mapExpanded ? "workspace-expanded" : ""} ${detailPanelOpen ? "" : "panel-collapsed"}`}>
        {!isDetailOpen ? (
          <>
            <TerritoryTopFilters
              filters={filters}
              options={options}
              onFilterChange={handleFilterChange}
              onReset={resetFilters}
            />

            {groupingStatus === "loading" && (
              <div className="empty-state">
                Calculando grupos operativos...
              </div>
            )}

            {groupingStatus === "error" && (
              <div className="empty-state">
                <p>{groupingError || "No se pudo calcular la agrupacion operativa."}</p>
                <button type="button" onClick={retryGrouping}>Reintentar</button>
              </div>
            )}

            {groupingStatus === "empty" && (
              <div className="empty-state">
                No hay distritos que coincidan con los filtros seleccionados.
              </div>
            )}

            {groupingStatus === "success" && groupingSummary && (
              <div className="empty-state">
                {groupingSummary.groupCount} grupos recalculados desde {groupingSummary.districtCount} distritos.
              </div>
            )}

            {groupingStatus !== "error" && groupingStatus !== "empty" && (
              <TerritoryResultsTable
                blocks={searchedBlocks}
                activeBlockId={activeBlock?.id}
                search={search}
                sortBy={sortBy}
                onSearchChange={setSearch}
                onSortChange={setSortBy}
                onOpenGroup={openGroupDetail}
              />
            )}
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
                <button
                  type="button"
                  className={filters.viewMode === "rutas" ? "active" : ""}
                  onClick={() => switchMode("rutas", activeBlock)}
                >
                  Cobertura
                </button>
              </div>
            </article>

            <div className="workspace-toolbar" aria-label="Herramientas de agrupacion">
              <button
                type="button"
                aria-expanded={detailPanelOpen}
                aria-controls="territory-side-panel"
                onClick={() => setDetailPanelOpen((current) => !current)}
              >
                {detailPanelOpen ? "Ocultar detalle" : "Mostrar detalle"}
              </button>
              <button
                type="button"
                aria-pressed={mapExpanded}
                onClick={() => setMapExpanded((current) => !current)}
              >
                {mapExpanded ? "Salir de mapa ampliado" : "Ampliar mapa"}
              </button>
            </div>

            <div className="territory-main-grid workspace-map-layout">
              <TerritoryCoverageMap
                viewMode={filters.viewMode}
                blocks={activeBlock ? [activeBlock] : []}
                nodes={detailNodes}
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

              <div id="territory-side-panel" className="workspace-side-panel">
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
            </div>
          </>
        )}
      </section>
    </MainLayout>
  );
}
