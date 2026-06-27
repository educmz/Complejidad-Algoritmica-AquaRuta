const DEFAULT_GROUPING_CONFIG = {
  criterio: "combinado",
  umbralDistanciaGeograficaKm: 18,
  umbralDistanciaVialKm: 32,
  umbralTiempoMin: 70,
  umbralCosto: 240,
  velocidadPromedioKmh: 28,
  factorVial: 1.35,
  maxVecinosCandidatos: 12,
  maxRechazosPorNodo: 4,
  maxRechazosGlobales: 250,
};

function normalizeConfig(config = {}) {
  const merged = { ...DEFAULT_GROUPING_CONFIG, ...config };
  const criterio = ["geografico", "vial", "combinado"].includes(merged.criterio)
    ? merged.criterio
    : "combinado";
  return {
    ...merged,
    criterio,
    umbralDistanciaGeograficaKm: Number(merged.umbralDistanciaGeograficaKm) || 0,
    umbralDistanciaVialKm: Number(merged.umbralDistanciaVialKm) || 0,
    umbralTiempoMin: Number(merged.umbralTiempoMin) || 0,
    umbralCosto: Number(merged.umbralCosto) || 0,
    velocidadPromedioKmh: Math.max(Number(merged.velocidadPromedioKmh) || 1, 1),
    factorVial: Math.max(Number(merged.factorVial) || 1, 1),
    maxVecinosCandidatos: Math.max(Number(merged.maxVecinosCandidatos) || 1, 1),
    maxRechazosPorNodo: Math.max(Number(merged.maxRechazosPorNodo) || 1, 1),
    maxRechazosGlobales: Math.max(Number(merged.maxRechazosGlobales) || 1, 1),
  };
}

function zoneName(zone) {
  return String(zone?.nombre || zone?.name || "Zona");
}

function zoneCenter(zone) {
  if (Array.isArray(zone?.center) && zone.center.length === 2) {
    const [lat, lon] = zone.center.map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lon)) return [lat, lon];
  }
  if (Number.isFinite(Number(zone?.lat)) && Number.isFinite(Number(zone?.lon))) {
    return [Number(zone.lat), Number(zone.lon)];
  }
  return null;
}

