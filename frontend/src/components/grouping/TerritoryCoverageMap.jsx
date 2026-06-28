import { useEffect, useMemo, useRef, useState } from "react";
import {
  CircleMarker,
  GeoJSON,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import EpsMapMarker from "../map/EpsMapMarker";

const priorityColors = {
  critica: { stroke: "#991b1b", fill: "#dc2626" },
  alta: { stroke: "#9a3412", fill: "#ea580c" },
  media: { stroke: "#92400e", fill: "#f59e0b" },
  baja: { stroke: "#0f766e", fill: "#14b8a6" },
};

const routeColors = ["#2563eb", "#0f766e", "#7c3aed", "#0891b2", "#1d4ed8"];

function blockIcon(block, isActive) {
  const colors = priorityColors[block.criticidad] || priorityColors.baja;
  return L.divIcon({
    className: "",
    html: `
      <div style="
        align-items:center;
        background:${colors.fill};
        border:${isActive ? "3px" : "2px"} solid white;
        border-radius:999px;
        box-shadow:0 8px 20px rgba(15,23,42,.2);
        color:white;
        display:flex;
        font:900 11px Inter, Arial, sans-serif;
        height:${isActive ? "42px" : "34px"};
        justify-content:center;
        width:${isActive ? "42px" : "34px"};
      ">${block.cantidad_zonas}</div>
    `,
    iconAnchor: [isActive ? 21 : 17, isActive ? 21 : 17],
    iconSize: [isActive ? 42 : 34, isActive ? 42 : 34],
  });
}

function validLatLngs(points) {
  return points.filter(
    (point) =>
      Array.isArray(point) &&
      point.length === 2 &&
      Number.isFinite(point[0]) &&
      Number.isFinite(point[1])
  );
}

function geoJsonLatLngs(geoJson) {
  const coordinates = geoJson?.features?.flatMap((feature) => {
    const geometry = feature?.geometry;
    if (geometry?.type === "LineString") return geometry.coordinates || [];
    if (geometry?.type === "MultiLineString") return geometry.coordinates?.flat() || [];
    return [];
  });

  return (coordinates || [])
    .map((point) => [point[1], point[0]])
    .filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]));
}

function fitMapToPoints(map, points, options = {}) {
  const validPoints = validLatLngs(points);
  if (!validPoints.length) return;

  if (validPoints.length === 1) {
    map.setView(validPoints[0], options.zoom || 11);
    return;
  }

  map.fitBounds(validPoints, {
    padding: options.padding || [36, 36],
    maxZoom: options.maxZoom || 12,
  });
}

function MapViewportController({
  focusKey,
  focusPoints,
  routeKey,
  routePoints,
}) {
  const map = useMap();
  const lastFocusKeyRef = useRef("");
  const lastRouteKeyRef = useRef("");
  const userHasInteractedRef = useRef(false);

  useMapEvents({
    dragstart: () => {
      userHasInteractedRef.current = true;
    },
    zoomstart: () => {
      userHasInteractedRef.current = true;
    },
  });

  useEffect(() => {
    if (!focusKey || focusKey === lastFocusKeyRef.current) return;
    lastFocusKeyRef.current = focusKey;
    userHasInteractedRef.current = false;
    fitMapToPoints(map, focusPoints);
  }, [focusKey, focusPoints, map]);

  useEffect(() => {
    if (!routeKey || routeKey === lastRouteKeyRef.current) return;
    lastRouteKeyRef.current = routeKey;
    if (!userHasInteractedRef.current) {
      fitMapToPoints(map, routePoints, { maxZoom: 13 });
    }
  }, [map, routeKey, routePoints]);

  return null;
}

function ZoomTracker({ onZoomChange }) {
  const map = useMapEvents({
    zoomend: () => onZoomChange(map.getZoom()),
  });

  useEffect(() => {
    onZoomChange(map.getZoom());
  }, [map, onZoomChange]);

  return null;
}

function routeMarkerStyle(node, routeResult) {
  if (routeResult?.status === "pendiente") {
    return { color: "#64748b", fillColor: "#cbd5e1", dashArray: "4 4" };
  }

  const noConnectionIds = new Set(routeResult?.noConnectionNodes?.map((item) => item.id) || []);
  if (noConnectionIds.has(node.id)) {
    return { color: "#991b1b", fillColor: "#fee2e2", dashArray: "3 5" };
  }

  return { color: "#166534", fillColor: "#ffffff", dashArray: null };
}


