import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import {
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import MainLayout from "../components/layout/MainLayout";
import SearchableCombobox from "../components/forms/SearchableCombobox";
import MapToolbar from "../components/map/MapToolbar";
import EpsMapMarker from "../components/map/EpsMapMarker";
import { runSectorization } from "../services/sectorizationApi";
import {
  groupNumber,
  groupToOption,
  useOperationalGroups,
} from "../hooks/useOperationalAlgorithms";
import {
  buildRouteContextPath,
  readRouteContext,
  writeRouteContext,
} from "../utils/sharedRouteContext";

const sectorColors = ["#2563eb", "#0f766e", "#ea580c", "#7c3aed", "#0891b2", "#be123c"];
const SECTORIZATION_STORAGE_KEY = "aquaruta:sectorization-state:v1";

function writeStoredSectorizationState(state) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SECTORIZATION_STORAGE_KEY, JSON.stringify(state));
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("es-PE");
}

function formatKm(value) {
  if (!Number.isFinite(value)) return "No disponible";
  return `${value.toFixed(1)} km`;
}

function badgeClass(level) {
  if (level === "critica") return "badge critical";
  if (level === "alta") return "badge high";
  if (level === "media") return "badge medium";
  return "badge low";
}

function validCenter(center) {
  return (
    Array.isArray(center) &&
    center.length === 2 &&
    Number.isFinite(Number(center[0])) &&
    Number.isFinite(Number(center[1]))
  );
}

function distanceKm(center, origin) {
  if (!validCenter(center) || !origin) return Infinity;
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
  return epsOrigins
    .map((origin) => ({ origin, distance: distanceKm(center, origin) }))
    .sort((a, b) => a.distance - b.distance)[0] || { origin: null, distance: Infinity };
}

function sectorPriority(sector, index) {
  if (sector.criticidad === "critica") return "Atención inmediata";
  if (sector.criticidad === "alta" || index === 0) return "Alta prioridad";
  if (sector.criticidad === "media") return "Programar cobertura";
  return "Seguimiento";
}

function sectorsSummaryInterruptions(sectors) {
  return (sectors || []).reduce(
    (total, sector) => total + Number(sector.summary?.interruptions || 0),
    0
  );
}

function validLatLngs(points) {
  return points.filter(validCenter);
}

function fitMapToPoints(map, points, options = {}) {
  const validPoints = validLatLngs(points);
  if (!validPoints.length) return;
  if (validPoints.length === 1) {
    map.setView(validPoints[0], options.zoom || 11);
    return;
  }
  map.fitBounds(validPoints, {
    padding: options.padding || [38, 38],
    maxZoom: options.maxZoom || 12,
  });
}

function SectorMapController({ focusKey, focusPoints }) {
  const map = useMap();

  useEffect(() => {
    map.invalidateSize();
    fitMapToPoints(map, focusPoints, { maxZoom: 12 });
  }, [focusKey, focusPoints, map]);

  return null;
}