function distanceKm(centerA, centerB) {
  const [lat1, lon1] = centerA;
  const [lat2, lon2] = centerB;
  const r = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const rLat1 = (lat1 * Math.PI) / 180;
  const rLat2 = (lat2 * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

function groupCriticity(interruptions) {
  if (interruptions >= 500) return "critica";
  if (interruptions >= 200) return "alta";
  if (interruptions >= 50) return "media";
  return "baja";
}

function trafficFactor(zoneA, zoneB) {
  const interruptions = Math.max(
    Number(zoneA?.interrupciones || 0),
    Number(zoneB?.interrupciones || 0)
  );
  const duration = Math.max(
    Number(zoneA?.duracion_promedio_horas || 0),
    Number(zoneB?.duracion_promedio_horas || 0)
  );
  const critScale = {
    critica: 1.2,
    alta: 1.12,
    media: 1.06,
    baja: 1,
  };
  const critA = String(zoneA?.criticidad || "baja").toLowerCase();
  const critB = String(zoneB?.criticidad || "baja").toLowerCase();
  return (
    Math.max(critScale[critA] || 1, critScale[critB] || 1) +
    Math.min(0.25, interruptions / 12000) +
    Math.min(0.15, duration / 240)
  );
}

function roadMetrics(zoneA, zoneB, geoDistance, config) {
  const roadDistance = geoDistance * config.factorVial;
  const traffic = trafficFactor(zoneA, zoneB);
  const durationMin = (roadDistance / config.velocidadPromedioKmh) * 60 * traffic;
  const cost = roadDistance * 4.6 + durationMin * 0.85;
  return {
    distancia_geografica_km: Number(geoDistance.toFixed(3)),
    distancia_vial_estimada_km: Number(roadDistance.toFixed(3)),
    tiempo_estimado_min: Number(durationMin.toFixed(1)),
    costo_estimado: Number(cost.toFixed(1)),
    factor_trafico: Number(traffic.toFixed(3)),
  };
}

function isClose(metrics, config) {
  const geoOk = metrics.distancia_geografica_km <= config.umbralDistanciaGeograficaKm;
  const roadOk = metrics.distancia_vial_estimada_km <= config.umbralDistanciaVialKm;
  if (config.criterio === "geografico") {
    return [geoOk, geoOk ? "distancia geográfica dentro del umbral" : "distancia geográfica fuera del umbral"];
  }
  if (config.criterio === "vial") {
    return [roadOk, roadOk ? "distancia vial estimada dentro del umbral" : "distancia vial estimada fuera del umbral"];
  }
  const close = geoOk || roadOk;
  return [close, close ? "cercanía geográfica o vial válida" : "sin cercanía suficiente"];
}

function hasConnectivity(metrics, config) {
  const roadOk = metrics.distancia_vial_estimada_km <= config.umbralDistanciaVialKm;
  const timeOk = metrics.tiempo_estimado_min <= config.umbralTiempoMin;
  const costOk = metrics.costo_estimado <= config.umbralCosto;
  const reasonableRoute = timeOk && costOk;
  const connected = roadOk || reasonableRoute;
  if (connected) {
    return [
      true,
      roadOk
        ? "conexión vial válida por distancia de red"
        : "ruta razonable válida por tiempo y costo",
    ];
  }
  const reasons = [];
  if (!roadOk) reasons.push("distancia vial excede umbral");
  if (!timeOk) reasons.push("tiempo excede umbral");
  if (!costOk) reasons.push("costo excede umbral");
  return [false, reasons.join(", ")];
}

function evaluateConnection(zoneA, zoneB, config) {
  const centerA = zoneCenter(zoneA);
  const centerB = zoneCenter(zoneB);
  if (!centerA || !centerB) {
    return {
      shouldUnion: false,
      reason: "uno o ambos nodos no tienen centro geografico",
      metrics: {},
    };
  }
  const geo = distanceKm(centerA, centerB);
  const metrics = roadMetrics(zoneA, zoneB, geo, config);
  const [close, closeReason] = isClose(metrics, config);
  const [connected, connectReason] = hasConnectivity(metrics, config);
  if (close && connected) {
    return {
      shouldUnion: true,
      reason: `${closeReason}; ${connectReason}`,
      closeReason,
      connectReason,
      metrics,
    };
  }
  if (!close && !connected) {
    return {
      shouldUnion: false,
      reason: `${closeReason}; ${connectReason}`,
      closeReason,
      connectReason,
      metrics,
    };
  }
  return {
    shouldUnion: false,
    reason: close ? connectReason : closeReason,
    closeReason,
    connectReason,
    metrics,
  };
}

class UnionFind {
  constructor(size) {
    this.parent = Array.from({ length: size }, (_, index) => index);
    this.rank = Array(size).fill(0);
  }

  find(x) {
    if (this.parent[x] !== x) this.parent[x] = this.find(this.parent[x]);
    return this.parent[x];
  }

  union(a, b) {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return false;
    if (this.rank[rootA] < this.rank[rootB]) {
      this.parent[rootA] = rootB;
    } else if (this.rank[rootA] > this.rank[rootB]) {
      this.parent[rootB] = rootA;
    } else {
      this.parent[rootB] = rootA;
      this.rank[rootA] += 1;
    }
    return true;
  }
}

function candidateSearchRadius(config) {
  const roadAsGeo = config.umbralDistanciaVialKm / config.factorVial;
  return Math.max(config.umbralDistanciaGeograficaKm, roadAsGeo);
}

function cellFor(center, cellSizeDeg) {
  return [Math.floor(center[0] / cellSizeDeg), Math.floor(center[1] / cellSizeDeg)];
}

function nearbyCells([row, col]) {
  const keys = [];
  for (let dRow = -1; dRow <= 1; dRow += 1) {
    for (let dCol = -1; dCol <= 1; dCol += 1) {
      keys.push([row + dRow, col + dCol]);
    }
  }
  return keys;
}

function candidatePairs(centersByIndex, config) {
  const radiusKm = candidateSearchRadius(config);
  const cellSizeDeg = Math.max(radiusKm / 111, 0.05);
  const grid = new Map();
  const centerEntries = Array.from(centersByIndex.entries());
  centerEntries.forEach(([index, center]) => {
    const key = cellFor(center, cellSizeDeg).join("|");
    const list = grid.get(key) || [];
    list.push(index);
    grid.set(key, list);
  });

  const pairs = new Set();
  centerEntries.forEach(([index, center]) => {
    const candidates = [];
    nearbyCells(cellFor(center, cellSizeDeg)).forEach((keyParts) => {
      const key = keyParts.join("|");
      const neighbors = grid.get(key) || [];
      neighbors.forEach((otherIndex) => {
        if (otherIndex === index) return;
        const dist = distanceKm(center, centersByIndex.get(otherIndex));
        if (dist <= radiusKm) candidates.push([dist, otherIndex]);
      });
    });
    candidates.sort((a, b) => a[0] - b[0]);
    candidates.slice(0, config.maxVecinosCandidatos).forEach(([, otherIndex]) => {
      const [a, b] = index < otherIndex ? [index, otherIndex] : [otherIndex, index];
      pairs.add(`${a}|${b}`);
    });
  });

  return Array.from(pairs).map((value) => value.split("|").map(Number));
}

function nodeSummary(zone, unionCount, candidateCount, rejections) {
  const hasUnions = Number(unionCount || 0) > 0;
  const fallbackRejections =
    !hasUnions && !rejections?.length
      ? [
          {
            source: zone.id,
            sourceName: zoneName(zone),
            target: null,
            targetName: "Sin vecino candidato",
            reason:
              Number(candidateCount || 0) === 0
                ? "no se encontraron vecinos cercanos dentro de los umbrales configurados"
                : "no se encontró unión válida con los vecinos candidatos evaluados",
            metrics: {},
          },
        ]
      : rejections || [];

  return {
    id: zone.id,
    nombre: zoneName(zone),
    center: zoneCenter(zone),
    criticidad: zone.criticidad || "baja",
    interrupciones: Number(zone.interrupciones || 0),
    uniones_validas: Number(unionCount || 0),
    candidatos_evaluados: Number(candidateCount || 0),
    rechazos_muestra: fallbackRejections,
    aislado: !hasUnions,
  };
}

function buildGroups(zones, ufds, explainability, config) {
  const groupedIndices = new Map();
  zones.forEach((_, index) => {
    const root = ufds.find(index);
    const list = groupedIndices.get(root) || [];
    list.push(index);
    groupedIndices.set(root, list);
  });

  const groups = [];
  const {
    unionEdges,
    perNodeUnionCount,
    perNodeCandidateCount,
    perNodeRejections,
  } = explainability;
  Array.from(groupedIndices.values()).forEach((indices, position) => {
    const groupZones = indices.map((idx) => zones[idx]);
    const zoneIds = new Set(groupZones.map((zone) => zone.id));
    const interruptions = groupZones.reduce(
      (acc, zone) => acc + Number(zone.interrupciones || 0),
      0
    );
    const centers = groupZones.map(zoneCenter).filter(Boolean);
    const center = centers.length
      ? [
          Number((centers.reduce((acc, c) => acc + c[0], 0) / centers.length).toFixed(6)),
          Number((centers.reduce((acc, c) => acc + c[1], 0) / centers.length).toFixed(6)),
        ]
      : null;
    const departamentos = [
      ...new Set(groupZones.map((zone) => String(zone.departamento || "").trim()).filter(Boolean)),
    ].sort();
    const provincias = [
      ...new Set(groupZones.map((zone) => String(zone.provincia || "").trim()).filter(Boolean)),
    ].sort();
    const groupEdges = unionEdges.filter(
      (edge) => zoneIds.has(edge.source) && zoneIds.has(edge.target)
    );
    const nodes = groupZones.map((zone) =>
      nodeSummary(
        zone,
        perNodeUnionCount.get(zone.id) || 0,
        perNodeCandidateCount.get(zone.id) || 0,
        perNodeRejections.get(zone.id) || []
      )
    );
    const isolatedNodes = nodes.filter((node) => node.aislado);

    groups.push({
      id: `grupo-${position + 1}`,
      nombre: `Grupo ${position + 1}`,
      zona_ids: groupZones.map((zone) => zone.id),
      zonas: groupZones.map(zoneName),
      nodos: nodes,
      cantidad_zonas: groupZones.length,
      cantidad_nodos: nodes.length,
      interrupciones: interruptions,
      criticidad: groupCriticity(interruptions),
      prioridad: position + 1,
      center,
      departamentos,
      provincias,
      criterio_agrupacion: {
        algoritmo: "UFDS / Union-Find",
        regla: "unión solo si existe cercanía y conectividad operativa",
        regla_union: "cercanía suficiente AND conectividad válida",
        criterio: config.criterio,
        umbral_distancia_geografica_km: config.umbralDistanciaGeograficaKm,
        umbral_distancia_vial_km: config.umbralDistanciaVialKm,
        umbral_tiempo_min: config.umbralTiempoMin,
        umbral_costo: config.umbralCosto,
        nota: "Departamento/provincia no se usan como condición de unión.",
      },
      explicabilidad: {
        formado_por: groupEdges.length
          ? "cercanía + conectividad"
          : "nodo aislado sin unión válida",
        uniones_validas: groupEdges.length,
        uniones: groupEdges,
        nodos_aislados: isolatedNodes,
        cantidad_nodos_aislados: isolatedNodes.length,
      },
      es_aislado: groupZones.length === 1,
    });
  });

  groups.sort((a, b) => b.interrupciones - a.interrupciones);
  groups.forEach((group, index) => {
    group.id = `grupo-${index + 1}`;
    group.nombre = `Grupo ${index + 1}`;
    group.prioridad = index + 1;
  });
  return groups;
}

export function buildGroupedZonesWithUfds(zones = [], customConfig = {}) {
  const safeZones = zones.filter(Boolean);
  if (!safeZones.length) return [];

  const config = normalizeConfig(customConfig);
  const ufds = new UnionFind(safeZones.length);
  const centers = new Map();
  safeZones.forEach((zone, index) => {
    const center = zoneCenter(zone);
    if (center) centers.set(index, center);
  });

  const pairs = candidatePairs(centers, config);
  const explainability = {
    candidatePairs: pairs.length,
    unionEdges: [],
    globalRejections: [],
    perNodeUnionCount: new Map(),
    perNodeCandidateCount: new Map(),
    perNodeRejections: new Map(),
  };

  pairs.forEach(([sourceIndex, targetIndex]) => {
    const source = safeZones[sourceIndex];
    const target = safeZones[targetIndex];
    explainability.perNodeCandidateCount.set(
      source.id,
      (explainability.perNodeCandidateCount.get(source.id) || 0) + 1
    );
    explainability.perNodeCandidateCount.set(
      target.id,
      (explainability.perNodeCandidateCount.get(target.id) || 0) + 1
    );
    const result = evaluateConnection(source, target, config);
    if (result.shouldUnion) {
      const didUnion = ufds.union(sourceIndex, targetIndex);
      if (!didUnion) return;
      const edge = {
        source: source.id,
        sourceName: zoneName(source),
        target: target.id,
        targetName: zoneName(target),
        reason: result.reason,
        criterio_union: "cercanía + conectividad",
        cercania: result.closeReason,
        conectividad: result.connectReason,
        metrics: result.metrics,
      };
      explainability.unionEdges.push(edge);
      explainability.perNodeUnionCount.set(
        edge.source,
        (explainability.perNodeUnionCount.get(edge.source) || 0) + 1
      );
      explainability.perNodeUnionCount.set(
        edge.target,
        (explainability.perNodeUnionCount.get(edge.target) || 0) + 1
      );
      return;
    }

    const rejection = {
      source: source.id,
      sourceName: zoneName(source),
      target: target.id,
      targetName: zoneName(target),
      reason: result.reason,
      metrics: result.metrics,
    };
    if (explainability.globalRejections.length < config.maxRechazosGlobales) {
      explainability.globalRejections.push(rejection);
    }

    [source.id, target.id].forEach((nodeId) => {
      const current = explainability.perNodeRejections.get(nodeId) || [];
      if (current.length >= config.maxRechazosPorNodo) return;
      explainability.perNodeRejections.set(nodeId, [...current, rejection]);
    });
  });

  const groups = buildGroups(safeZones, ufds, explainability, config);
  const gruposAislados = groups.filter((group) => group.es_aislado).length;
  const gruposPequenosNoAislados = groups.filter(
    (group) => !group.es_aislado && Number(group.cantidad_nodos || 0) <= 2
  ).length;
  const nodosSinConexion = groups.reduce(
    (acc, group) => acc + Number(group.explicabilidad?.cantidad_nodos_aislados || 0),
    0
  );
  const globalSummary = {
    total_nodos: safeZones.length,
    total_grupos: groups.length,
    grupos_aislados: gruposAislados,
    grupos_pequenos_no_aislados: gruposPequenosNoAislados,
    nodos_sin_conexion_suficiente: nodosSinConexion,
    pares_candidatos_evaluados: explainability.candidatePairs,
    uniones_validas: explainability.unionEdges.length,
    rechazos_muestra: explainability.globalRejections,
  };

  groups.forEach((group) => {
    group.resumen_ufds = globalSummary;
  });

  return groups;
}

export { DEFAULT_GROUPING_CONFIG };
