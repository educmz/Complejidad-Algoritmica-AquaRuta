import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Circle,
  CircleMarker,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import MainLayout from "../components/layout/MainLayout";
import { aquaRutaData } from "../data/aquaRutaData";
import { epsCoverageStatus, epsRequiresValidation } from "../utils/epsCoverage";

const criterionOptions = {
  geografico: {
    label: "Geográfico",
    source: "geografico",
    help: "Agrupa zonas cercanas para que cada sector sea compacto en el territorio.",
  },
  balanceado: {
    label: "Balanceado",
    source: "mixto",
    help: "Combina cercanía territorial con una carga de interrupciones más pareja.",
  },
  carga: {
    label: "Por carga",
    source: "carga",
    help: "Distribuye interrupciones acumuladas para evitar sectores demasiado pesados.",
  },
  continuidad: {
    label: "Continuidad territorial",
    source: "geografico",
    help: "Prioriza sectores continuos y fáciles de recorrer como área de intervención.",
  },
  densidad: {
    label: "Por densidad",
    source: "mixto",
    help: "Favorece sectores compactos cuando hay concentración de zonas afectadas.",
  },
};

const DEFAULT_SECTOR_CRITERION = criterionOptions.balanceado.source;
const priorityRank = { critica: 4, alta: 3, media: 2, baja: 1 };
const sectorColors = ["#2563eb", "#0f766e", "#ea580c", "#7c3aed", "#0891b2", "#be123c"];

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

function balanceStatus(sectors, groupInterruptions, groupZones) {
  if (!sectors.length) {
    return {
      label: "Sin sectores",
      tone: "neutral",
      recommendation: "Sin sectores comparables",
      diffInterruptions: 0,
      diffZones: 0,
      spreadPct: 0,
    };
  }

  const loads = sectors.map((sector) => Number(sector.interrupciones || 0));
  const zones = sectors.map((sector) => Number(sector.cantidad_zonas || 0));
  const maxLoad = Math.max(...loads);
  const minLoad = Math.min(...loads);
  const maxZones = Math.max(...zones);
  const minZones = Math.min(...zones);
  const idealLoad = Number(groupInterruptions || 0) / Math.max(1, sectors.length);
  const spreadPct = idealLoad ? ((maxLoad - minLoad) / idealLoad) * 100 : 0;
  const zoneSpreadPct = groupZones ? ((maxZones - minZones) / groupZones) * 100 : 0;
  const fragmentation = sectors.length >= 4 ? 18 : sectors.length === 3 ? 8 : 0;
  const score = spreadPct + zoneSpreadPct + fragmentation;

  if (score <= 35) {
    return {
      label: "Carga equilibrada",
      tone: "good",
      recommendation: "Distribucion de carga: equilibrada",
      diffInterruptions: maxLoad - minLoad,
      diffZones: maxZones - minZones,
      spreadPct,
    };
  }

  if (score <= 75) {
    return {
      label: "Balance moderado",
      tone: "warning",
      recommendation: "Distribucion de carga: moderada",
      diffInterruptions: maxLoad - minLoad,
      diffZones: maxZones - minZones,
      spreadPct,
    };
  }

  return {
    label: sectors.length >= 4 ? "Carga dispersa" : "Carga desigual entre sectores",
    tone: "danger",
    recommendation: "Distribucion de carga: desigual",
    diffInterruptions: maxLoad - minLoad,
    diffZones: maxZones - minZones,
    spreadPct,
  };
}

function sectorPriority(sector, index) {
  if (sector.criticidad === "critica") return "Atención inmediata";
  if (sector.criticidad === "alta" || index === 0) return "Alta prioridad";
  if (sector.criticidad === "media") return "Programar cobertura";
  return "Seguimiento";
}

function sectorRadius(sector) {
  const points = sector.districts?.map((district) => district.center).filter(validCenter) || [];
  if (!validCenter(sector.center) || !points.length) return 4500;
  const maxDistance = Math.max(
    2.5,
    ...points.map((center) => distanceKm(center, { lat: sector.center[0], lon: sector.center[1] }))
  );
  return Math.min(60000, Math.max(4500, maxDistance * 1200));
}

function epsIcon() {
  return L.divIcon({
    className: "",
    html: `
      <div style="
        align-items:center;
        background:#0f766e;
        border:2px solid white;
        border-radius:8px;
        box-shadow:0 8px 18px rgba(15,23,42,.2);
        color:white;
        display:flex;
        font:900 10px Inter, Arial, sans-serif;
        height:32px;
        justify-content:center;
        width:38px;
      ">EPS</div>
    `,
    iconAnchor: [19, 16],
    iconSize: [38, 32],
  });
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
    fitMapToPoints(map, focusPoints, { maxZoom: 12 });
  }, [focusKey, focusPoints, map]);

  return null;
}

