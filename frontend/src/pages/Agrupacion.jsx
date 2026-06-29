import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import MainLayout from "../components/layout/MainLayout";
import TerritoryGroupFilters from "../components/grouping/TerritoryGroupFilters";
import TerritoryCoverageMap from "../components/grouping/TerritoryCoverageMap";
import TerritoryGroupSidePanel from "../components/grouping/TerritoryGroupSidePanel";
import TerritoryGroupTable from "../components/grouping/TerritoryGroupTable";
import MapToolbar from "../components/map/MapToolbar";
import { DEFAULT_GROUPING_CONFIG, runGrouping } from "../services/groupingApi";
import { aquaRutaData } from "../data/aquaRutaData";
import { epsCoverageStatus } from "../utils/epsCoverage";
import { consolidateDashboardDistrictsAndGroups } from "../utils/dashboardGeo";
import { emptyDashboardFilters } from "../utils/dashboardFilters";
import { buildRouteContextPath, writeRouteContext } from "../utils/sharedRouteContext";

const priorityRank = { critica: 4, alta: 3, media: 2, baja: 1 };
const statusLabels = {
  pendiente: "Pendiente",
  priorizado: "Priorizado",
  revision: "En revisión",
};

const initialFilters = {
  viewMode: "grupos",
  blockId: "todos",
  criticidad: "todas",
  epsOriginId: "todos",
  zoneSize: "todos",
  departamento: "todos",
  provincia: "todos",
  distrito: "todos",
  nodeStatus: "todos",
};

const initialLayers = {
  showEps: true,
  showBlocks: true,
  showRoutes: true,
  showNodes: true,
};

const GROUPING_STORAGE_KEY = "aquaruta:grouping-state:v1";

