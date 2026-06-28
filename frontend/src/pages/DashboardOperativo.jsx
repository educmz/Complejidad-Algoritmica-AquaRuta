import { useMemo, useState } from "react";
import { useId, useRef } from "react";
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
  buildRelatedEpsContext,
  buildSelectedEpsContext,
  consolidateDashboardDistrictsAndGroups,
  repairText,
} from "../utils/dashboardGeo";

const STORAGE_KEY = "aquaruta.dashboard.filters.v1";

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

function normalizeSearchText(value) {
  return repairText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function DashboardCombobox({ label, value, allLabel, options, onChange }) {
  const listId = useId();
  const rootRef = useRef(null);
  const selectedOption = options.find((option) => option.value === value);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const allOptions = useMemo(
    () => [{ value: "todos", label: allLabel }, ...options],
    [allLabel, options]
  );
  const visibleOptions = useMemo(() => {
    const normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery) return allOptions;
    return allOptions.filter((option) =>
      normalizeSearchText(option.label).includes(normalizedQuery)
    );
  }, [allOptions, query]);

  function selectOption(option) {
    if (!option) return;
    onChange(option.value);
    setQuery("");
    setOpen(false);
  }

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setQuery("");
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.min(index + 1, visibleOptions.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Enter" && open) {
      event.preventDefault();
      selectOption(visibleOptions[activeIndex]);
    }
  }

  return (
    <label className="control-group dashboard-combobox" ref={rootRef}>
      <span className="control-label">{label}</span>
      <div
        className="dashboard-combobox-control"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
        }}
      >
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          className="control-select dashboard-combobox-input"
          value={open ? query : selectedOption?.label || allLabel}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
            setOpen(true);
          }}
          onFocus={() => {
            setQuery("");
            setActiveIndex(0);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
        />
        {isActive(value) && (
          <button
            type="button"
            className="dashboard-combobox-clear"
            aria-label={`Limpiar ${label}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => selectOption(allOptions[0])}
          >
            ×
          </button>
        )}
        <button
          type="button"
          className="dashboard-combobox-toggle"
          aria-label={`Abrir ${label}`}
          aria-expanded={open}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setActiveIndex(0);
            setOpen((current) => !current);
          }}
        >
          ▾
        </button>
        {open && (
          <div className="dashboard-combobox-menu" id={listId} role="listbox">
            {visibleOptions.length ? (
              visibleOptions.map((option, index) => (
                <button
                  type="button"
                  key={option.value}
                  role="option"
                  aria-selected={option.value === value}
                  className={index === activeIndex ? "active" : ""}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectOption(option)}
                >
                  {repairText(option.label)}
                </button>
              ))
            ) : (
              <span className="dashboard-combobox-empty">Sin coincidencias</span>
            )}
          </div>
        )}
      </div>
    </label>
  );
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
  const rawDistricts = useMemo(() => aquaRutaData.districts || [], []);
  const rawGroupedZones = useMemo(() => aquaRutaData.groupedZones || [], []);
  const canonicalDashboardData = useMemo(
    () => consolidateDashboardDistrictsAndGroups(rawDistricts, rawGroupedZones),
    [rawDistricts, rawGroupedZones]
  );
  const allDistricts = canonicalDashboardData.districts;
  const groupedZones = canonicalDashboardData.groups;
  const epsOrigins = useMemo(() => aquaRutaData.epsOrigins || [], []);
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
  const [mapResetKey, setMapResetKey] = useState(0);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [showMapLegend, setShowMapLegend] = useState(true);

  const selectedDistrictGroup = useMemo(() => {
    if (!selectedDistrict) return null;
    return groupedZones.find((group) => (group.zona_ids || []).includes(selectedDistrict.id));
  }, [groupedZones, selectedDistrict]);

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
              Consulta el estado de las interrupciones, los distritos afectados y los grupos operativos para orientar la atención y planificación.
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
          <div className="dashboard-filter-grid">
            <DashboardCombobox
              label="EPS"
              value={filters.eps}
              allLabel="Todas"
              options={options.eps.map((eps) => ({ value: eps, label: repairText(eps) }))}
              onChange={(value) => updateFilter("eps", value)}
            />
            <DashboardCombobox
              label="Departamento"
              value={filters.departamento}
              allLabel="Todos"
              options={options.departamentos.map((department) => ({
                value: department,
                label: repairText(department),
              }))}
              onChange={(value) => updateFilter("departamento", value)}
            />
            <DashboardCombobox
              label="Provincia"
              value={filters.provincia}
              allLabel="Todas"
              options={options.provincias.map((province) => ({
                value: province,
                label: repairText(province),
              }))}
              onChange={(value) => updateFilter("provincia", value)}
            />
            <DashboardCombobox
              label="Distrito"
              value={filters.distrito}
              allLabel="Todos"
              options={options.distritos.map((district) => ({
                value: district.id,
                label: repairText(district.nombre),
              }))}
              onChange={(value) => updateFilter("distrito", value)}
            />
            <DashboardCombobox
              label="Grupo operativo"
              value={filters.grupo}
              allLabel="Todos"
              options={options.grupos.map((group) => ({
                value: group.id,
                label: group.nombre,
              }))}
              onChange={(value) => updateFilter("grupo", value)}
            />
            <button
              type="button"
              className="dashboard-soft-button dashboard-filter-clear"
              onClick={clearFilters}
              disabled={!hasFilters}
            >
              Limpiar filtros
            </button>
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

            <section className={`dashboard-map-grid ${mapExpanded ? "dashboard-map-expanded" : ""}`}>
              <article className="panel dashboard-map-panel">
                <div className="dashboard-panel-heading">
                  <div>
                    <h3 className="panel-title">Resumen territorial</h3>
                    <p className="panel-subtitle">
                      Visualiza la distribución de los distritos afectados y los grupos operativos.
                    </p>
                  </div>
                  <div className="dashboard-map-toolbar" aria-label="Controles del mapa">
                    <button
                      type="button"
                      aria-label={mapExpanded ? "Reducir mapa" : "Ampliar mapa"}
                      title={mapExpanded ? "Reducir mapa" : "Ampliar mapa"}
                      onClick={() => setMapExpanded((current) => !current)}
                    >
                      <span className="toolbar-icon toolbar-icon-expand" aria-hidden="true" />
                      <span>{mapExpanded ? "Reducir" : "Ampliar"}</span>
                    </button>
                    <button
                      type="button"
                      aria-label="Abrir capas en mapa operativo"
                      title="Capas"
                      onClick={() => navigate(buildDashboardPath("/mapa", filters))}
                    >
                      <span className="toolbar-icon toolbar-icon-layers" aria-hidden="true" />
                      <span>Capas</span>
                    </button>
                    <button
                      type="button"
                      aria-label={showMapLegend ? "Ocultar leyenda" : "Mostrar leyenda"}
                      title="Leyenda"
                      onClick={() => setShowMapLegend((current) => !current)}
                    >
                      <span className="toolbar-icon toolbar-icon-legend" aria-hidden="true" />
                      <span>Leyenda</span>
                    </button>
                    <button
                      type="button"
                      aria-label="Centrar selección en el mapa"
                      title="Centrar selección"
                      onClick={() => setMapResetKey((value) => value + 1)}
                    >
                      <span className="toolbar-icon toolbar-icon-target" aria-hidden="true" />
                      <span>Centrar</span>
                    </button>
                  </div>
                </div>
                <DashboardMiniMap
                  districts={mapDistricts}
                  epsOrigins={selectedMapOriginsWithCoordinates}
                  focusKey={mapResetKey}
                  onDistrictClick={openDistrict}
                />
                {showMapLegend && (
                  <div className="dashboard-map-legend">
                    <span className="district">Distrito</span>
                    <span className="eps">EPS</span>
                    <span className="critical">Critica</span>
                    <span className="high">Alta</span>
                    <span className="medium">Media</span>
                    <span className="low">Baja</span>
                  </div>
                )}
              </article>

              <aside className="dashboard-side-stack">
                <article className="panel">
                  <div className="dashboard-panel-heading">
                    <div>
                      <h3 className="panel-title">{selectedEpsContext.title}</h3>
                      <p className="panel-subtitle">
                        {isActive(filters.eps)
                          ? "Referencia operativa asociada a la EPS filtrada."
                          : "EPS asociadas a los distritos del contexto."}
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
                            ? " - sin sede registrada"
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



