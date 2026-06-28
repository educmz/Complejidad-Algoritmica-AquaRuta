import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import MainLayout from "../components/layout/MainLayout";
import DashboardMiniMap from "../components/dashboard/DashboardMiniMap";
import { aquaRutaData } from "../data/aquaRutaData";
import {
  buildDashboardOptions,
  buildDashboardPath,
  dashboardFiltersFromSearch,
  dashboardFiltersToSearch,
  emptyDashboardFilters,
  filterDashboardDistricts,
  getDashboardMapDistricts,
  normalizeDashboardFilters,
  sanitizeDashboardFilters,
} from "../utils/dashboardFilters";
import {
  buildDashboardGeoAudit,
  buildRelatedEpsContext,
  buildSelectedEpsContext,
  repairText,
} from "../utils/dashboardGeo";

const STORAGE_KEY = "aquaruta.dashboard.filters.v1";
const GROUP_SECTOR_THRESHOLD = 8;

const priorityLabels = {
  critica: "CRITICA",
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

function isActive(value) {
  return Boolean(value && value !== "todos");
}

function formatNumber(value) {
  return numberFormatter.format(Math.round(Number(value) || 0));
}

function formatCompact(value) {
  const numeric = Number(value) || 0;
  if (Math.abs(numeric) < 1000000) return formatNumber(numeric);
  return compactFormatter.format(Math.round(numeric));
}

function formatHours(value) {
  const hours = Number(value) || 0;
  if (hours >= 24) return `${(hours / 24).toFixed(1)} dias`;
  return `${hours.toFixed(1)} horas`;
}

function formatDateOnly(value) {
  if (!value) return "No disponible";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No disponible";
  return new Intl.DateTimeFormat("es-PE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
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

function districtRankScore(district, maxConnections) {
  const connectionWeight = maxConnections
    ? (district.conexiones_afectadas || 0) / maxConnections
    : 0;
  return (
    (district.interrupciones || 0) * 0.7 +
    connectionWeight * 1000 +
    Number(district.peso_demanda_familiar || 0) * 900 +
    Number(district.prioridad_score || 0) * 700 +
    (priorityOrder[district.criticidad] || 0) * 150
  );
}

function loadStoredFilters(searchParams) {
  const fromUrl = dashboardFiltersFromSearch(searchParams);
  if (dashboardFiltersToSearch(fromUrl).toString()) return fromUrl;
  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    return stored ? normalizeDashboardFilters(JSON.parse(stored)) : emptyDashboardFilters();
  } catch {
    return emptyDashboardFilters();
  }
}

export default function DashboardOperativo() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const metadata = useMemo(() => aquaRutaData.metadata || {}, []);
  const allDistricts = useMemo(() => aquaRutaData.districts || [], []);
  const groupedZones = useMemo(() => aquaRutaData.groupedZones || [], []);
  const epsOrigins = useMemo(() => aquaRutaData.epsOrigins || [], []);
  const operationalRoutes = useMemo(() => aquaRutaData.operationalRoutes || {}, []);
  const [filters, setFilters] = useState(() =>
    sanitizeDashboardFilters(allDistricts, groupedZones, loadStoredFilters(searchParams))
  );

  const districtMap = useMemo(
    () => new Map(allDistricts.map((district) => [district.id, district])),
    [allDistricts]
  );
  const groupMap = useMemo(
    () => new Map(groupedZones.map((group) => [group.id, group])),
    [groupedZones]
  );
  const options = useMemo(
    () => buildDashboardOptions(allDistricts, groupedZones, filters),
    [allDistricts, groupedZones, filters]
  );

  function commitFilters(nextFilters) {
    const sanitized = sanitizeDashboardFilters(allDistricts, groupedZones, nextFilters);
    setFilters(sanitized);
    setSearchParams(dashboardFiltersToSearch(sanitized), { replace: true });
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
    } catch {
      // URL params keep the same context even when sessionStorage is unavailable.
    }
  }

  function updateFilter(key, value) {
    const next = { ...filters, [key]: value };
    if (key === "eps") next.grupo = "todos";
    if (key === "departamento") {
      next.provincia = "todos";
      next.distrito = "todos";
      next.grupo = "todos";
    }
    if (key === "provincia") {
      next.distrito = "todos";
      next.grupo = "todos";
    }
    if (key === "distrito") next.grupo = "todos";
    commitFilters(next);
  }

  function clearFilters() {
    const empty = emptyDashboardFilters();
    setFilters(empty);
    setSearchParams({}, { replace: true });
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // no-op
    }
  }

  const selectedGroup = isActive(filters.grupo) ? groupMap.get(filters.grupo) : null;
  const selectedDistrict = isActive(filters.distrito) ? districtMap.get(filters.distrito) : null;
  const filteredDistricts = useMemo(
    () =>
      filterDashboardDistricts(allDistricts, groupedZones, filters).sort(
        (a, b) => (b.interrupciones || 0) - (a.interrupciones || 0)
      ),
    [allDistricts, groupedZones, filters]
  );
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
        const visibleInterruptions = groupDistricts.reduce(
          (acc, district) => acc + (district.interrupciones || 0),
          0
        );
        const visibleConnections = groupDistricts.reduce(
          (acc, district) => acc + (district.conexiones_afectadas || 0),
          0
        );
        const visibleEstimatedPeople = groupDistricts.reduce(
          (acc, district) => acc + (district.personas_afectadas_estimadas || 0),
          0
        );
        const visibleCriticalCount = groupDistricts.filter(
          (district) => district.criticidad === "critica"
        ).length;
        return {
          ...group,
          visibleDistricts: groupDistricts,
          visibleZones: groupDistricts.length,
          visibleInterruptions,
          visibleConnections,
          visibleEstimatedPeople,
          visibleCriticalCount,
          maxDuration: Math.max(
            0,
            ...groupDistricts.map((district) => district.duracion_maxima_horas || 0)
          ),
        };
      })
      .filter((group) => group.visibleZones > 0)
      .sort(
        (a, b) =>
          b.visibleCriticalCount - a.visibleCriticalCount ||
          b.visibleConnections - a.visibleConnections ||
          b.visibleInterruptions - a.visibleInterruptions
      );
  }, [districtMap, filteredIds, groupedZones]);

  const maxConnections = useMemo(
    () =>
      Math.max(
        0,
        ...filteredDistricts.map((district) => district.conexiones_afectadas || 0)
      ),
    [filteredDistricts]
  );
  const rankedDistricts = useMemo(
    () =>
      [...filteredDistricts]
        .sort((a, b) => districtRankScore(b, maxConnections) - districtRankScore(a, maxConnections))
        .slice(0, 10),
    [filteredDistricts, maxConnections]
  );
  const criticalDistricts = filteredDistricts.filter(
    (district) => district.criticidad === "critica"
  );
  const highPriorityDistricts = filteredDistricts.filter(
    (district) => district.criticidad === "critica" || district.criticidad === "alta"
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
  const averageDuration = weightedAverage(filteredDistricts, "duracion_promedio_horas");
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
    return buildRelatedEpsContext({ filteredDistricts, epsOrigins });
  }, [epsOrigins, filteredDistricts]);

  const selectedEpsContext = useMemo(
    () =>
      buildSelectedEpsContext({
        selectedEps: filters.eps,
        filteredDistricts,
        epsOrigins,
      }),
    [epsOrigins, filteredDistricts, filters.eps]
  );
  const selectedMapOriginsWithCoordinates = selectedEpsContext.mapOrigins;
  const selectedEpsWithoutCoordinates =
    isActive(filters.eps) && selectedEpsContext.missingReference;
  const [mapResetKey, setMapResetKey] = useState(0);
  const geoAudit = useMemo(() => buildDashboardGeoAudit(filteredDistricts), [filteredDistricts]);

  const selectedDistrictGroup = useMemo(() => {
    if (!selectedDistrict) return null;
    return groupedZones.find((group) => (group.zona_ids || []).includes(selectedDistrict.id));
  }, [groupedZones, selectedDistrict]);

  const alerts = useMemo(() => {
    const nearestOriginForDistrict = (district) => {
      return epsOrigins
        .map((origin) => ({ origin, distance: distanceKm(district.center, origin) }))
        .sort((a, b) => a.distance - b.distance)[0];
    };
    const items = [];
    const oversizedGroup = visibleGroups.find(
      (group) => group.visibleZones > GROUP_SECTOR_THRESHOLD
    );
    const noNearbyOrigin = criticalDistricts
      .map((district) => ({ district, nearest: nearestOriginForDistrict(district) }))
      .filter((item) => !Number.isFinite(item.nearest?.distance) || item.nearest.distance > 35)[0];
    const routeGap = highPriorityDistricts.find((district) => !routeDistrictIds.has(district.id));
    const missingCenter = geoAudit.withoutCoordinates;

    if (oversizedGroup) {
      items.push({
        id: "grupo-requiere-sectorizacion",
        level: oversizedGroup.criticidad || "alta",
        title: "Grupo operativo supera el tamano recomendado",
        body: `${oversizedGroup.nombre} contiene ${formatNumber(
          oversizedGroup.visibleZones
        )} distritos del contexto y debe revisarse en Sectorizacion.`,
        action: "Sectorizar grupo",
        path: buildDashboardPath("/sectorizacion", filters, { grupo: oversizedGroup.id }),
      });
    }
    if (noNearbyOrigin) {
      items.push({
        id: "eps-lejana",
        level: "critica",
        title: "Distrito critico sin EPS cercana",
        body: `${repairText(
          noNearbyOrigin.district.nombre
        )} requiere validar una EPS de referencia antes de planificar atencion.`,
        action: "Ver en mapa operativo",
        path: buildDashboardPath("/mapa", filters, {
          modo: "ruta",
          distrito: noNearbyOrigin.district.id,
        }),
      });
    }
    if (routeGap) {
      items.push({
        id: "ruta-logica-pendiente",
        level: "alta",
        title: "Distrito prioritario sin recorrido precalculado",
        body: `${repairText(
          routeGap.nombre
        )} aparece como prioridad alta o critica, pero no figura en recorridos precalculados.`,
        action: "Explorar conectividad",
        path: buildDashboardPath("/exploracion-local", filters, { distrito: routeGap.id }),
      });
    }
    if (missingCenter) {
      items.push({
        id: "coordenadas-incompletas",
        level: "media",
        title: "Datos geograficos incompletos",
        body: `${formatNumber(
          missingCenter
        )} distritos no pudieron representarse en el mapa.`,
        action: "Ver distritos",
        path: buildDashboardPath("/mapa", filters),
      });
    }
    return items;
  }, [
    criticalDistricts,
    epsOrigins,
    filters,
    geoAudit,
    highPriorityDistricts,
    routeDistrictIds,
    visibleGroups,
  ]);

  const contextLabel = useMemo(() => {
    const parts = [];
    if (isActive(filters.eps)) parts.push(filters.eps);
    if (isActive(filters.departamento)) parts.push(filters.departamento);
    if (isActive(filters.provincia)) parts.push(filters.provincia);
    if (selectedDistrict) parts.push(repairText(selectedDistrict.nombre));
    if (selectedGroup) parts.push(selectedGroup.nombre);
    return parts.length ? parts.join(" / ") : "Panorama nacional";
  }, [filters, selectedDistrict, selectedGroup]);

  const kpis = [
    {
      label: "Distritos afectados",
      value: formatNumber(filteredDistricts.length),
      helper: `${formatNumber(criticalDistricts.length)} distritos criticos`,
      tone: "blue",
      path: buildDashboardPath("/mapa", filters, {
        modo: "ruta",
        distrito: rankedDistricts[0]?.id,
      }),
    },
    {
      label: "Interrupciones registradas",
      value: formatNumber(totalInterruptions),
      helper: `Duracion promedio: ${formatHours(averageDuration)}`,
      tone: "amber",
      path: buildDashboardPath("/mapa", filters, { modo: "ruta" }),
    },
    {
      label: "Afectaciones estimadas acumuladas",
      value: formatCompact(totalEstimatedPeople),
      helper: `${formatNumber(totalEstimatedPeople)} personas estimadas`,
      tone: "teal",
      path: buildDashboardPath("/agrupacion", filters),
    },
    {
      label: "Conexiones afectadas acumuladas",
      value: formatCompact(totalConnections),
      helper: `${formatNumber(totalConnections)} conexiones acumuladas`,
      tone: "blue",
      path: buildDashboardPath("/agrupacion", filters),
    },
    {
      label: "Grupos del contexto",
      value: formatNumber(visibleGroups.length),
      helper: `${formatNumber(groupedZones.length)} grupos precalculados`,
      tone: "green",
      path: buildDashboardPath("/agrupacion", filters),
    },
  ];

  const mapDistricts = getDashboardMapDistricts(filteredDistricts, filters.distrito);
  const hasFilters = dashboardFiltersToSearch(filters).toString().length > 0;

  function openDistrict(district) {
    navigate(
      buildDashboardPath("/mapa", filters, {
        modo: "ruta",
        distrito: district.id,
      })
    );
  }

  function openGroup(group, target = "sectorizacion") {
    if (target === "agrupacion") {
      navigate(buildDashboardPath("/agrupacion", filters, { grupo: group.id }));
      return;
    }
    if (target === "mapa") {
      navigate(buildDashboardPath("/mapa", filters, { modo: "recorrido", grupo: group.id }));
      return;
    }
    navigate(buildDashboardPath("/sectorizacion", filters, { grupo: group.id }));
  }

  return (
    <MainLayout>
      <section className="page-section dashboard-page">
        <article className="dashboard-hero">
          <div>
            <h2 className="dashboard-title">Dashboard operativo</h2>
            <p className="dashboard-subtitle">
              Panorama territorial para identificar afectacion, prioridad y siguiente accion con
              datos trazables del pipeline de AquaRuta.
            </p>
          </div>
          <div className="dashboard-context-panel">
            <span className="dashboard-context-label">Contexto actual</span>
            <strong>{contextLabel}</strong>
            <span>
              Datos actualizados hasta:{" "}
              {formatDateOnly(metadata.ultima_actualizacion || metadata.processed_at)}
            </span>
          </div>
        </article>

        <article className="panel dashboard-filter-panel">
          <div className="dashboard-panel-heading">
            <div>
              <h3 className="panel-title">Filtros territoriales</h3>
              <p className="panel-subtitle">
                Las opciones se restringen entre si para evitar combinaciones incompatibles.
              </p>
            </div>
            <button
              type="button"
              className="dashboard-soft-button"
              onClick={clearFilters}
              disabled={!hasFilters}
            >
              Limpiar filtros
            </button>
          </div>
          <div className="dashboard-filter-grid">
            <label className="control-group">
              <span className="control-label">EPS</span>
              <select
                className="control-select"
                value={filters.eps}
                onChange={(event) => updateFilter("eps", event.target.value)}
              >
                <option value="todos">Todas</option>
                {options.eps.map((eps) => (
                  <option key={eps} value={eps}>
                    {repairText(eps)}
                  </option>
                ))}
              </select>
            </label>
            <label className="control-group">
              <span className="control-label">Departamento</span>
              <select
                className="control-select"
                value={filters.departamento}
                onChange={(event) => updateFilter("departamento", event.target.value)}
              >
                <option value="todos">Todos</option>
                {options.departamentos.map((department) => (
                  <option key={department} value={department}>
                    {repairText(department)}
                  </option>
                ))}
              </select>
            </label>
            <label className="control-group">
              <span className="control-label">Provincia</span>
              <select
                className="control-select"
                value={filters.provincia}
                onChange={(event) => updateFilter("provincia", event.target.value)}
              >
                <option value="todos">Todas</option>
                {options.provincias.map((province) => (
                  <option key={province} value={province}>
                    {repairText(province)}
                  </option>
                ))}
              </select>
            </label>
            <label className="control-group">
              <span className="control-label">Distrito</span>
              <select
                className="control-select"
                value={filters.distrito}
                onChange={(event) => updateFilter("distrito", event.target.value)}
              >
                <option value="todos">Todos</option>
                {options.distritos.map((district) => (
                  <option key={district.id} value={district.id}>
                    {repairText(district.nombre)}
                  </option>
                ))}
              </select>
            </label>
            <label className="control-group">
              <span className="control-label">Grupo operativo</span>
              <select
                className="control-select"
                value={filters.grupo}
                onChange={(event) => updateFilter("grupo", event.target.value)}
              >
                <option value="todos">Todos</option>
                {options.grupos.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.nombre}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </article>

        {!filteredDistricts.length ? (
          <article className="panel dashboard-empty-context">
            <h3>No existen registros para los filtros seleccionados.</h3>
            <p>Prueba con otro territorio o limpia los filtros para volver al panorama general.</p>
            <button type="button" className="dashboard-soft-button" onClick={clearFilters}>
              Limpiar filtros
            </button>
          </article>
        ) : (
          <>
            <section className="dashboard-kpi-grid">
              {kpis.map((item) => (
                <article
                  role="button"
                  tabIndex={0}
                  key={item.label}
                  className={`dashboard-kpi-card ${item.tone}`}
                  onClick={() => navigate(item.path)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      navigate(item.path);
                    }
                  }}
                >
                  <span className="dashboard-kpi-label">{item.label}</span>
                  <strong>{item.value}</strong>
                  <span>{item.helper}</span>
                </article>
              ))}
            </section>

            {selectedDistrict && (
              <article className="panel dashboard-detail-panel">
                <div>
                  <span className={badgeClass(selectedDistrict.criticidad)}>
                    {priorityLabels[selectedDistrict.criticidad] || "BAJA"}
                  </span>
                  <h3>{repairText(selectedDistrict.nombre)}</h3>
                  <p>
                    {repairText(selectedDistrict.provincia)},{" "}
                    {repairText(selectedDistrict.departamento)}
                  </p>
                </div>
                <div className="dashboard-detail-grid">
                  <span>
                    <strong>EPS:</strong>{" "}
                    {repairText(selectedDistrict.eps_principal || "No disponible")}
                  </span>
                  <span>
                    <strong>Interrupciones:</strong>{" "}
                    {formatNumber(selectedDistrict.interrupciones)}
                  </span>
                  <span>
                    <strong>Afectaciones estimadas:</strong>{" "}
                    {formatNumber(selectedDistrict.personas_afectadas_estimadas)}
                  </span>
                  <span>
                    <strong>Conexiones acumuladas:</strong>{" "}
                    {formatNumber(selectedDistrict.conexiones_afectadas)}
                  </span>
                  <span>
                    <strong>Grupo operativo:</strong>{" "}
                    {selectedDistrictGroup?.nombre || "No disponible"}
                  </span>
                  <span>
                    <strong>Duracion maxima:</strong>{" "}
                    {formatHours(selectedDistrict.duracion_maxima_horas)}
                  </span>
                </div>
                <div className="dashboard-context-actions">
                  {selectedDistrictGroup && (
                    <button type="button" onClick={() => openGroup(selectedDistrictGroup, "agrupacion")}>
                      Ver grupo operativo
                    </button>
                  )}
                  <button type="button" onClick={() => openDistrict(selectedDistrict)}>
                    Ver en mapa operativo
                  </button>
                  {selectedDistrictGroup && (
                    <button type="button" onClick={() => openGroup(selectedDistrictGroup)}>
                      Sectorizar grupo
                    </button>
                  )}
                </div>
              </article>
            )}

            <section className="dashboard-map-grid">
              <article className="panel dashboard-map-panel">
                <div className="dashboard-panel-heading">
                  <div>
                    <h3 className="panel-title">Resumen territorial</h3>
                    <p className="panel-subtitle">
                      El mapa muestra unicamente distritos compatibles con el contexto activo.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="dashboard-soft-button"
                    onClick={() => setMapResetKey((value) => value + 1)}
                  >
                    Restablecer vista
                  </button>
                  <button
                    type="button"
                    className="dashboard-soft-button"
                    onClick={() =>
                      navigate(
                        buildDashboardPath("/mapa", filters, {
                          modo: "ruta",
                          distrito: rankedDistricts[0]?.id,
                        })
                      )
                    }
                  >
                    Ver mapa operativo
                  </button>
                </div>
                <DashboardMiniMap
                  districts={mapDistricts}
                  epsOrigins={selectedMapOriginsWithCoordinates}
                  focusKey={mapResetKey}
                  onDistrictClick={openDistrict}
                />
                <div className="dashboard-map-legend">
                  <span className="district">Distrito</span>
                  <span className="eps">EPS</span>
                  <span className="critical">Critica</span>
                  <span className="high">Alta</span>
                  <span className="medium">Media</span>
                  <span className="low">Baja</span>
                </div>
                {selectedEpsWithoutCoordinates && (
                  <div className="dashboard-map-note">
                    La EPS seleccionada no tiene una ubicacion geografica disponible.
                  </div>
                )}
              </article>

              <aside className="dashboard-side-stack">
                <article className="panel dashboard-alert-panel">
                  <div className="dashboard-panel-heading">
                    <div>
                      <h3 className="panel-title">Alertas operativas</h3>
                      <p className="panel-subtitle">
                        Condiciones reales detectadas dentro del contexto.
                      </p>
                    </div>
                  </div>
                  <div className="dashboard-alert-list">
                    {alerts.length ? (
                      alerts.map((alert) => (
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
                          <small>{alert.action}</small>
                        </button>
                      ))
                    ) : (
                      <div className="empty-state dashboard-alert-empty">
                        <strong>Sin alertas operativas</strong>
                        <span>
                          No se detectaron condiciones que requieran atencion en el contexto
                          seleccionado.
                        </span>
                      </div>
                    )}
                  </div>
                </article>

                <article className="panel">
                  <div className="dashboard-panel-heading">
                    <div>
                      <h3 className="panel-title">{selectedEpsContext.title}</h3>
                      <p className="panel-subtitle">
                        {isActive(filters.eps)
                          ? "Referencia operativa asociada a la EPS filtrada."
                          : "Sedes referenciales asociadas por EPS o cercania territorial."}
                      </p>
                    </div>
                  </div>
                  <div className="dashboard-origin-list dashboard-scroll-list">
                    {(isActive(filters.eps) ? selectedEpsContext.items : originCoverage).map((origin) => (
                      <button
                        type="button"
                        key={origin.id}
                        className="dashboard-origin-card"
                        onClick={() =>
                          commitFilters({
                            ...filters,
                            eps:
                              origin.relatedDistricts?.[0]?.eps_principal ||
                              origin.coverageDistricts?.[0]?.eps_principal ||
                              filters.eps,
                          })
                        }
                      >
                        <strong>{origin.prestador}</strong>
                        <span>
                          {origin.distrito}, {origin.provincia}
                        </span>
                        <small>
                          {formatNumber(origin.relatedDistricts?.length || origin.coverageDistricts?.length || 0)} distritos relacionados
                          {origin.locationType === "referencial"
                            ? " - ubicacion referencial"
                            : origin.locationType === "no_disponible"
                            ? " - sin ubicacion geografica"
                            : ""}
                        </small>
                      </button>
                    ))}
                    {!isActive(filters.eps) && !originCoverage.length && (
                      <div className="empty-state">
                        No hay EPS relacionadas con los filtros seleccionados.
                      </div>
                    )}
                  </div>
                </article>
              </aside>
            </section>

            <section className="dashboard-main-grid">
              <article className="panel dashboard-ranking-panel">
                <div className="dashboard-panel-heading">
                  <div>
                    <h3 className="panel-title">Distritos con mayor prioridad</h3>
                    <p className="panel-subtitle">
                      Ordenados por interrupciones, criticidad, demanda familiar y conexiones
                      acumuladas.
                    </p>
                  </div>
                </div>
                <div className="dashboard-ranking-list">
                  {rankedDistricts.map((district, index) => (
                    <button
                      type="button"
                      className="dashboard-rank-row"
                      key={district.id}
                      onClick={() => updateFilter("distrito", district.id)}
                    >
                      <span className="dashboard-rank-number">{index + 1}</span>
                      <span className="dashboard-rank-content">
                        <strong>{repairText(district.nombre)}</strong>
                        <span>
                          {repairText(district.provincia)}, {repairText(district.departamento)} -{" "}
                          {formatNumber(district.interrupciones)} interrupciones -{" "}
                          {formatCompact(district.conexiones_afectadas)} conexiones acumuladas
                        </span>
                      </span>
                      <span className="dashboard-rank-metrics">
                        <span className={badgeClass(district.criticidad)}>
                          {priorityLabels[district.criticidad] || "BAJA"}
                        </span>
                        <small>
                          Duracion promedio: {formatHours(district.duracion_promedio_horas)}
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
              </article>

              <article className="panel">
                <div className="dashboard-panel-heading">
                  <div>
                    <h3 className="panel-title">Grupos operativos del contexto seleccionado</h3>
                    <p className="panel-subtitle">
                      Orden: distritos criticos, conexiones afectadas acumuladas e interrupciones.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="dashboard-soft-button"
                    onClick={() => navigate(buildDashboardPath("/agrupacion", filters))}
                  >
                    Ver todos los grupos
                  </button>
                </div>
                <div className="dashboard-group-grid dashboard-group-grid-compact">
                  {visibleGroups.slice(0, 8).map((group) => (
                    <article className="dashboard-group-card" key={group.id}>
                      <div className="dashboard-group-topline">
                        <span className={badgeClass(group.criticidad)}>
                          {priorityLabels[group.criticidad] || "BAJA"}
                        </span>
                        <small>{formatNumber(group.visibleZones)} distritos</small>
                      </div>
                      <h4>{group.nombre}</h4>
                      <p>
                        {group.visibleCriticalCount} criticos -{" "}
                        {formatCompact(group.visibleConnections)} conexiones afectadas acumuladas
                      </p>
                      <div className="dashboard-group-metrics">
                        <span>
                          <strong>{formatNumber(group.visibleInterruptions)}</strong>{" "}
                          interrupciones
                        </span>
                        <span>
                          <strong>{formatCompact(group.visibleConnections)}</strong>{" "}
                          conexiones afectadas acumuladas
                        </span>
                        <span>
                          <strong>
                            {group.visibleZones > GROUP_SECTOR_THRESHOLD ? "Si" : "No"}
                          </strong>{" "}
                          requiere sectorizacion
                        </span>
                      </div>
                      <div className="dashboard-group-actions">
                        <button type="button" onClick={() => openGroup(group, "agrupacion")}>
                          Ver grupo operativo
                        </button>
                        <button type="button" onClick={() => openGroup(group)}>
                          Sectorizar grupo
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </article>
            </section>
          </>
        )}
      </section>
    </MainLayout>
  );
}