export default function TerritoryCoverageMap({
  viewMode,
  blocks,
  nodes,
  epsOrigins,
  activeBlock,
  activeNode,
  routePlan,
  routeResult,
  routeSegments = [],
  routeKey = "",
  routeStatus,
  layers,
  showLegend = true,
  focusVersion = 0,
  mapControls = null,
  onSelectBlock,
  onSelectNode,
}) {
  const [zoom, setZoom] = useState(7);
  const visibleBlocks = blocks.slice(0, 120);
  const activeGroupNodes = useMemo(
    () => activeBlock?.validNodes || activeBlock?.districts?.filter((node) => node.center) || [],
    [activeBlock]
  );
  const visibleNodes = useMemo(() => {
    if (viewMode === "grupos") return activeGroupNodes;
    if (viewMode === "rutas") {
      const routeNodes = [
        ...(routePlan?.stops || []),
        ...(routeResult?.noConnectionNodes || []),
      ];
      return routeNodes.filter(
        (node, index, items) => items.findIndex((item) => item.id === node.id) === index
      );
    }
    if (activeBlock) {
      const activeBlockNodes = nodes.filter(
        (node) => node.blockId === activeBlock.id || activeBlock.districtIds?.has(node.id)
      );
      return activeBlockNodes.length ? activeBlockNodes : activeGroupNodes;
    }
    if (zoom < 8 && !activeBlock) return [];
    return nodes.slice(0, zoom < 9 ? 250 : 1200);
  }, [activeBlock, activeGroupNodes, nodes, routePlan, routeResult, viewMode, zoom]);

  const routeGeoJsonPoints = useMemo(
    () => routeSegments.flatMap((segment) => geoJsonLatLngs(segment.geoJson)),
    [routeSegments]
  );
  const routeStopPoints = useMemo(
    () => [
      routePlan?.origin ? [routePlan.origin.lat, routePlan.origin.lon] : null,
      ...(routePlan?.stops?.map((node) => node.center).filter(Boolean) || []),
      ...(routeResult?.noConnectionNodes?.map((node) => node.center).filter(Boolean) || []),
    ].filter(Boolean),
    [routePlan, routeResult]
  );
  const routeFocusPoints = routeGeoJsonPoints.length ? routeGeoJsonPoints : routeStopPoints;
  const groupFocusPoints = activeGroupNodes.map((node) => node.center).filter(Boolean);
  const focusPoints = [
    ...(viewMode === "rutas" ? routeFocusPoints : []),
    ...(viewMode === "grupos" ? groupFocusPoints : []),
    ...(viewMode === "nodos" && activeNode?.center ? [activeNode.center] : []),
    ...(viewMode === "nodos" && activeBlock ? groupFocusPoints : []),
    ...(viewMode === "grupos" && !activeBlock ? visibleBlocks.map((block) => block.center) : []),
  ].filter(Boolean);
  const focusKey = [
    viewMode,
    activeBlock?.id || "",
    activeNode?.id || "",
    routePlan?.id || "",
    focusVersion,
  ].join("|");
  const initialCenter = focusPoints[0] || [-12.0464, -77.0428];
  const epsToRender =
    viewMode === "rutas" && routePlan?.origin
      ? [routePlan.origin]
      : activeBlock && viewMode === "nodos"
      ? layers.showEps && activeBlock.nearestOrigin
        ? [activeBlock.nearestOrigin]
        : []
      : activeBlock
      ? []
      : epsOrigins.slice(0, 80);

  return (
    <article className="territory-map-card">
      <div className="territory-map-toolbar">
        <div>
          <h3>
            {viewMode === "grupos"
              ? "Grupos y distritos asociados"
              : viewMode === "nodos"
              ? "Distritos del grupo"
              : "Rutas viales"}
          </h3>
          {viewMode === "nodos" && (
            <p>Selecciona un distrito para consultar sus indicadores y localizarlo en el mapa.</p>
          )}
        </div>
        {mapControls}
      </div>

      <div className="territory-map-shell">
        {showLegend && viewMode === "nodos" && (
          <div className="territory-map-legend">
            <span><i className="critical" />Crítica</span>
            <span><i className="high" />Alta</span>
            <span><i className="medium" />Media</span>
            <span><i className="low" />Baja</span>
            <span><i className="selected" />Distrito seleccionado</span>
            <span><i className="eps" />EPS de referencia</span>
          </div>
        )}
        <MapContainer
          center={initialCenter}
          zoom={7}
          scrollWheelZoom={true}
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ZoomTracker onZoomChange={setZoom} />
          <MapViewportController
            focusKey={focusKey}
            focusPoints={focusPoints}
            routeKey={routeKey}
            routePoints={routeFocusPoints}
          />


          {layers.showBlocks &&
            viewMode === "grupos" &&
            visibleBlocks.map((block) => {
              if (!block.center) return null;
              const isActive = activeBlock?.id === block.id;

              return (
                <Marker
                  key={`block-marker-${block.id}`}
                  position={block.center}
                  icon={blockIcon(block, isActive)}
                  eventHandlers={{ click: () => onSelectBlock(block.id) }}
                >
                  <Popup>
                    <strong>{block.nombre}</strong>
                    <br />
                    Distritos: {block.zonas?.slice(0, 4).join(", ")}
                    {block.zonas?.length > 4 ? "..." : ""}
                    <br />
                    EPS de referencia: {block.nearestOrigin?.prestador || "No disponible"}
                  </Popup>
                </Marker>
              );
            })}

          {layers.showNodes &&
            viewMode !== "rutas" &&
            visibleNodes.map((node) => {
              if (
                !Array.isArray(node.center) ||
                node.center.length < 2 ||
                !node.center.every(Number.isFinite)
              ) {
                return null;
              }
              const colors = priorityColors[node.criticidad] || priorityColors.baja;
              const isActive = activeNode?.id === node.id;
              const isActiveGroupNode = activeBlock?.districtIds?.has(node.id);
              const isIndividualGroup =
                activeBlock &&
                ((activeBlock.cantidad_zonas || activeBlock.districts?.length) === 1 ||
                  activeBlock.validNodes?.length === 1);
              const isIsolated = !isIndividualGroup && Boolean(node.ufds?.aislado);
              return (
                <CircleMarker
                  key={node.id}
                  center={node.center}
                  radius={isActive ? 9 : isActiveGroupNode ? 6.5 : 6}
                  eventHandlers={{ click: () => onSelectNode(node.id) }}
                  pathOptions={{
                    color: isIsolated
                      ? "#64748b"
                      : isActive || isActiveGroupNode
                      ? "#0f172a"
                      : colors.stroke,
                    fillColor: isIsolated ? "#e2e8f0" : colors.fill,
                    fillOpacity: isIsolated ? 0.72 : 0.88,
                    dashArray: isIsolated ? "4 4" : null,
                    weight: isActive ? 4 : isActiveGroupNode ? 3 : 2,
                  }}
                >
                  <Tooltip direction="top" opacity={0.92}>
                    {node.nombre} -{" "}
                    {isIndividualGroup
                      ? "grupo individual"
                      : isIsolated
                      ? "revisar integración"
                      : node.blockName || activeBlock?.nombre}
                  </Tooltip>
                  <Popup>
                    <strong>{node.nombre}</strong>
                    <br />
                    Grupo: {node.blockName || activeBlock?.nombre}
                    <br />
                    Integración:{" "}
                    {isIndividualGroup
                      ? "sin enlace requerido"
                      : isIsolated
                      ? "sin conexión suficiente"
                      : "integrado al grupo"}
                    <br />
                    Cercanos evaluados: {node.ufds?.candidatos_evaluados || 0}
                    <br />
                    {node.interrupciones.toLocaleString("es-PE")} interrupciones
                  </Popup>
                </CircleMarker>
              );
            })}

          {layers.showEps &&
            epsToRender.map((origin) => (
              <EpsMapMarker key={origin.id} origin={origin}>
                {viewMode === "rutas" && (
                  <>
                    <br />
                    Origen operativo de la cobertura
                  </>
                )}
              </EpsMapMarker>
            ))}


          {viewMode === "rutas" &&
            layers.showRoutes &&
            routeSegments.map((segment, index) => (
              <GeoJSON
                key={`${routeKey}-${segment.id}`}
                data={segment.geoJson}
                style={{
                  color: routeColors[index % routeColors.length],
                  opacity: 0.92,
                  weight: 5,
                }}
              />
            ))}

          {viewMode === "rutas" &&
            layers.showNodes &&
            visibleNodes.map((node, index) => {
              if (
                !Array.isArray(node.center) ||
                node.center.length < 2 ||
                !node.center.every(Number.isFinite)
              ) {
                return null;
              }
              const markerStyle = routeMarkerStyle(node, routeResult);
              const isActive = activeNode?.id === node.id;
              return (
                <CircleMarker
                  key={`route-node-${node.id}`}
                  center={node.center}
                  radius={isActive ? 9 : 7}
                  eventHandlers={{ click: () => onSelectNode(node.id) }}
                  pathOptions={{
                    ...markerStyle,
                    fillOpacity: 1,
                    weight: isActive ? 4 : 3,
                  }}
                >
                  <Tooltip permanent={index < 16} direction="top" opacity={0.9}>
                    {routeResult?.noConnectionNodes?.some((item) => item.id === node.id)
                      ? "Sin conexión"
                      : index + 1}
                  </Tooltip>
                  <Popup>
                    <strong>{node.nombre}</strong>
                    <br />
                    {routeResult?.noConnectionNodes?.some((item) => item.id === node.id)
                      ? "Nodo sin conexión vial encontrada"
                      : "Nodo cubierto por ruta vial"}
                  </Popup>
                </CircleMarker>
              );
            })}
        </MapContainer>
      </div>

      <div className="territory-map-footer">
        <span>Zoom {zoom}</span>
        <span>
          {viewMode === "grupos"
            ? `${visibleBlocks.length} grupos`
            : activeBlock
            ? `${visibleNodes.length} distritos georreferenciados / ${
                activeBlock.cantidad_zonas || 0
              } ${visibleNodes.length === 0 ? "distritos registrados" : "distritos"}`
            : `${visibleNodes.length} distritos renderizados`}
        </span>
        {viewMode === "rutas" && <strong>{routeStatus}</strong>}
      </div>
    </article>
  );
}
