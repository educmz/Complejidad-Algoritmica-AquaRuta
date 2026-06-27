import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import MainLayout from "../components/layout/MainLayout";
import DashboardMiniMap from "../components/dashboard/DashboardMiniMap";
import { aquaRutaData } from "../data/aquaRutaData";
import { fetchDashboard } from "../services/dashboardApi";

const priorityLabels = {
  critica: "CRÍTICA",
  alta: "ALTA",
  media: "MEDIA",
  baja: "BAJA",
};

const priorityOrder = {
  critica: 4,
  alta: 3,
  media: 2,
  baja: 1,
};

const numberFormatter = new Intl.NumberFormat("es-PE");
const compactFormatter = new Intl.NumberFormat("es-PE", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatNumber(value) {
  return numberFormatter.format(Math.round(Number(value) || 0));
}

function formatCompact(value) {
  return compactFormatter.format(Math.round(Number(value) || 0));
}

function formatHours(value) {
  const hours = Number(value) || 0;
  if (hours >= 24) return `${(hours / 24).toFixed(1)} d`;
  return `${hours.toFixed(1)} h`;
}

function formatDateTime(value) {
  if (!value) return "No disponible";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No disponible";

  return new Intl.DateTimeFormat("es-PE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function badgeClass(level) {
  if (level === "critica") return "badge critical";
  if (level === "alta") return "badge high";
  if (level === "media") return "badge medium";
  return "badge low";
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

function weightedAverage(districts, field) {
  const totalWeight = districts.reduce(
    (acc, district) => acc + (district.interrupciones || 0),
    0
  );

  if (!totalWeight) return 0;

  return (
    districts.reduce(
      (acc, district) =>
        acc + (Number(district[field]) || 0) * (district.interrupciones || 0),
      0
    ) / totalWeight
  );
}

function buildPath(path, params = {}) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value) searchParams.set(key, value);
  }

  const query = searchParams.toString();
  return query ? `${path}?${query}` : path;
}

function matchesOrigin(origin, district) {
  const originName = normalizeText(origin.prestador)
    .replace(/\bs\b/g, "")
    .replace(/\ba\b/g, "")
    .replace(/\beps\b/g, "")
    .trim();
  const districtEps = normalizeText(district.eps_principal);

  return Boolean(
    districtEps &&
      (originName.includes(districtEps) || districtEps.includes(originName))
  );
}

