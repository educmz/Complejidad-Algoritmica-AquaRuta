import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import MainLayout from "../components/layout/MainLayout";
import AquaMap from "../components/map/AquaMap";
import { aquaRutaData } from "../data/aquaRutaData";

const CRITERIA = {
  distancia: "menor distancia",
  tiempo: "menor tiempo",
  costo: "menor costo",
};

function formatNumber(value, digits = 2) {
  return Number(value || 0).toLocaleString("es-PE", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function formatWeight(value, criterion) {
  const numeric = Number(value || 0);
  if (criterion === "tiempo") return `${formatNumber(numeric * 60, 1)} min`;
  if (criterion === "costo") return `S/ ${formatNumber(numeric * 120, 2)}`;
  return `${formatNumber(numeric * 111.32, 1)} km aprox.`;
}

function sectorOptionsFromGroup(group) {
  return Object.values(group?.sectors || {}).sort((a, b) =>
    a.sectorName.localeCompare(b.sectorName)
  );
}

export default function ExploracionLocal() {
  const [searchParams] = useSearchParams();
  const localGraphs = useMemo(() => aquaRutaData.localGraphs || {}, []);
  const requestedGroupId = searchParams.get("grupo") || "";
  const requestedCriterion = searchParams.get("criterio") || "distancia";

  const groupOptions = useMemo(
    () => Object.values(localGraphs).sort((a, b) => a.groupName.localeCompare(b.groupName)),
    [localGraphs]
  );
  const [selectedGroupId, setSelectedGroupId] = useState(
    localGraphs[requestedGroupId]?.groupId || groupOptions[0]?.groupId || ""
  );
  const [selectedSectorKey, setSelectedSectorKey] = useState("");
  const [criterion, setCriterion] = useState(
    Object.keys(CRITERIA).includes(requestedCriterion) ? requestedCriterion : "distancia"
  );

  const selectedGroup = localGraphs[selectedGroupId] || groupOptions[0] || null;
  const sectorOptions = useMemo(() => sectorOptionsFromGroup(selectedGroup), [selectedGroup]);
  const selectedSector =
    sectorOptions.find((sector) => sector.sectorKey === selectedSectorKey) ||
    sectorOptions[0] ||
    null;
  const selectedRoute = selectedSector?.routes?.[criterion] || null;
  const sequenceNodes = selectedRoute?.best_order || [];
  const routePoints = selectedRoute?.route_points || [];
  const originNode = selectedSector?.originNode || null;
  const orderMap = new Map(sequenceNodes.map((node, index) => [node.id, index + 1]));
  const districtPoints = [
    ...(originNode ? [{ ...originNode, mapOrder: "0" }] : []),
    ...(selectedSector?.nodes || []).map((node) => ({
      ...node,
      isVisited: orderMap.has(node.id),
      mapOrder: orderMap.get(node.id) || null,
    })),
  ];
  const selectedOrigin = selectedSector?.origin || null;
  const sequenceEdges = selectedRoute?.route_edges || [];
  const graphEdges = [...(selectedSector?.edges || []), ...sequenceEdges];

  return (
    <MainLayout>
      <section className="page-section local-explorer-page">
        <article className="page-card local-explorer-hero">
          <div>
            <h2 className="page-title">Exploracion local</h2>
            <p className="page-subtitle">
              Subgrafo del sector y secuencia TSP generada con memorizacion en Python.
            </p>
          </div>
          <div className="local-hero-grid">
            <div>
              <span>Sector seleccionado</span>
              <strong>{selectedSector?.sectorName || "No disponible"}</strong>
            </div>
            <div>
              <span>Criterio activo</span>
              <strong>{CRITERIA[criterion]}</strong>
            </div>
            <div>
              <span>Nodo inicial</span>
              <strong>{originNode?.nombre || "No disponible"}</strong>
            </div>
          </div>
        </article>

        <article className="panel local-control-panel">
          <h3 className="panel-title">Controles locales</h3>
          <p className="panel-subtitle">
            Selecciona grupo y sector para armar el subgrafo completo y la mejor secuencia.
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
              <span className="control-label">Sector local</span>
              <select
                className="control-select"
                value={selectedSector?.sectorKey || ""}
                onChange={(event) => setSelectedSectorKey(event.target.value)}
              >
                {sectorOptions.map((sector) => (
                  <option key={sector.sectorKey} value={sector.sectorKey}>
                    {sector.sectorName} - {sector.nodes.length} zonas
                  </option>
                ))}
              </select>
            </label>

            <label className="control-group">
              <span className="control-label">Criterio activo</span>
              <select
                className="control-select"
                value={criterion}
                onChange={(event) => setCriterion(event.target.value)}
              >
                {Object.entries(CRITERIA).map(([id, label]) => (
                  <option key={id} value={id}>
                    Ruta por {label}
                  </option>
                ))}
              </select>
            </label>

            <div className="local-metric-card">
              <span>Valor total estimado</span>
              <strong>{formatWeight(selectedRoute?.total_distance, criterion)}</strong>
            </div>
          </div>
        </article>

        <section className="local-explorer-layout">
          <div className="local-map-panel">
            <AquaMap
              mapTitle="Mapa de exploracion local"
              mapSubtitle="Subgrafo del sector y secuencia TSP numerada desde EPS."
              origins={selectedOrigin ? [selectedOrigin] : []}
              districtPoints={districtPoints}
              activeCenter={selectedSector?.sectorCenter || null}
              routePoints={routePoints}
              routeColor="#16a34a"
              graphEdges={graphEdges}
              highlightedPathEdges={sequenceEdges}
              showEdgeWeights
              edgeWeightLabel="Peso local"
              showDistrictMarkers
              height={760}
            />
          </div>

          <article className="panel local-summary-panel">
            <h3 className="panel-title">Resumen local</h3>
            <div className="local-summary-groups">
              <section className="local-summary-group">
                <strong>Subgrafo del sector</strong>
                <div className="local-summary-grid compact">
                  <div>
                    <span>Nodos</span>
                    <strong>{selectedSector?.nodes?.length || 0}</strong>
                  </div>
                  <div>
                    <span>Aristas</span>
                    <strong>{selectedSector?.edges?.length || 0}</strong>
                  </div>
                  <div>
                    <span>Estados TSP</span>
                    <strong>{selectedRoute?.explored_states || 0}</strong>
                  </div>
                  <div>
                    <span>Valor</span>
                    <strong>{formatWeight(selectedRoute?.total_distance, criterion)}</strong>
                  </div>
                </div>
              </section>

              <section className="local-summary-group">
                <strong>Mejor orden</strong>
                <div className="local-route-list">
                  {originNode && (
                    <button type="button">
                      <strong>0. {originNode.nombre}</strong>
                      <small>Nodo inicial EPS</small>
                    </button>
                  )}
                  {sequenceNodes.map((node, index) => (
                    <button key={node.id} type="button">
                      <strong>{index + 1}. {node.nombre}</strong>
                      <small>{node.interrupciones?.toLocaleString("es-PE") || 0} interrupciones</small>
                    </button>
                  ))}
                </div>
              </section>
            </div>
          </article>
        </section>
      </section>
    </MainLayout>
  );
}