function SectorMap({
  group,
  sectors,
  activeSector,
  selectedDistrictId,
  epsOrigin,
  mapFocusKey,
  showLegend,
  showOtherLayers,
  mapExpanded,
  onCenter,
  onToggleExpanded,
  onToggleLayers,
  onToggleLegend,
  onSelectSector,
  onSelectDistrict,
}) {
  const groupPoints = useMemo(
    () => [
      ...(validCenter(group?.groupCenter) ? [group.groupCenter] : []),
      ...sectors.flatMap((sector) => sector.districts.map((district) => district.center)),
      ...(epsOrigin ? [[epsOrigin.lat, epsOrigin.lon]] : []),
    ],
    [epsOrigin, group, sectors]
  );
  const focusPoints = useMemo(
    () => [
      ...(validCenter(activeSector?.center) ? [activeSector.center] : []),
      ...(
        selectedDistrictId
          ? activeSector?.districts
              ?.filter((district) => district.id === selectedDistrictId)
              .map((district) => district.center) || []
          : activeSector?.districts?.map((district) => district.center) || []
      ),
      ...(epsOrigin ? [[epsOrigin.lat, epsOrigin.lon]] : []),
    ],
    [activeSector, epsOrigin, selectedDistrictId]
  );
  const visibleSectors = showOtherLayers
    ? sectors
    : sectors.filter((sector) => sector.id === activeSector?.id);
  const initialCenter = groupPoints[0] || [-12.0464, -77.0428];

  return (
    <article className="sector-map-panel">
      <div className="sector-map-heading">
        <div>
          <h3>Mapa del sector seleccionado</h3>
          <p>{activeSector?.nombre || "Selecciona un sector"}</p>
        </div>
        <MapToolbar
          expanded={mapExpanded}
          legendVisible={showLegend}
          layersActive={showOtherLayers}
          onToggleExpanded={onToggleExpanded}
          onToggleLayers={onToggleLayers}
          onToggleLegend={onToggleLegend}
          onCenter={onCenter}
          layersLabel="Mostrar u ocultar capas secundarias"
          centerLabel="Centrar sector seleccionado"
        />
      </div>

      <div className="sector-map-shell">
        <MapContainer center={initialCenter} zoom={8} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <SectorMapController
            focusKey={mapFocusKey}
            focusPoints={focusPoints.length ? focusPoints : groupPoints}
          />

          {visibleSectors.flatMap((sector) =>
            sector.districts.map((district) => {
              const isActive = sector.id === activeSector?.id;
              return (
                <CircleMarker
                  key={`${sector.id}-${district.id}`}
                  center={district.center}
                  radius={district.id === selectedDistrictId ? 10 : isActive ? 8 : 5}
                  eventHandlers={{
                    click: () => {
                      onSelectSector(sector.id);
                      onSelectDistrict(district.id);
                    },
                  }}
                  pathOptions={{
                    color: district.id === selectedDistrictId ? "#0f172a" : isActive ? "#0f172a" : sector.color,
                    fillColor: sector.color,
                    fillOpacity: isActive ? 0.9 : 0.34,
                    weight: district.id === selectedDistrictId ? 3 : isActive ? 2.5 : 1.2,
                  }}
                >
                  <Tooltip direction="top" opacity={0.94}>
                    {district.nombre} - {sector.nombre}
                  </Tooltip>
                  <Popup>
                    <strong>{district.nombre}</strong>
                    <br />
                    {sector.nombre}
                    <br />
                    {formatNumber(district.interrupciones)} interrupciones
                  </Popup>
                </CircleMarker>
              );
            })
          )}

          {showOtherLayers && epsOrigin && (
            <EpsMapMarker origin={epsOrigin}>
              <br />
              EPS de referencia del sector
            </EpsMapMarker>
          )}
        </MapContainer>
        {showLegend && (
          <div className="sector-map-legend">
            <span><i className="legend-dot selected" /> Distrito del sector seleccionado</span>
            {showOtherLayers && <span><i className="legend-dot muted" /> Distrito de otro sector</span>}
            <span><i className="legend-eps" /> EPS de referencia</span>
          </div>
        )}
      </div>
    </article>
  );
}