function districtRankScore(district, maxConnections) {
  const connectionWeight = maxConnections
    ? (district.conexiones_afectadas || 0) / maxConnections
    : 0;
  const demandWeight = Number(district.peso_demanda_familiar || 0);
  const priorityScore = Number(district.prioridad_score || 0);

  return (
    (district.interrupciones || 0) * 0.7 +
    connectionWeight * 1000 +
    demandWeight * 900 +
    priorityScore * 700 +
    (priorityOrder[district.criticidad] || 0) * 150
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const sourceDistricts = useMemo(() => aquaRutaData.districts || [], []);
  const sourceGroupedZones = useMemo(() => aquaRutaData.groupedZones || [], []);
  const sourceEpsOrigins = useMemo(() => aquaRutaData.epsOrigins || [], []);
  const fallbackDashboardData = useMemo(
    () => ({
      metadata: aquaRutaData.metadata || {},
      districts: sourceDistricts,
      groupedZones: sourceGroupedZones,
      epsOrigins: sourceEpsOrigins,
      operationalRoutes: aquaRutaData.operationalRoutes || {},
    }),
    [sourceDistricts, sourceEpsOrigins, sourceGroupedZones]
  );
  const [dashboardData, setDashboardData] = useState(fallbackDashboardData);
  const [dashboardStatus, setDashboardStatus] = useState("idle");
  const [dashboardError, setDashboardError] = useState("");
  const [dashboardRetryToken, setDashboardRetryToken] = useState(0);

  const [epsFilter, setEpsFilter] = useState("todos");
  const [departmentFilter, setDepartmentFilter] = useState("todos");
  const [provinceFilter, setProvinceFilter] = useState("todos");
  const [districtFilter, setDistrictFilter] = useState("todos");
  const [groupFilter, setGroupFilter] = useState("todos");

  const dashboardFilters = useMemo(
    () => ({
      eps: epsFilter,
      departamento: departmentFilter,
      provincia: provinceFilter,
      distrito: districtFilter,
      grupo: groupFilter,
    }),
    [departmentFilter, districtFilter, epsFilter, groupFilter, provinceFilter]
  );

  useEffect(() => {
    const controller = new AbortController();
    const loadingTimer = window.setTimeout(() => {
      setDashboardStatus("loading");
      setDashboardError("");
    }, 0);

    fetchDashboard(dashboardFilters, { signal: controller.signal })
      .then((payload) => {
        setDashboardData({
          metadata: payload.metadata || {},
          districts: payload.districts || [],
          groupedZones: payload.groupedZones || [],
          epsOrigins: payload.epsOrigins || [],
          operationalRoutes: payload.operationalRoutes || {},
        });
        setDashboardStatus((payload.districts || []).length ? "success" : "empty");
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        setDashboardData(fallbackDashboardData);
        setDashboardStatus("error");
        setDashboardError(error?.message || "No se pudieron cargar los indicadores del dashboard.");
      });

    return () => {
      window.clearTimeout(loadingTimer);
      controller.abort();
    };
  }, [dashboardFilters, dashboardRetryToken, fallbackDashboardData]);

  const metadata = dashboardData.metadata || {};
  const allDistricts = useMemo(() => dashboardData.districts || [], [dashboardData]);
  const groupedZones = useMemo(() => dashboardData.groupedZones || [], [dashboardData]);
  const epsOrigins = useMemo(() => dashboardData.epsOrigins || [], [dashboardData]);
  const operationalRoutes = useMemo(() => dashboardData.operationalRoutes || {}, [dashboardData]);

  const districtMap = useMemo(
    () => new Map(allDistricts.map((district) => [district.id, district])),
    [allDistricts]
  );

  const groupMap = useMemo(
    () => new Map(sourceGroupedZones.map((group) => [group.id, group])),
    [sourceGroupedZones]
  );

  const selectedGroup = groupFilter === "todos" ? null : groupMap.get(groupFilter);

  const epsOptions = useMemo(() => {
    return [...new Set(sourceDistricts.map((item) => item.eps_principal).filter(Boolean))].sort();
  }, [sourceDistricts]);

  const departmentOptions = useMemo(() => {
    return [...new Set(sourceDistricts.map((item) => item.departamento).filter(Boolean))].sort();
  }, [sourceDistricts]);

  const provinceOptions = useMemo(() => {
    return [
      ...new Set(
        sourceDistricts
          .filter(
            (item) =>
              departmentFilter === "todos" || item.departamento === departmentFilter
          )
          .map((item) => item.provincia)
          .filter(Boolean)
      ),
    ].sort();
  }, [departmentFilter, sourceDistricts]);

  const districtOptions = useMemo(() => {
    return sourceDistricts
      .filter((item) => departmentFilter === "todos" || item.departamento === departmentFilter)
      .filter((item) => provinceFilter === "todos" || item.provincia === provinceFilter)
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [departmentFilter, provinceFilter, sourceDistricts]);

  useEffect(() => {
    if (provinceFilter !== "todos" && !provinceOptions.includes(provinceFilter)) {
      const timer = window.setTimeout(() => {
        setProvinceFilter("todos");
        setDistrictFilter("todos");
      }, 0);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [provinceFilter, provinceOptions]);

  useEffect(() => {
    if (districtFilter !== "todos" && !districtOptions.some((district) => district.id === districtFilter)) {
      const timer = window.setTimeout(() => {
        setDistrictFilter("todos");
      }, 0);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [districtFilter, districtOptions]);

  const selectedGroupIds = useMemo(
    () => new Set(selectedGroup?.zona_ids || []),
    [selectedGroup]
  );

  const filteredDistricts = useMemo(() => {
    return allDistricts
      .filter((district) => {
        if (selectedGroup && !selectedGroupIds.has(district.id)) return false;
        if (epsFilter !== "todos" && district.eps_principal !== epsFilter) return false;
        if (departmentFilter !== "todos" && district.departamento !== departmentFilter) {
          return false;
        }
        if (provinceFilter !== "todos" && district.provincia !== provinceFilter) return false;
        if (districtFilter !== "todos" && district.id !== districtFilter) return false;
        return true;
      })
      .sort((a, b) => (b.interrupciones || 0) - (a.interrupciones || 0));
  }, [
    allDistricts,
    departmentFilter,
    districtFilter,
    epsFilter,
    provinceFilter,
    selectedGroup,
    selectedGroupIds,
  ]);

  const filteredIds = useMemo(
    () => new Set(filteredDistricts.map((district) => district.id)),
    [filteredDistricts]
  );

  const visibleGroups = useMemo(() => {
    return groupedZones
      .map((group) => {
        const groupDistricts = (group.zona_ids || [])
          .map((id) => districtMap.get(id))
          .filter((district) => district && filteredIds.has(district.id));

        const interruptions = groupDistricts.reduce(
          (acc, district) => acc + (district.interrupciones || 0),
          0
        );
        const connections = groupDistricts.reduce(
          (acc, district) => acc + (district.conexiones_afectadas || 0),
          0
        );
        const trucks = groupDistricts.reduce(
          (acc, district) => acc + (district.camiones_puntos || 0),
          0
        );

        return {
          ...group,
          visibleDistricts: groupDistricts,
          visibleZones: groupDistricts.length,
          visibleInterruptions: interruptions,
          visibleConnections: connections,
          visibleTrucks: trucks,
          averageDuration: weightedAverage(groupDistricts, "duracion_promedio_horas"),
          maxDuration: Math.max(
            0,
            ...groupDistricts.map((district) => district.duracion_maxima_horas || 0)
          ),
        };
      })
      .filter((group) => group.visibleZones > 0)
      .sort((a, b) => b.visibleInterruptions - a.visibleInterruptions);
  }, [districtMap, filteredIds, groupedZones]);

  const maxConnections = useMemo(
    () =>
      Math.max(
        0,
        ...filteredDistricts.map((district) => district.conexiones_afectadas || 0)
      ),
    [filteredDistricts]
  );

  const rankedDistricts = useMemo(() => {
    return [...filteredDistricts]
      .sort((a, b) => districtRankScore(b, maxConnections) - districtRankScore(a, maxConnections))
      .slice(0, 10);
  }, [filteredDistricts, maxConnections]);

  const criticalDistricts = useMemo(
    () => filteredDistricts.filter((district) => district.criticidad === "critica"),
    [filteredDistricts]
  );
  const highPriorityDistricts = useMemo(
    () =>
      filteredDistricts.filter(
        (district) => district.criticidad === "critica" || district.criticidad === "alta"
      ),
    [filteredDistricts]
  );

  const totalInterruptions = filteredDistricts.reduce(
    (acc, item) => acc + (item.interrupciones || 0),
    0
  );
  const totalConnections = filteredDistricts.reduce(
    (acc, item) => acc + (item.conexiones_afectadas || 0),
    0
  );
  const totalEstimatedPeople = filteredDistricts.reduce(
    (acc, item) => acc + (item.personas_afectadas_estimadas || 0),
    0
  );
  const totalTrucks = filteredDistricts.reduce(
    (acc, item) => acc + (item.camiones_puntos || 0),
    0
  );
  const assignedTrucks = highPriorityDistricts.reduce(
    (acc, item) => acc + (item.camiones_puntos || 0),
    0
  );
  const availableTrucks = Math.max(0, totalTrucks - assignedTrucks);
  const dailyCapacity = totalTrucks * 20;
  const averageDuration = weightedAverage(filteredDistricts, "duracion_promedio_horas");
  const maxDuration = Math.max(
    0,
    ...filteredDistricts.map((district) => district.duracion_maxima_horas || 0)
  );

  const routeDistrictIds = useMemo(() => {
    const ids = new Set();

    for (const scenario of Object.values(operationalRoutes)) {
      for (const district of scenario?.dfs?.order || []) ids.add(district.id);
      for (const district of scenario?.bfs?.order || []) ids.add(district.id);
      for (const district of scenario?.backtracking?.best_order || []) ids.add(district.id);
    }

    return ids;
  }, [operationalRoutes]);

  const originCoverage = useMemo(() => {
    return epsOrigins
      .map((origin) => {
        const coverageDistricts = filteredDistricts.filter((district) => {
          const sameDepartment = district.departamento === origin.departamento;
          const sameProvince = district.provincia === origin.provincia;
          return matchesOrigin(origin, district) || (sameDepartment && sameProvince);
        });

        const coveredGroups = visibleGroups.filter((group) =>
          group.visibleDistricts.some((district) => coverageDistricts.includes(district))
        );

        return {
          ...origin,
          coverageDistricts,
          coveredGroups,
          criticalCoverage: coverageDistricts.filter(
            (district) => district.criticidad === "critica"
          ).length,
          interruptions: coverageDistricts.reduce(
            (acc, district) => acc + (district.interrupciones || 0),
            0
          ),
        };
      })
      .filter((origin) => origin.coverageDistricts.length > 0)
      .sort(
        (a, b) =>
          b.criticalCoverage - a.criticalCoverage ||
          b.interruptions - a.interruptions ||
          b.coverageDistricts.length - a.coverageDistricts.length
      )
      .slice(0, 8);
  }, [epsOrigins, filteredDistricts, visibleGroups]);

  const alerts = useMemo(() => {
    const nearestOriginForDistrict = (district) => {
      return epsOrigins
        .map((origin) => ({
          origin,
          distance: distanceKm(district.center, origin),
        }))
        .sort((a, b) => a.distance - b.distance)[0];
    };

    const noNearbyOrigin = criticalDistricts
      .map((district) => ({
        district,
        nearest: nearestOriginForDistrict(district),
      }))
      .filter((item) => !Number.isFinite(item.nearest?.distance) || item.nearest.distance > 35);

    const saturatedGroup = visibleGroups.find(
      (group) =>
        group.criticidad === "critica" ||
        group.visibleInterruptions / Math.max(1, group.visibleZones) > 450
    );

    const districtWithoutRoute = highPriorityDistricts.find(
      (district) => !routeDistrictIds.has(district.id)
    );

    const insufficientNodesDistrict = highPriorityDistricts.find(
      (district) => (district.camiones_puntos || 0) <= 5
    );

    const items = [];

    if (noNearbyOrigin[0]) {
      items.push({
        id: "sin-nodo-cercano",
        level: "critica",
        title: "Zona crítica sin EPS cercana",
        body: `${noNearbyOrigin[0].district.nombre} requiere validar una EPS de referencia más próxima antes de planificar atención.`,
        meta: noNearbyOrigin[0].nearest
          ? `${noNearbyOrigin[0].nearest.distance.toFixed(1)} km a la EPS de referencia`
          : "Sin EPS de referencia",
        path: buildPath("/mapa", {
          modo: "ruta",
          distrito: noNearbyOrigin[0].district.id,
        }),
      });
    }

    if (saturatedGroup) {
      items.push({
        id: "grupo-saturado",
        level: saturatedGroup.criticidad,
        title: "Grupo operativo saturado",
        body: `${saturatedGroup.nombre} acumula ${formatNumber(
          saturatedGroup.visibleInterruptions
        )} interrupciones en ${saturatedGroup.visibleZones} zonas.`,
        meta: "Abrir sectorización",
        path: buildPath("/sectorizacion", { grupo: saturatedGroup.id }),
      });
    }

    if (districtWithoutRoute) {
      items.push({
        id: "sin-ruta-priorizada",
        level: "alta",
        title: "Zona sin recorrido priorizado",
        body: `${districtWithoutRoute.nombre} aún no cuenta con una secuencia de atención priorizada. Revisa su exploración local.`,
        meta: "Abrir exploración local",
        path: buildPath("/exploracion-local", { distrito: districtWithoutRoute.id }),
      });
    }

    if (insufficientNodesDistrict) {
      items.push({
        id: "nodos-insuficientes",
        level: "media",
        title: "Nodos o camiones insuficientes",
        body: `${insufficientNodesDistrict.nombre} tiene ${formatNumber(
          insufficientNodesDistrict.camiones_puntos || 0
        )} recursos operativos registrados.`,
        meta: "Abrir mapa operativo",
        path: buildPath("/mapa", {
          modo: "ruta",
          distrito: insufficientNodesDistrict.id,
        }),
      });
    }

    if (!items.length) {
      items.push({
        id: "sin-alertas",
        level: "baja",
        title: "Operación dentro de parámetros",
        body: "No se detectan alertas críticas para los filtros activos.",
        meta: "Ver grupos operativos",
        path: "/agrupacion",
      });
    }

    return items;
  }, [
    criticalDistricts,
    epsOrigins,
    highPriorityDistricts,
    routeDistrictIds,
    visibleGroups,
  ]);

  const kpis = [
    {
      label: "Distritos afectados",
      value: formatNumber(filteredDistricts.length),
      helper: `${formatNumber(criticalDistricts.length)} críticos`,
      description: "Zonas con interrupciones registradas en el periodo analizado.",
      tone: "blue",
      path: buildPath("/mapa", { modo: "ruta", distrito: rankedDistricts[0]?.id }),
    },
    {
      label: "Distritos críticos",
      value: formatNumber(criticalDistricts.length),
      helper: `${formatNumber(highPriorityDistricts.length)} en prioridad alta o crítica`,
      description:
        "Zonas con mayor impacto por interrupciones, conexiones afectadas o duración.",
      tone: "red",
      path: buildPath("/mapa", { modo: "ruta", distrito: criticalDistricts[0]?.id }),
    },
    {
      label: "Interrupciones totales",
      value: formatNumber(totalInterruptions),
      helper: `Prom. ${formatHours(averageDuration)} por evento`,
      description: "Eventos de interrupción acumulados para los filtros seleccionados.",
      tone: "amber",
      path: buildPath("/mapa", { modo: "ruta" }),
    },
    {
      label: "Personas afectadas estimadas",
      value: formatCompact(totalEstimatedPeople),
      helper: `${formatNumber(totalEstimatedPeople)} personas estimadas`,
      description: "EstimaciÃ³n con conexiones afectadas y promedio de integrantes por hogar.",
      tone: "teal",
      path: "/agrupacion",
    },
    {
      label: "Conexiones afectadas",
      value: formatCompact(totalConnections),
      helper: `${formatNumber(totalConnections)} registros acumulados`,
      description: "Conexiones registradas dentro de las zonas afectadas.",
      tone: "blue",
      path: "/agrupacion",
    },
    {
      label: "Grupos operativos",
      value: formatNumber(visibleGroups.length),
      helper: `${formatNumber(groupedZones.length)} grupos generados`,
      description: "Conjuntos de zonas que pueden analizarse juntas para planificar atención.",
      tone: "green",
      path: "/agrupacion",
    },
  ];

  function openDistrict(district) {
    navigate(buildPath("/mapa", { modo: "ruta", distrito: district.id }));
  }

  function openGroup(group, target = "sectorizacion") {
    if (target === "mapa") {
      navigate(buildPath("/mapa", { modo: "recorrido", grupo: group.id }));
      return;
    }

    navigate(buildPath("/sectorizacion", { grupo: group.id }));
  }

  function openOrigin(origin) {
    navigate(buildPath("/mapa", { modo: "ruta", origen: origin.id }));
  }

  return (
    <MainLayout>
      <section className="page-section dashboard-page">
        <article className="dashboard-hero">
          <div>
            <h2 className="dashboard-title">Dashboard operativo</h2>
            <p className="dashboard-subtitle">
              Vista de control para priorizar zonas afectadas, grupos operativos, nodos de
              abastecimiento y rutas de atención logística.
            </p>
          </div>

          <div className="dashboard-context-panel">
            <span className="dashboard-context-label">Última actualización</span>
            <strong>
              {formatDateTime(metadata.ultima_actualizacion || metadata.processed_at)}
            </strong>
          </div>
        </article>

        <article className="panel dashboard-filter-panel">
          <div className="dashboard-panel-heading">
            <div>
              <h3 className="panel-title">Filtros rápidos</h3>
              <p className="panel-subtitle">
                EPS, territorio y grupo operativo.
              </p>
            </div>
            <button
              type="button"
              className="dashboard-soft-button"
              onClick={() => navigate("/agrupacion")}
            >
              Ver grupos operativos
            </button>
          </div>

          <div className="dashboard-filter-grid">
            <label className="control-group">
              <span className="control-label">EPS</span>
              <select
                className="control-select"
                value={epsFilter}
                onChange={(event) => setEpsFilter(event.target.value)}
              >
                <option value="todos">Todas</option>
                {epsOptions.map((eps) => (
                  <option key={eps} value={eps}>
                    {eps}
                  </option>
                ))}
              </select>
            </label>

            <label className="control-group">
              <span className="control-label">Departamento</span>
              <select
                className="control-select"
                value={departmentFilter}
                onChange={(event) => {
                  setDepartmentFilter(event.target.value);
                  setProvinceFilter("todos");
                  setDistrictFilter("todos");
                }}
              >
                <option value="todos">Todos</option>
                {departmentOptions.map((department) => (
                  <option key={department} value={department}>
                    {department}
                  </option>
                ))}
              </select>
            </label>

            <label className="control-group">
              <span className="control-label">Provincia</span>
              <select
                className="control-select"
                value={provinceFilter}
                onChange={(event) => {
                  setProvinceFilter(event.target.value);
                  setDistrictFilter("todos");
                }}
              >
                <option value="todos">Todas</option>
                {provinceOptions.map((province) => (
                  <option key={province} value={province}>
                    {province}
                  </option>
                ))}
              </select>
            </label>

            <label className="control-group">
              <span className="control-label">Distrito</span>
              <select
                className="control-select"
                value={districtFilter}
                onChange={(event) => setDistrictFilter(event.target.value)}
              >
                <option value="todos">Todos</option>
                {districtOptions.map((district) => (
                  <option key={district.id} value={district.id}>
                    {district.nombre}
                  </option>
                ))}
              </select>
            </label>

            <label className="control-group">
              <span className="control-label">Grupo operativo</span>
              <select
                className="control-select"
                value={groupFilter}
                onChange={(event) => setGroupFilter(event.target.value)}
              >
                <option value="todos">Todos</option>
                {sourceGroupedZones.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.nombre}
                  </option>
                ))}
              </select>
            </label>

          </div>
          {dashboardStatus === "loading" && (
            <div className="local-route-status">Cargando indicadores del dashboard...</div>
          )}
          {dashboardStatus === "empty" && (
            <div className="local-route-status">
              No hay datos disponibles para los filtros seleccionados.
            </div>
          )}
          {dashboardStatus === "error" && (
            <div className="local-route-status error">
              <span>{dashboardError}</span>
              <button type="button" onClick={() => setDashboardRetryToken((current) => current + 1)}>
                Reintentar
              </button>
            </div>
          )}
        </article>

        <section className="dashboard-kpi-grid">
          {kpis.map((item) => (
            <button
              type="button"
              key={item.label}
              className={`dashboard-kpi-card ${item.tone}`}
              onClick={() => navigate(item.path)}
            >
              <span className="dashboard-kpi-label">{item.label}</span>
              <strong>{item.value}</strong>
              <span>{item.helper}</span>
              <small>{item.description}</small>
            </button>
          ))}
        </section>

        <section className="dashboard-main-grid">
          <article className="panel dashboard-ranking-panel">
            <div className="dashboard-panel-heading">
              <div>
                <h3 className="panel-title">Distritos críticos</h3>
                <p className="panel-subtitle">
                  Ranking por interrupciones, conexiones afectadas y duración.
                </p>
              </div>
              <span className="dashboard-pill">{formatHours(maxDuration)} max.</span>
            </div>

            <div className="dashboard-ranking-list">
              {rankedDistricts.map((district, index) => (
                <button
                  type="button"
                  className="dashboard-rank-row"
                  key={district.id}
                  onClick={() => openDistrict(district)}
                >
                  <span className="dashboard-rank-number">{index + 1}</span>
                  <span className="dashboard-rank-content">
                    <strong>{district.nombre}</strong>
                    <span>
                      {district.provincia}, {district.departamento} -{" "}
                      {formatNumber(district.interrupciones)} interrupciones -{" "}
                      {formatCompact(district.conexiones_afectadas)} conexiones registradas
                    </span>
                  </span>
                  <span className="dashboard-rank-metrics">
                    <span className={badgeClass(district.criticidad)}>
                      {priorityLabels[district.criticidad] || "BAJA"}
                    </span>
                    <small>
                      Prom. {formatHours(district.duracion_promedio_horas)} / Max.{" "}
                      {formatHours(district.duracion_maxima_horas)}
                    </small>
                  </span>
                </button>
              ))}

              {!rankedDistricts.length && (
                <div className="empty-state">
                  No hay resultados para los filtros seleccionados.
                </div>
              )}
            </div>
          </article>

          <article className="panel dashboard-alert-panel">
            <div className="dashboard-panel-heading">
              <div>
                <h3 className="panel-title">Alertas operativas</h3>
                <p className="panel-subtitle">
                  Situaciones que requieren revisión antes de planificar rutas o sectores.
                </p>
              </div>
            </div>

            <div className="dashboard-alert-list">
              {alerts.map((alert) => (
                <button
                  type="button"
                  key={alert.id}
                  className={`dashboard-alert-card ${alert.level}`}
                  onClick={() => navigate(alert.path)}
                >
                  <span className="dashboard-alert-level">
                    {priorityLabels[alert.level] || "INFO"}
                  </span>
                  <strong>{alert.title}</strong>
                  <span>{alert.body}</span>
                  <small>{alert.meta}</small>
                </button>
              ))}
            </div>
          </article>
        </section>

        <section className="dashboard-map-grid">
          <article className="panel dashboard-map-panel">
            <div className="dashboard-panel-heading">
              <div>
                <h3 className="panel-title">Mini-mapa operativo</h3>
                <p className="panel-subtitle">
                  Distritos con código de color por prioridad operativa.
                </p>
              </div>
              <button
                type="button"
                className="dashboard-soft-button"
                onClick={() =>
                  navigate(buildPath("/mapa", { modo: "ruta", distrito: rankedDistricts[0]?.id }))
                }
              >
                Ver mapa operativo
              </button>
            </div>

            <DashboardMiniMap districts={rankedDistricts} onDistrictClick={openDistrict} />

            <div className="dashboard-map-legend">
              <span className="critical">Crítica</span>
              <span className="high">Alta</span>
              <span className="medium">Media</span>
              <span className="low">Baja</span>
            </div>
          </article>

          <div className="dashboard-side-stack">
            <article className="panel">
              <div className="dashboard-panel-heading">
                <div>
                  <h3 className="panel-title">Indicadores logísticos</h3>
                  <p className="panel-subtitle">
                    Capacidad operativa referencial según registros disponibles.
                  </p>
                </div>
              </div>

              <div className="dashboard-logistics-grid">
                <div>
                  <span>Recursos operativos disponibles</span>
                  <strong>{formatNumber(availableTrucks)}</strong>
                </div>
                <div>
                  <span>Asignados a alta prioridad</span>
                  <strong>{formatNumber(assignedTrucks)}</strong>
                </div>
                <div>
                  <span>Capacidad diaria</span>
                  <strong>{formatNumber(dailyCapacity)} m³</strong>
                </div>
                <div>
                  <span>Cobertura potencial</span>
                  <strong>{formatCompact(totalConnections)}</strong>
                </div>
              </div>
            </article>

            <article className="panel">
              <div className="dashboard-panel-heading">
                <div>
                  <h3 className="panel-title">EPS de referencia</h3>
                  <p className="panel-subtitle">
                    Orígenes disponibles como referencia para planificar atención.
                  </p>
                </div>
              </div>

              <div className="dashboard-origin-list">
                {originCoverage.map((origin) => (
                  <button
                    type="button"
                    key={origin.id}
                    className="dashboard-origin-card"
                    onClick={() => openOrigin(origin)}
                  >
                    <strong>{origin.prestador}</strong>
                    <span>
                      {origin.distrito}, {origin.provincia} -{" "}
                      {formatNumber(origin.coverageDistricts.length)} distritos
                    </span>
                    <small>
                      {formatNumber(origin.criticalCoverage)} críticos -{" "}
                      {formatNumber(origin.coveredGroups.length)} grupos
                    </small>
                  </button>
                ))}

                {!originCoverage.length && (
                  <div className="empty-state">
                    No hay EPS de referencia para los filtros seleccionados.
                  </div>
                )}
              </div>
            </article>
          </div>
        </section>

        <article className="panel">
          <div className="dashboard-panel-heading">
            <div>
              <h3 className="panel-title">Grupos operativos</h3>
              <p className="panel-subtitle">
                Zonas afectadas, cobertura distrital, interrupciones acumuladas y rutas asociadas.
              </p>
            </div>
            <button
              type="button"
              className="dashboard-soft-button"
              onClick={() => navigate("/sectorizacion")}
            >
              Ver sectorización
            </button>
          </div>

          <div className="dashboard-group-grid">
            {visibleGroups.slice(0, 8).map((group) => (
              <article className="dashboard-group-card" key={group.id}>
                <div className="dashboard-group-topline">
                  <span className={badgeClass(group.criticidad)}>
                    {priorityLabels[group.criticidad] || "BAJA"}
                  </span>
                  <small>{formatNumber(group.visibleZones)} zonas</small>
                </div>

                <h4>{group.nombre}</h4>
                <p>
                  {group.visibleDistricts
                    .slice(0, 4)
                    .map((district) => district.nombre)
                    .join(", ")}
                  {group.visibleDistricts.length > 4 ? "..." : ""}
                </p>

                <div className="dashboard-group-metrics">
                  <span>
                    <strong>{formatNumber(group.visibleInterruptions)}</strong>
                    interrupciones
                  </span>
                  <span>
                    <strong>{formatCompact(group.visibleConnections)}</strong>
                    registros acumulados
                  </span>
                  <span>
                    <strong>{formatNumber(group.visibleTrucks)}</strong>
                    recursos operativos
                  </span>
                  <span>
                    <strong>{formatHours(group.maxDuration)}</strong>
                    max.
                  </span>
                </div>

                <div className="dashboard-group-actions">
                  <button type="button" onClick={() => openGroup(group)}>
                    Sectorizar
                  </button>
                  <button type="button" onClick={() => openGroup(group, "mapa")}>
                    Ver rutas
                  </button>
                </div>
              </article>
            ))}
          </div>
        </article>
      </section>
    </MainLayout>
  );
}