function SectorMap({
  group,
  sectors,
  activeSector,
  epsOrigin,
  mapFocusKey,
  onSelectSector,
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
      ...(activeSector?.districts?.map((district) => district.center) || []),
      ...(epsOrigin ? [[epsOrigin.lat, epsOrigin.lon]] : []),
    ],
    [activeSector, epsOrigin]
  );
  const visibleSectors = sectors;
  const initialCenter = groupPoints[0] || [-12.0464, -77.0428];

  return (
    <article className="sector-map-panel">
      <div className="sector-map-heading">
        <div>
          <h3>Mapa del sector seleccionado</h3>
          <p>{activeSector?.nombre || "Selecciona un sector"}</p>
        </div>
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

          {visibleSectors.map((sector) => {
            const color = sector.color;
            const isActive = sector.id === activeSector?.id;
            return (
              <Circle
                key={`sector-area-${sector.id}`}
                center={sector.center}
                radius={sector.radius}
                eventHandlers={{ click: () => onSelectSector(sector.id) }}
                pathOptions={{
                  color,
                  fillColor: color,
                  fillOpacity: isActive ? 0.045 : 0.012,
                  opacity: isActive ? 0.42 : 0.18,
                  weight: isActive ? 2 : 1,
                }}
              >
                <Tooltip direction="top" opacity={0.95}>
                  {sector.nombre}: {formatNumber(sector.interrupciones)} interrupciones
                </Tooltip>
              </Circle>
            );
          })}

          {visibleSectors.flatMap((sector) =>
            sector.districts.map((district) => {
              const isActive = sector.id === activeSector?.id;
              return (
                <CircleMarker
                  key={`${sector.id}-${district.id}`}
                  center={district.center}
                  radius={isActive ? 8 : 6}
                  eventHandlers={{ click: () => onSelectSector(sector.id) }}
                  pathOptions={{
                    color: isActive ? "#0f172a" : sector.color,
                    fillColor: sector.color,
                    fillOpacity: isActive ? 0.9 : 0.58,
                    weight: isActive ? 2.5 : 1.5,
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

          {epsOrigin && (
            <Marker position={[epsOrigin.lat, epsOrigin.lon]} icon={epsIcon()}>
              <Popup>
                <strong>{epsOrigin.prestador}</strong>
                <br />
                EPS de referencia para el sector activo
              </Popup>
            </Marker>
          )}
        </MapContainer>
      </div>
    </article>
  );
}

export default function Sectorizacion() {
  const [searchParams] = useSearchParams();
  const sectorizedZones = useMemo(() => aquaRutaData.sectorizedZones || {}, []);
  const districts = useMemo(() => aquaRutaData.districts || [], []);
  const epsOrigins = useMemo(() => aquaRutaData.epsOrigins || [], []);

  const districtMap = useMemo(
    () => new Map(districts.map((district) => [district.id, district])),
    [districts]
  );

  const groupIds = Object.keys(sectorizedZones);
  const requestedGroupId = searchParams.get("grupo") || "";
  const requestedSectorCount = searchParams.get("sectores") || "3";

  const [selectedGroupId, setSelectedGroupId] = useState(
    groupIds.includes(requestedGroupId) ? requestedGroupId : groupIds[0] || ""
  );
  const [sectorCount, setSectorCount] = useState(requestedSectorCount);
  const [selectedSectorId, setSelectedSectorId] = useState("");

  const activeGroup = sectorizedZones[selectedGroupId] || null;
  const sourceCriterion = activeGroup?.criterios?.[DEFAULT_SECTOR_CRITERION]
    ? DEFAULT_SECTOR_CRITERION
    : Object.keys(activeGroup?.criterios || {})[0] || "geografico";

  const availableSectorCounts = useMemo(() => {
    if (!activeGroup) return [];
    return Object.keys(activeGroup.criterios?.[sourceCriterion] || {});
  }, [activeGroup, sourceCriterion]);

  const effectiveSectorCount = useMemo(() => {
    if (!availableSectorCounts.length) return "";
    if (availableSectorCounts.includes(sectorCount)) return sectorCount;
    return availableSectorCounts[availableSectorCounts.length - 1];
  }, [availableSectorCounts, sectorCount]);

  const rawSectors = useMemo(() => {
    if (!activeGroup || !effectiveSectorCount) return [];
    return activeGroup.criterios?.[sourceCriterion]?.[effectiveSectorCount] || [];
  }, [activeGroup, effectiveSectorCount, sourceCriterion]);

  const comparison = useMemo(
    () =>
      balanceStatus(
        rawSectors,
        activeGroup?.groupInterruptions || 0,
        activeGroup?.groupZonesCount || 0
      ),
    [activeGroup, rawSectors]
  );

  const sectors = useMemo(() => {
    const totalInterruptions = Math.max(1, Number(activeGroup?.groupInterruptions || 0));
    return rawSectors.map((sector, index) => {
      const districtsInSector = (sector.zona_ids || [])
        .map((id) => districtMap.get(id))
        .filter((district) => district && validCenter(district.center));
      const estimatedPopulation = districtsInSector.reduce(
        (acc, district) => acc + Number(district.unidades_afectadas || 0),
        0
      );
      const connections = districtsInSector.reduce(
        (acc, district) => acc + Number(district.conexiones_afectadas || 0),
        0
      );
      const nearest = nearestOrigin(sector.center, epsOrigins);
      const epsCoverage = epsCoverageStatus(nearest.distance);
      const loadPct = (Number(sector.interrupciones || 0) / totalInterruptions) * 100;
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
        epsCoverage,
        loadPct,
        balanceRelative:
          loadPct > 45 ? "Carga alta" : loadPct < 18 ? "Carga liviana" : "Carga equilibrada",
        priorityLabel: sectorPriority(sector, index),
        radius: sectorRadius({ ...sector, districts: districtsInSector }),
        mainDistrict: districtsInSector[0] || null,
      };
    });
  }, [activeGroup, districtMap, epsOrigins, rawSectors]);

  const activeSector = useMemo(() => {
    if (!sectors.length) return null;
    return sectors.find((sector) => sector.id === selectedSectorId) || sectors[0];
  }, [sectors, selectedSectorId]);

  const mostLoaded = sectors.reduce(
    (best, sector) => (!best || sector.interrupciones > best.interrupciones ? sector : best),
    null
  );
  const leastLoaded = sectors.reduce(
    (best, sector) => (!best || sector.interrupciones < best.interrupciones ? sector : best),
    null
  );
  const urgentSector = [...sectors].sort(
    (a, b) =>
      (priorityRank[b.criticidad] || 0) - (priorityRank[a.criticidad] || 0) ||
      b.interrupciones - a.interrupciones
  )[0];

  const mapFocusKey = [
    selectedGroupId,
    effectiveSectorCount,
    activeSector?.id || "",
  ].join("|");

  function handleGroupChange(groupId) {
    setSelectedGroupId(groupId);
    setSelectedSectorId("");
  }

  function handleSectorCountChange(value) {
    setSectorCount(value);
    setSelectedSectorId("");
  }

  return (
    <MainLayout>
      <section className="sector-page">
        <article className="sector-hero-panel">
          <div>
            <h2>Sectorización</h2>
            <span>
              Divide un grupo operativo grande en sectores más pequeños para priorizar la atención.
            </span>
            <small>
              Un sector reúne zonas cercanas del mismo grupo para repartir carga, priorizar atención
              y revisar cobertura EPS.
            </small>
          </div>
          <div className="sector-hero-summary">
            <div>
              <span>Sectores generados</span>
              <strong>{formatNumber(sectors.length)}</strong>
            </div>
            <div>
              <span>Sector recomendado para atender primero</span>
              <strong>{urgentSector?.nombre || "S/D"}</strong>
            </div>
          </div>
        </article>

        <article className="sector-controls-panel">
          <div className="sector-control-grid">
            <label className="control-group">
              <span className="control-label">Grupo operativo</span>
              <select
                className="control-select"
                value={selectedGroupId}
                onChange={(event) => handleGroupChange(event.target.value)}
              >
                {Object.values(sectorizedZones).map((group) => (
                  <option key={group.groupId} value={group.groupId}>
                    {group.groupName}
                  </option>
                ))}
              </select>
            </label>
            <label className="control-group">
              <span className="control-label">Número de sectores a generar</span>
              <select
                className="control-select"
                value={effectiveSectorCount}
                onChange={(event) => handleSectorCountChange(event.target.value)}
              >
                {availableSectorCounts.map((count) => (
                  <option key={count} value={count}>
                    {count} sectores
                  </option>
                ))}
              </select>
            </label>
          </div>

        </article>

        <section className="sector-comparison-grid">
          <article className="sector-summary-panel">
            <h3>Resumen comparativo</h3>
            <div className="sector-summary-grid">
              <div>
                <span>Mayor carga</span>
                <strong>{mostLoaded?.nombre || "S/D"}</strong>
                <small>{formatNumber(mostLoaded?.interrupciones)} interrupciones</small>
              </div>
              <div>
                <span>Menos cargado</span>
                <strong>{leastLoaded?.nombre || "S/D"}</strong>
                <small>{formatNumber(leastLoaded?.interrupciones)} interrupciones</small>
              </div>
              <div>
                <span>Diferencia respecto a la carga esperada</span>
                <strong>{formatNumber(comparison.diffInterruptions)}</strong>
                <small>{comparison.spreadPct.toFixed(1)}% frente a una distribución equilibrada</small>
              </div>
            </div>
          </article>

          <article className="sector-table-panel">
            <div className="sector-table-heading">
              <div>
                <h3>Sectores generados</h3>
                <p>
                  Selecciona un sector para ver sus zonas, su carga de interrupciones y su EPS de
                  referencia.
                </p>
              </div>
            </div>

            <div className="sector-table-scroll">
              <table className="sector-table">
                <thead>
                  <tr>
                    <th>Sector</th>
                    <th>Zonas</th>
                    <th>Interrupciones</th>
                    <th>Criticidad</th>
                    <th>Prioridad</th>
                    <th>Participación de carga</th>
                    <th>EPS de referencia</th>
                  </tr>
                </thead>
                <tbody>
                  {sectors.map((sector) => (
                    <tr
                      key={sector.id}
                      className={sector.id === activeSector?.id ? "active" : ""}
                      onClick={() => setSelectedSectorId(sector.id)}
                    >
                      <td>
                        <button type="button" onClick={() => setSelectedSectorId(sector.id)}>
                          <strong>{sector.nombre}</strong>
                        </button>
                      </td>
                      <td>{formatNumber(sector.cantidad_zonas)}</td>
                      <td>{formatNumber(sector.interrupciones)}</td>
                      <td><span className={badgeClass(sector.criticidad)}>{sector.criticidad}</span></td>
                      <td>{sector.priorityLabel}</td>
                      <td>{sector.loadPct.toFixed(1)}%</td>
                      <td>
                        {sector.nearestOrigin?.prestador || "No disponible"}
                        <small>{formatKm(sector.nearestOriginDistanceKm)}</small>
                        <span className={`territory-eps-status ${sector.epsCoverage.key}`}>
                          {sector.epsCoverage.label}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!sectors.length && (
                <div className="empty-state">
                  Selecciona un grupo sectorizable para generar o revisar sectores.
                </div>
              )}
            </div>
          </article>
        </section>

        <section className="sector-detail-layout">
          <div className="sector-detail-map">
            <SectorMap
              group={activeGroup}
              sectors={sectors}
              activeSector={activeSector}
              epsOrigin={activeSector?.nearestOrigin}
              mapFocusKey={mapFocusKey}
              onSelectSector={setSelectedSectorId}
            />
          </div>

          <aside className="sector-detail-panel">
            {!activeSector ? (
              <div className="empty-state">
                No sectorizable: este grupo no cuenta con suficientes nodos georreferenciados para
                dividirse en sectores.
              </div>
            ) : (
              <>
                <div className="sector-detail-heading">
                  <span>Sector seleccionado</span>
                  <h3>{activeSector.nombre}</h3>
                </div>
                <span className={badgeClass(activeSector.criticidad)}>{activeSector.criticidad}</span>
                <div className="sector-detail-grid">
                  <div>
                    <span>Prioridad</span>
                    <strong>{activeSector.priorityLabel}</strong>
                  </div>
                  <div>
                    <span>Zonas</span>
                    <strong>{formatNumber(activeSector.cantidad_zonas)}</strong>
                  </div>
                  <div>
                    <span>Interrupciones</span>
                    <strong>{formatNumber(activeSector.interrupciones)}</strong>
                  </div>
                  <div>
                    <span>Participación de carga</span>
                    <strong>{activeSector.loadPct.toFixed(1)}%</strong>
                  </div>
                </div>

                <div className="sector-eps-card">
                  <span>EPS de referencia</span>
                  <strong>{activeSector.nearestOrigin?.prestador || "No disponible"}</strong>
                  <small>{formatKm(activeSector.nearestOriginDistanceKm)} al centro del sector</small>
                  <span className={`territory-eps-status ${activeSector.epsCoverage.key}`}>
                    {activeSector.epsCoverage.label}
                  </span>
                </div>

                {epsRequiresValidation(activeSector.epsCoverage) && (
                  <div className="territory-route-status warning">
                    <strong>Validación operativa requerida</strong>
                    <span>
                      La EPS de referencia debe revisarse antes de usarla como origen de atención.
                    </span>
                  </div>
                )}

                <p className="territory-context-note">
                  Este sector pertenece al grupo operativo seleccionado y contiene las zonas que
                  aparecen listadas. La carga representa su proporción de interrupciones respecto
                  al total del grupo.
                </p>

                <div className="sector-zone-list">
                  <span>Zonas del sector</span>
                  <div>
                    {activeSector.zonas.map((zone) => (
                      <button key={zone} type="button">{zone}</button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </aside>
        </section>
      </section>
    </MainLayout>
  );
}