export default function Sectorizacion() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const sharedContext = useMemo(() => readRouteContext(searchParams), [searchParams]);
  const {
    districts,
    epsOrigins,
    groups: groupedZones,
    loadingGroups,
    groupingError,
  } = useOperationalGroups();

  const districtMap = useMemo(
    () => new Map(districts.map((district) => [district.id, district])),
    [districts]
  );

  const groupOptions = useMemo(
    () =>
      groupedZones.map(groupToOption)
        .filter((group) => group.zonesCount > 0)
        .sort((a, b) => groupNumber(a.groupId) - groupNumber(b.groupId) || a.groupName.localeCompare(b.groupName, "es")),
    [groupedZones]
  );
  const groupIds = groupOptions.map((group) => group.groupId);
  const requestedGroupId =
    searchParams.get("grupo") || searchParams.get("groupId") || sharedContext.groupId || "";
  const requestedSectorId = searchParams.get("sectorId") || sharedContext.sectorId || "";
  const requestedDistrictId =
    searchParams.get("districtId") || searchParams.get("distrito") || sharedContext.districtId || "";

  const [selectedGroupId, setSelectedGroupId] = useState(
    groupIds.includes(requestedGroupId) ? requestedGroupId : ""
  );
  const [selectedSectorId, setSelectedSectorId] = useState(requestedSectorId);
  const [selectedDistrictId, setSelectedDistrictId] = useState(requestedDistrictId);
  const [sectorizationStatus, setSectorizationStatus] = useState(selectedGroupId ? "loading" : "idle");
  const [sectorizationError, setSectorizationError] = useState("");
  const [sectorizationPayload, setSectorizationPayload] = useState(null);
  const [sectorizationRetryToken, setSectorizationRetryToken] = useState(0);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [showOtherLayers, setShowOtherLayers] = useState(true);
  const [showLegend, setShowLegend] = useState(true);
  const [mapFocusTick, setMapFocusTick] = useState(0);

  useEffect(() => {
    if (!groupOptions.length) return;
    const timer = window.setTimeout(() => {
      setSelectedGroupId((current) => {
        if (groupIds.includes(current)) return current;
        if (groupIds.includes(requestedGroupId)) return requestedGroupId;
        return "";
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [groupIds, groupOptions.length, requestedGroupId]);

  useEffect(() => {
    const timer = window.setTimeout(() => window.dispatchEvent(new Event("resize")), 220);
    return () => window.clearTimeout(timer);
  }, [mapExpanded]);

  useEffect(() => {
    writeStoredSectorizationState({
      groupId: selectedGroupId,
      sectorId: selectedSectorId,
      districtId: selectedDistrictId,
    });
    writeRouteContext({
      filters: sharedContext.filters,
      groupId: selectedGroupId,
      sectorId: selectedSectorId,
      districtId: selectedDistrictId,
      criterion: sharedContext.criterion,
      mode: sharedContext.mode,
    });
  }, [selectedDistrictId, selectedGroupId, selectedSectorId, sharedContext]);

  const activeOption = groupOptions.find((group) => group.groupId === selectedGroupId) || null;
  const activeGroup = useMemo(
    () =>
      sectorizationPayload?.group
        ? {
            groupId: sectorizationPayload.group.groupId,
            groupName: sectorizationPayload.group.groupName,
            groupCenter: sectorizationPayload.group.groupCenter,
            groupZonesCount: sectorizationPayload.group.inputNodes,
            groupInterruptions: sectorsSummaryInterruptions(sectorizationPayload.sectors),
          }
        : activeOption
          ? { ...activeOption, groupZonesCount: activeOption.zonesCount }
          : null,
    [activeOption, sectorizationPayload]
  );

  const rawSectors = useMemo(() => {
    if (!sectorizationPayload?.sectors?.length) return [];
    return sectorizationPayload.sectors.map((sector) => ({
      id: sector.sectorId,
      nombre: sector.nombre,
      zona_ids: sector.nodeIds || sector.zona_ids || [],
      zonas: sector.zonas || [],
      cantidad_zonas: sector.summary?.districts || sector.nodeIds?.length || 0,
      interrupciones: sector.summary?.interruptions || 0,
      criticidad: sector.summary?.maxCriticality || "baja",
      center: sector.center,
      personas_afectadas_estimadas: sector.summary?.estimatedAffectedPeople || 0,
      peso_demanda_familiar: sector.summary?.demandWeight || 0,
      prioridad_score: sector.summary?.averagePriority || 0,
      nodes: sector.nodes || [],
      recursion: sector.recursion,
      backendSummary: sector.summary,
    }));
  }, [sectorizationPayload]);

  const sectors = useMemo(() => {
    return rawSectors.map((sector, index) => {
      const districtsInSector = (sector.nodes?.length ? sector.nodes : sector.zona_ids || [])
        .map((item) => {
          const node = typeof item === "string" ? districtMap.get(item) : item;
          const enriched = districtMap.get(node?.id) || {};
          return { ...enriched, ...node };
        })
        .filter((district) => district && validCenter(district.center));
      const estimatedPopulation = districtsInSector.reduce(
        (acc, district) => acc + Number(district.personas_afectadas_estimadas || 0),
        0
      );
      const connections = districtsInSector.reduce(
        (acc, district) => acc + Number(district.conexiones_afectadas || 0),
        0
      );
      const nearest = nearestOrigin(sector.center, epsOrigins);
      return {
        ...sector,
        color: sectorColors[index % sectorColors.length],
        districts: districtsInSector,
        nodos: districtsInSector,
        cantidad_nodos: districtsInSector.length,
        estimatedPopulation,
        connections,
        nearestOrigin: nearest.origin,
        nearestOriginDistanceKm: nearest.distance,
        priorityLabel: sectorPriority(sector, index),
        mainDistrict: districtsInSector[0] || null,
      };
    });
  }, [districtMap, epsOrigins, rawSectors]);

  const activeSector = useMemo(() => {
    if (!sectors.length || !selectedSectorId) return null;
    return sectors.find((sector) => sector.id === selectedSectorId) || null;
  }, [sectors, selectedSectorId]);

  const mapFocusKey = [
    selectedGroupId,
    activeSector?.id || "",
    selectedDistrictId || "",
    mapFocusTick,
  ].join("|");

  useEffect(() => {
    if (!selectedGroupId) {
      const timer = window.setTimeout(() => {
        setSectorizationPayload(null);
        setSectorizationError("");
        setSectorizationStatus("idle");
        setSelectedSectorId("");
        setSelectedDistrictId("");
      }, 0);
      return () => window.clearTimeout(timer);
    }

    if (!activeOption?.sourceGroup) {
      const timer = window.setTimeout(() => {
        setSectorizationPayload(null);
        setSectorizationError(groupingError || "");
        setSectorizationStatus(loadingGroups ? "loading" : "error");
        setSelectedSectorId("");
        setSelectedDistrictId("");
      }, 0);
      return () => window.clearTimeout(timer);
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSectorizationPayload(null);
      setSectorizationError("");
      setSectorizationStatus("loading");
      setSelectedSectorId("");
      setSelectedDistrictId("");
    }, 0);

    runSectorization(
      { groupId: selectedGroupId, group: activeOption?.sourceGroup },
      { signal: controller.signal }
    )
      .then((payload) => {
        if (controller.signal.aborted) return;
        const availableSectors = payload.sectors || [];
        const preferredSectorId = requestedSectorId || "";
        const preferredDistrictId = requestedDistrictId || "";
        const preferredSector = availableSectors.find(
          (sector) => sector.sectorId === preferredSectorId
        );
        const nextSector = preferredSector || availableSectors[0] || null;
        const nextDistrictIds = new Set(nextSector?.nodeIds || nextSector?.zona_ids || []);
        const nextDistrictId = nextDistrictIds.has(preferredDistrictId) ? preferredDistrictId : "";
        setSectorizationPayload(payload);
        setSelectedSectorId(nextSector?.sectorId || "");
        setSelectedDistrictId(nextDistrictId);
        setSectorizationStatus(availableSectors.length ? "success" : "empty");
        setSectorizationError("");
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        setSectorizationPayload(null);
        setSelectedSectorId("");
        setSelectedDistrictId("");
        setSectorizationStatus("error");
        setSectorizationError(error?.message || "No fue posible sectorizar este grupo.");
      });

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    activeOption?.sourceGroup,
    groupingError,
    loadingGroups,
    requestedDistrictId,
    requestedSectorId,
    selectedGroupId,
    sectorizationRetryToken,
  ]);

  function handleGroupChange(groupId) {
    const nextGroupId = groupId === "todos" ? "" : groupId;
    setSelectedGroupId(nextGroupId);
    setSectorizationPayload(null);
    setSectorizationError("");
    setSectorizationStatus(nextGroupId ? "loading" : "idle");
    setSelectedSectorId("");
    setSelectedDistrictId("");
  }

  function handleClearSectorSelection() {
    setSelectedSectorId("");
    setSelectedDistrictId("");
    setMapFocusTick((current) => current + 1);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("sectorId");
    nextParams.delete("districtId");
    nextParams.delete("distrito");
    setSearchParams(nextParams, { replace: true });
    writeStoredSectorizationState({
      groupId: selectedGroupId,
      sectorId: "",
      districtId: "",
    });
  }

  function openContext(path) {
    if (!selectedGroupId || !selectedSectorId) return;
    const context = {
      filters: sharedContext.filters,
      groupId: selectedGroupId,
      sectorId: selectedSectorId,
      districtId: selectedDistrictId,
      criterion: sharedContext.criterion,
      mode: path === "/mapa" ? "recorrido" : sharedContext.mode,
    };
    writeRouteContext(context);
    navigate(buildRouteContextPath(path, context));
  }

  const hasResults = sectorizationStatus === "success" && sectors.length > 0;
  const groupDistrictCount = sectorizationPayload?.summary?.inputNodes || activeOption?.zonesCount || 0;

  return (
    <MainLayout>
      <section className={`sector-page workspace-page ${mapExpanded ? "sector-map-expanded" : ""}`}>
        <article className="sector-hero-panel">
          <div>
            <h2>Sectorización</h2>
            <span>
              Divide grupos operativos extensos en sectores manejables y visualiza cómo se distribuyen sus distritos para organizar la atención.
            </span>
          </div>
          <div className="sector-hero-summary">
            <div>
              <span>Grupo seleccionado</span>
              <strong>{activeGroup?.groupName || "Sin seleccionar"}</strong>
            </div>
            <div>
              <span>Distritos del grupo</span>
              <strong>{formatNumber(groupDistrictCount)}</strong>
            </div>
            <div>
              <span>Sectores generados</span>
              <strong>{formatNumber(sectors.length)}</strong>
            </div>
          </div>
        </article>

        <article className="sector-controls-panel sector-overview-panel">
          <div className="sector-control-grid">
            <SearchableCombobox
              label="Grupo operativo"
              value={selectedGroupId || "todos"}
              allLabel="Selecciona un grupo"
              options={groupOptions.map((group) => ({
                value: group.groupId,
                label: group.groupName,
              }))}
              onChange={handleGroupChange}
              allowClear={false}
            />
            <button
              type="button"
              className="dashboard-soft-button dashboard-filter-clear"
              onClick={handleClearSectorSelection}
              disabled={!selectedSectorId}
            >
              Limpiar selección
            </button>
          </div>

          {hasResults && (
            <section className="sector-overview-table" aria-labelledby="sector-overview-title">
              <div className="sector-overview-heading">
                <h3 id="sector-overview-title">Sectores generados</h3>
                <span>{formatNumber(sectors.length)} sectores</span>
              </div>
              <div className="sector-overview-list" role="list">
                {sectors.map((sector) => (
                  <button
                    key={sector.id}
                    type="button"
                    aria-pressed={sector.id === activeSector?.id}
                    className={sector.id === activeSector?.id ? "active" : ""}
                    style={{ "--sector-color": sector.color }}
                    onClick={() => {
                      setSelectedSectorId(sector.id);
                      setSelectedDistrictId("");
                      setMapFocusTick((current) => current + 1);
                    }}
                  >
                    <span className="sector-overview-name">{sector.nombre}</span>
                    <span>{formatNumber(sector.cantidad_zonas)} distritos</span>
                    <span>{formatNumber(sector.interrupciones)} interrupciones</span>
                    <span className={badgeClass(sector.criticidad)}>{sector.criticidad}</span>
                    <span>{sector.priorityLabel}</span>
                    <span>{sector.nearestOrigin?.prestador || "Sin EPS"}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </article>

        {sectorizationStatus === "idle" && (
          <article className="sector-state-panel empty-state">
            Selecciona un grupo operativo para generar sus sectores.
          </article>
        )}

        {sectorizationStatus === "loading" && (
          <article className="sector-state-panel local-route-status">
            Generando sectores de {activeOption?.groupName || selectedGroupId}...
          </article>
        )}

        {sectorizationStatus === "error" && (
          <article className="sector-state-panel local-route-status error">
            <span>{sectorizationError || "No fue posible sectorizar este grupo."}</span>
            <button type="button" onClick={() => setSectorizationRetryToken((current) => current + 1)}>
              Reintentar
            </button>
          </article>
        )}

        {sectorizationStatus === "empty" && (
          <article className="sector-state-panel empty-state">
            No fue posible sectorizar este grupo.
          </article>
        )}

        {hasResults && <section className="sector-detail-layout">
          <div className="sector-detail-map">
            <SectorMap
              group={activeGroup}
              sectors={sectors}
              activeSector={activeSector}
              selectedDistrictId={selectedDistrictId}
              epsOrigin={activeSector?.nearestOrigin}
              mapFocusKey={mapFocusKey}
              showLegend={showLegend}
              showOtherLayers={showOtherLayers}
              mapExpanded={mapExpanded}
              onCenter={() => setMapFocusTick((current) => current + 1)}
              onToggleExpanded={() => setMapExpanded((current) => !current)}
              onToggleLayers={() => setShowOtherLayers((current) => !current)}
              onToggleLegend={() => setShowLegend((current) => !current)}
              onSelectSector={setSelectedSectorId}
              onSelectDistrict={setSelectedDistrictId}
            />
          </div>

          <aside className="sector-detail-panel">
            {!activeSector ? (
              <div className="empty-state">
                Selecciona un sector para revisar su detalle.
              </div>
            ) : (
              <>
                <div className="sector-detail-heading">
                  <span>Sector seleccionado</span>
                  <h3>{activeSector.nombre}</h3>
                </div>
                <div className="sector-context-actions">
                  <button
                    type="button"
                    className="dashboard-soft-button"
                    aria-label="Ver sector seleccionado en mapa operativo"
                    disabled={!activeSector}
                    onClick={() => openContext("/mapa")}
                  >
                    Ver en mapa
                  </button>
                  <button
                    type="button"
                    className="dashboard-soft-button"
                    aria-label="Explorar sector seleccionado localmente"
                    disabled={!activeSector}
                    onClick={() => openContext("/exploracion-local")}
                  >
                    Explorar localmente
                  </button>
                </div>
                <span className={badgeClass(activeSector.criticidad)}>{activeSector.criticidad}</span>
                <div className="sector-detail-grid">
                  <div>
                    <span>Prioridad</span>
                    <strong>{activeSector.priorityLabel}</strong>
                  </div>
                  <div>
                    <span>Distritos</span>
                    <strong>{formatNumber(activeSector.cantidad_zonas)}</strong>
                  </div>
                  <div>
                    <span>Interrupciones</span>
                    <strong>{formatNumber(activeSector.interrupciones)}</strong>
                  </div>
                  <div>
                    <span>Afectaciones estimadas acumuladas</span>
                    <strong>{formatNumber(activeSector.estimatedPopulation)}</strong>
                  </div>
                </div>

                <div className="sector-eps-card">
                  <span>EPS de referencia</span>
                  <strong>{activeSector.nearestOrigin?.prestador || "No disponible"}</strong>
                  <small>Distancia aproximada: {formatKm(activeSector.nearestOriginDistanceKm)}</small>
                  {activeSector.nearestOriginDistanceKm > 60 && (
                    <small>Referencia más cercana disponible.</small>
                  )}
                </div>

                <div className="sector-zone-list">
                  <span>Distritos del sector</span>
                  <div>
                    {activeSector.districts.map((district) => (
                      <button
                        key={district.id}
                        type="button"
                        className={district.id === selectedDistrictId ? "active" : ""}
                        onClick={() => {
                          setSelectedDistrictId(district.id);
                          setMapFocusTick((current) => current + 1);
                        }}
                      >
                        {district.nombre}
                      </button>
                    ))}
                  </div>
                  {selectedDistrictId && (
                    <small>
                      Distrito seleccionado:{" "}
                      {activeSector.districts.find((district) => district.id === selectedDistrictId)?.nombre ||
                        "No disponible"}
                    </small>
                  )}
                </div>
              </>
            )}
          </aside>
        </section>}

      </section>
    </MainLayout>
  );
}