function readStoredGroupingState() {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(GROUPING_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeStoredGroupingState(state) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(GROUPING_STORAGE_KEY, JSON.stringify(state));
}

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

function derivedStatus(group) {
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

function matchesSizeBucket(value, bucket) {
  if (bucket === "todos") return true;
  if (bucket === "individual") return value === 1;
  if (bucket === "pequeno") return value >= 2 && value <= 5;
  if (bucket === "mediano") return value >= 6 && value <= 15;
  if (bucket === "grande") return value >= 16;
  return true;
}

function groupTypeFor(block) {
  if (block.cantidad_zonas === 1 || block.validNodes?.length === 1) return "individual";
  return "sectorizable";
}

function groupTypeLabel(type) {
  if (type === "sectorizable") return "Sectorizable";
  return "Individual";
}

export default function Agrupacion() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const groupingFilterKey = searchParams.toString();
  const storedGroupingState = useMemo(() => readStoredGroupingState(), []);
  const districts = useMemo(() => aquaRutaData.districts || [], []);
  const canonicalGroupingData = useMemo(
    () => consolidateDashboardDistrictsAndGroups(districts, []),
    [districts]
  );
  const canonicalDistricts = canonicalGroupingData.districts;
  const epsOrigins = useMemo(() => aquaRutaData.epsOrigins || [], []);
  const operationalRoutes = useMemo(() => aquaRutaData.operationalRoutes || {}, []);
  const [groupingConfig] = useState(() => ({ ...DEFAULT_GROUPING_CONFIG }));
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
  const [groupedZones, setGroupedZones] = useState([]);
  const [groupingStatus, setGroupingStatus] = useState("loading");
  const [groupingError, setGroupingError] = useState("");
  const [groupingRunToken, setGroupingRunToken] = useState(0);

  const requestedGroupId = searchParams.get("grupo") || searchParams.get("groupId") || "";
  const requestedDistrictId =
    searchParams.get("distrito") || searchParams.get("districtId") || "";
  const requestedCriticity =
    searchParams.get("criticidad") || "todas";

  const districtMap = useMemo(
    () => new Map(canonicalDistricts.map((district) => [district.id, district])),
    [canonicalDistricts]
  );
  const requestedGroup = groupedZones.find((group) => group.id === requestedGroupId);
  const districtGroup = groupedZones.find((group) =>
    (group.zona_ids || []).includes(requestedDistrictId)
  );

  const [filters, setFilters] = useState({
    ...initialFilters,
    departamento: searchParams.get("departamento") || "todos",
    provincia: searchParams.get("provincia") || "todos",
    distrito: requestedDistrictId || "todos",
    blockId: requestedGroupId || requestedGroup?.id || districtGroup?.id || "todos",
    criticidad: ["critica", "alta", "media", "baja"].includes(requestedCriticity)
      ? requestedCriticity
      : "todas",
    viewMode: requestedDistrictId || requestedGroupId ? "nodos" : "grupos",
  });
  const [isDetailOpen, setIsDetailOpen] = useState(
    Boolean(requestedGroupId || requestedDistrictId)
  );
  const [layers] = useState(initialLayers);
  const [statusOverrides] = useState({});
  const [search, setSearch] = useState(storedGroupingState.search || "");
  const [sortBy, setSortBy] = useState(storedGroupingState.sortBy || "criticidad");
  const [pageSize, setPageSize] = useState(Number(storedGroupingState.pageSize) || 20);
  const [page, setPage] = useState(Number(storedGroupingState.page) || 1);
  const [activeBlockId, setActiveBlockId] = useState(
    requestedGroupId || requestedGroup?.id || districtGroup?.id || ""
  );
  const [activeNodeId, setActiveNodeId] = useState(requestedDistrictId);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [showMapLegend, setShowMapLegend] = useState(true);
  const [mapFocusVersion, setMapFocusVersion] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => window.dispatchEvent(new Event("resize")), 220);
    return () => window.clearTimeout(timer);
  }, [mapExpanded]);

  useEffect(() => {
    writeStoredGroupingState({
      filters,
      search,
      sortBy,
      page,
      pageSize,
      activeBlockId,
      activeNodeId,
      isDetailOpen,
    });
  }, [activeBlockId, activeNodeId, filters, isDetailOpen, page, pageSize, search, sortBy]);

  useEffect(() => {
    const controller = new AbortController();
    const loadingTimer = window.setTimeout(() => {
      setGroupingStatus("loading");
      setGroupingError("");
    }, 0);

    runGrouping(groupingRequest, { signal: controller.signal })
      .then((payload) => {
        const groups = consolidateDashboardDistrictsAndGroups(districts, payload.groups || []).groups.filter(
          (group) => (group.zona_ids || []).length > 0
        );
        setGroupedZones(groups);
        setGroupingStatus(groups.length ? "success" : "empty");

        const groupIds = new Set(groups.map((group) => group.id));
        const requestedBlock = groups.find(
          (group) =>
            group.id === requestedGroupId ||
            (requestedDistrictId && (group.zona_ids || []).includes(requestedDistrictId))
        );
        if (requestedBlock) {
          setActiveBlockId(requestedBlock.id);
          setActiveNodeId(
            (requestedBlock.zona_ids || []).includes(requestedDistrictId)
              ? requestedDistrictId
              : ""
          );
          setIsDetailOpen(true);
          setFilters((current) => ({
            ...current,
            blockId: requestedBlock.id,
            distrito: requestedDistrictId || current.distrito,
            viewMode: "nodos",
          }));
          return;
        }

        const selectedStillExists = activeBlockId && groupIds.has(activeBlockId);
        if (!selectedStillExists) {
          setActiveBlockId("");
          setActiveNodeId("");
          setIsDetailOpen(false);
          setFilters((current) => ({
            ...current,
            blockId: "todos",
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
        setGroupingStatus("error");
        setGroupingError(error?.message || "No se pudo calcular la agrupación operativa.");
      });

    return () => {
      window.clearTimeout(loadingTimer);
      controller.abort();
    };
  }, [activeBlockId, activeNodeId, districts, groupingRequest, groupingRunToken, requestedDistrictId, requestedGroupId]);

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
        const affectedHouseholds = groupDistrictsWithUfds.reduce(
          (acc, district) => acc + (Number(district.total_hogares) || 0),
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
          affectedHouseholds,
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

  const activeBlock = blockById.get(activeBlockId) || null;
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

  const options = useMemo(() => {
    const departments = new Set();
    const provinces = new Set();
    const districtOptions = [];

    for (const block of blocks) {
      for (const district of block.districts || []) {
        if (district.departamento) departments.add(district.departamento);
        if (
          filters.departamento === "todos" ||
          district.departamento === filters.departamento
        ) {
          if (district.provincia) provinces.add(district.provincia);
        }
        const departmentMatches =
          filters.departamento === "todos" || district.departamento === filters.departamento;
        const provinceMatches =
          filters.provincia === "todos" || district.provincia === filters.provincia;
        if (departmentMatches && provinceMatches) {
          districtOptions.push({
            value: district.id,
            label: `${district.nombre} - ${district.provincia}, ${district.departamento}`,
          });
        }
      }
    }

    return {
      epsOrigins,
      departments: [...departments].sort((a, b) => a.localeCompare(b, "es")),
      provinces: [...provinces].sort((a, b) => a.localeCompare(b, "es")),
      districts: districtOptions
        .filter((district, index, items) =>
          items.findIndex((item) => item.value === district.value) === index
        )
        .sort((a, b) => a.label.localeCompare(b.label, "es")),
    };
  }, [blocks, epsOrigins, filters.departamento, filters.provincia]);

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
      if (
        filters.departamento !== "todos" &&
        !block.districts.some((district) => district.departamento === filters.departamento)
      ) {
        return false;
      }
      if (
        filters.provincia !== "todos" &&
        !block.districts.some((district) => district.provincia === filters.provincia)
      ) {
        return false;
      }
      if (
        filters.distrito !== "todos" &&
        !block.districts.some((district) => district.id === filters.distrito)
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
            ...block.districts.flatMap((district) => [
              district.nombre,
              district.provincia,
              district.departamento,
              district.eps_principal,
            ]),
          ].join(" ")).includes(query)
        );

    return [...result].sort((a, b) => {
      if (sortBy === "interrupciones") return b.interrupciones - a.interrupciones;
      if (sortBy === "poblacion") return b.estimatedPopulation - a.estimatedPopulation;
      if (sortBy === "zonas") return b.cantidad_zonas - a.cantidad_zonas;
      if (sortBy === "hogares") return b.affectedHouseholds - a.affectedHouseholds;
      if (sortBy === "distancia") return a.nearestOriginDistanceKm - b.nearestOriginDistanceKm;
      if (sortBy === "prioridad") return (a.prioridad || 999) - (b.prioridad || 999);
      return (priorityRank[b.criticidad] || 0) - (priorityRank[a.criticidad] || 0);
    });
  }, [filteredBlocks, search, sortBy]);


  function handleFilterChange(key, value) {
    setPage(1);
    setFilters((current) => {
      const next = { ...current, [key]: value };

      if (key === "viewMode") {
        if (value === "grupos") {
          next.nodeStatus = "todos";
        }
      }
      if (key === "departamento") {
        next.provincia = "todos";
        next.distrito = "todos";
      }
      if (key === "provincia") {
        next.distrito = "todos";
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
    setPageSize(20);
    setPage(1);
    setActiveBlockId("");
    setActiveNodeId("");
    setIsDetailOpen(false);
    navigate("/agrupacion", { replace: true });
  }

  function retryGrouping() {
    setGroupingRunToken((current) => current + 1);
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
    }));
    setIsDetailOpen(true);
    navigate(`/agrupacion?grupo=${encodeURIComponent(block.id)}`, { replace: true });
  }

  function closeGroupDetail() {
    setIsDetailOpen(false);
    setActiveBlockId("");
    setActiveNodeId("");
    setFilters((current) => ({
      ...current,
      blockId: "todos",
      distrito: "todos",
      viewMode: "grupos",
    }));
    navigate("/agrupacion", { replace: true });
  }

  function selectNode(nodeId) {
    const node = enrichedNodes.find((item) => item.id === nodeId);
    if (!node) return;
    setActiveNodeId(node.id);
    setActiveBlockId(node.blockId);
    navigate(`/agrupacion?grupo=${encodeURIComponent(node.blockId)}&distrito=${encodeURIComponent(node.id)}`, {
      replace: true,
    });
  }

  function openSectorization() {
    if (!activeBlock?.id || activeBlock.groupType !== "sectorizable") return;
    const context = {
      filters: {
        ...emptyDashboardFilters(),
        departamento: filters.departamento,
        provincia: filters.provincia,
        distrito: activeNodeId || filters.distrito,
        grupo: activeBlock.id,
      },
      groupId: activeBlock.id,
      districtId: activeNodeId || "",
    };
    writeRouteContext(context);
    navigate(buildRouteContextPath("/sectorizacion", context));
  }

  return (
    <MainLayout>
      <section className={`territory-page workspace-page ${mapExpanded ? "workspace-expanded" : ""}`}>
        {!isDetailOpen ? (
          <>
              <TerritoryGroupFilters
                filters={filters}
                options={options}
                search={search}
                sortBy={sortBy}
                pageSize={pageSize}
                onFilterChange={handleFilterChange}
                onSearchChange={(value) => {
                  setSearch(value);
                  setPage(1);
                }}
                onSortChange={(value) => {
                  setSortBy(value);
                  setPage(1);
                }}
                onPageSizeChange={(value) => {
                  setPageSize(value);
                  setPage(1);
                }}
                onReset={resetFilters}
            />

            {groupingStatus === "loading" && (
              <div className="empty-state">
                Calculando grupos operativos...
              </div>
            )}

            {groupingStatus === "error" && (
              <div className="empty-state">
                <p>{groupingError || "No se pudo calcular la agrupación operativa."}</p>
                <button type="button" onClick={retryGrouping}>Reintentar</button>
              </div>
            )}

            {groupingStatus === "empty" && (
              <div className="empty-state">
                No hay distritos que coincidan con los filtros seleccionados.
              </div>
            )}

            {groupingStatus === "success" && (
              <TerritoryGroupTable
                key={`${search}|${sortBy}|${pageSize}|${filters.criticidad}|${filters.epsOriginId}|${filters.zoneSize}|${filters.departamento}|${filters.provincia}|${filters.distrito}`}
                blocks={searchedBlocks}
                totalGroups={groupedZones.length}
                activeBlockId={activeBlockId}
                pageSize={pageSize}
                page={page}
                onPageChange={setPage}
                onOpenGroup={openGroupDetail}
              />
            )}
          </>
        ) : (
          <>
            <article className="territory-detail-header">
              <div>
                <span>Detalle del grupo operativo</span>
                <h2>{activeBlock?.nombre || "Grupo no disponible"}</h2>
                <p>
                  {activeBlock
                    ? `${activeBlock.cantidad_zonas} distritos · ${activeBlock.departments.length} departamentos`
                    : "Selecciona un grupo para revisar detalle."}
                </p>
              </div>
              <button type="button" onClick={closeGroupDetail}>
                Volver a grupos
              </button>
            </article>

            <div className="territory-main-grid workspace-map-layout">
              <TerritoryCoverageMap
                viewMode="nodos"
                blocks={activeBlock ? [activeBlock] : []}
                nodes={detailNodes}
                epsOrigins={epsOrigins}
                activeBlock={activeBlock}
                activeNode={activeNode}
                routePlan={null}
                routeResult={null}
                routeSegments={[]}
                routeKey=""
                routeStatus=""
                layers={layers}
                showLegend={showMapLegend}
                focusVersion={mapFocusVersion}
                mapControls={
                  <MapToolbar
                    expanded={mapExpanded}
                    legendVisible={showMapLegend}
                    onToggleExpanded={() => setMapExpanded((current) => !current)}
                    onToggleLegend={() => setShowMapLegend((current) => !current)}
                    onCenter={() => setMapFocusVersion((current) => current + 1)}
                    centerLabel="Centrar distritos del grupo"
                    centerBeforeLegend
                  />
                }
                onSelectBlock={selectBlock}
                onSelectNode={selectNode}
              />

              <div id="territory-side-panel" className="workspace-side-panel">
                <TerritoryGroupSidePanel
                  block={activeBlock}
                  node={activeNode}
                  onSelectNode={selectNode}
                  onOpenSectorization={openSectorization}
                />
              </div>
            </div>
          </>
        )}
      </section>
    </MainLayout>
  );
}
