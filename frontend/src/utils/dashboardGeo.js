export function repairText(value) {
  const replacements = new Map([
    [[195, 161].join("."), "\u00e1"],
    [[195, 169].join("."), "\u00e9"],
    [[195, 173].join("."), "\u00ed"],
    [[195, 179].join("."), "\u00f3"],
    [[195, 186].join("."), "\u00fa"],
    [[195, 177].join("."), "\u00f1"],
    [[195, 129].join("."), "\u00c1"],
    [[195, 137].join("."), "\u00c9"],
    [[195, 141].join("."), "\u00cd"],
    [[195, 147].join("."), "\u00d3"],
    [[195, 154].join("."), "\u00da"],
    [[195, 145].join("."), "\u00d1"],
    [[195, 150].join("."), "\u00d3"],
    [[194].join("."), ""],
    [[65533].join("."), ""],
  ]);

  return [...replacements.entries()].reduce((text, [key, replacement]) => {
    const codes = key.split(".").map((code) => Number(code));
    return text.replaceAll(String.fromCharCode(...codes), replacement);
  }, String(value || ""));
}

export function normalizeEpsName(value) {
  return repairText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\b(EPS|EMPRESA|PRESTADORA|SERVICIO|SANEAMIENTO)\b/g, " ")
    .replace(/\bS\s*\.?\s*A\s*\.?\b/g, " ")
    .replace(/\bSAC\b|\bS\s*\.?\s*A\s*\.?\s*C\s*\.?\b/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeUbigeo(value) {
  if (value === null || value === undefined) return "";
  let text = String(value).trim();
  if (!text || text.toLowerCase() === "nan") return "";
  if (text.endsWith(".0")) text = text.slice(0, -2);
  text = text.replace(/\D/g, "");
  return text ? text.padStart(6, "0") : "";
}

export function isValidCoordinatePair(point) {
  return (
    Array.isArray(point) &&
    point.length === 2 &&
    Number.isFinite(Number(point[0])) &&
    Number.isFinite(Number(point[1])) &&
    Number(point[0]) >= -90 &&
    Number(point[0]) <= 90 &&
    Number(point[1]) >= -180 &&
    Number(point[1]) <= 180
  );
}

export function isValidOriginCoordinate(origin) {
  const lat = Number(origin?.lat);
  const lon = Number(origin?.lon);
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

export function buildDashboardGeoAudit(districts = []) {
  const total = districts.length;
  const normalized = districts.map((district) => normalizeUbigeo(district.ubigeo));
  const validUbigeo = normalized.filter((ubigeo) => ubigeo.length === 6).length;
  const nullUbigeo = normalized.filter((ubigeo) => !ubigeo).length;
  const withCoordinates = districts.filter((district) => isValidCoordinatePair(district.center)).length;

  return {
    total,
    validUbigeo,
    nullUbigeo,
    unmatchedUbigeo: 0,
    withCoordinates,
    withoutCoordinates: total - withCoordinates,
  };
}

function normalizeTerritoryPart(value) {
  return repairText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[-'`´]/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function canonicalDistrictKey(district = {}) {
  const ubigeo = normalizeUbigeo(district.ubigeo);
  if (ubigeo.length === 6) return `ubigeo:${ubigeo}`;
  return `territory:${[
    normalizeTerritoryPart(district.departamento),
    normalizeTerritoryPart(district.provincia),
    normalizeTerritoryPart(district.nombre || district.distrito),
  ].join("|")}`;
}

function pickCanonicalDistrict(records) {
  return [...records].sort((a, b) => {
    const aCenter = isValidCoordinatePair(a.center) ? 1 : 0;
    const bCenter = isValidCoordinatePair(b.center) ? 1 : 0;
    return (
      bCenter - aCenter ||
      (b.interrupciones || 0) - (a.interrupciones || 0) ||
      String(a.id).localeCompare(String(b.id), "es")
    );
  })[0];
}

function weightedByInterruptions(records, field, totalInterruptions) {
  if (!totalInterruptions) return 0;
  return (
    records.reduce(
      (acc, item) => acc + (Number(item[field]) || 0) * (Number(item.interrupciones) || 0),
      0
    ) / totalInterruptions
  );
}

export function consolidateDashboardDistrictsAndGroups(districts = [], groups = []) {
  const buckets = new Map();

  for (const district of districts) {
    const key = canonicalDistrictKey(district);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(district);
  }

  const oldToCanonicalId = new Map();
  const consolidatedDistricts = [...buckets.entries()].map(([canonicalKey, records]) => {
    const primary = pickCanonicalDistrict(records);
    const totalInterruptions = records.reduce(
      (acc, item) => acc + (Number(item.interrupciones) || 0),
      0
    );
    const totalConnections = records.reduce(
      (acc, item) => acc + (Number(item.conexiones_afectadas) || 0),
      0
    );
    const totalEstimatedPeople = records.reduce(
      (acc, item) => acc + (Number(item.personas_afectadas_estimadas) || 0),
      0
    );

    for (const record of records) oldToCanonicalId.set(record.id, primary.id);

    return {
      ...primary,
      canonicalKey,
      duplicateSourceIds: records.map((record) => record.id),
      duplicateCount: records.length,
      interrupciones: totalInterruptions,
      conexiones_afectadas: totalConnections,
      unidades_afectadas: records.reduce(
        (acc, item) => acc + (Number(item.unidades_afectadas) || 0),
        0
      ),
      camiones_puntos: records.reduce((acc, item) => acc + (Number(item.camiones_puntos) || 0), 0),
      personas_afectadas_estimadas: totalEstimatedPeople,
      conexiones_afectadas_evento_max: Math.max(
        ...records.map((item) => Number(item.conexiones_afectadas_evento_max) || 0)
      ),
      duracion_promedio_horas: Number(
        weightedByInterruptions(records, "duracion_promedio_horas", totalInterruptions).toFixed(2)
      ),
      duracion_maxima_horas: Math.max(
        ...records.map((item) => Number(item.duracion_maxima_horas) || 0)
      ),
      primera_interrupcion: records
        .map((item) => item.primera_interrupcion)
        .filter(Boolean)
        .sort()[0],
      ultima_actualizacion: records
        .map((item) => item.ultima_actualizacion)
        .filter(Boolean)
        .sort()
        .at(-1),
      center: isValidCoordinatePair(primary.center) ? primary.center : null,
    };
  });

  const consolidatedGroups = groups.map((group) => {
    const canonicalIds = [];
    for (const id of group.zona_ids || []) {
      const canonicalId = oldToCanonicalId.get(id) || id;
      if (!canonicalId || canonicalIds.includes(canonicalId)) {
        continue;
      }
      canonicalIds.push(canonicalId);
    }
    return {
      ...group,
      zona_ids: canonicalIds,
      duplicate_zona_ids_removed: (group.zona_ids || []).length - canonicalIds.length,
    };
  });

  const duplicatesDetected = [...buckets.values()].filter((records) => records.length > 1);

  return {
    districts: consolidatedDistricts,
    groups: consolidatedGroups,
    stats: {
      before: districts.length,
      after: consolidatedDistricts.length,
      duplicateBuckets: duplicatesDetected.length,
      duplicateRecordsRemoved: districts.length - consolidatedDistricts.length,
      canonicalIdentifier: "UBIGEO normalizado de 6 digitos",
      fallbackIdentifier: "departamento + provincia + distrito normalizados",
    },
  };
}

export function buildRelatedEpsContext({ filteredDistricts = [], epsOrigins = [], limit = 8 }) {
  const grouped = new Map();

  for (const district of filteredDistricts) {
    const epsName = repairText(district.eps_principal || "").trim();
    const key = normalizeEpsName(epsName);
    if (!key) continue;

    if (!grouped.has(key)) {
      grouped.set(key, {
        key,
        prestador: epsName,
        relatedDistricts: [],
        criticalCoverage: 0,
        interruptions: 0,
      });
    }

    const item = grouped.get(key);
    item.relatedDistricts.push(district);
    item.criticalCoverage += district.criticidad === "critica" ? 1 : 0;
    item.interruptions += district.interrupciones || 0;
  }

  return [...grouped.values()]
    .map((item) => {
      const matchingOrigin = epsOrigins.find((origin) => {
        const originKey = normalizeEpsName(origin.prestador);
        return originKey === item.key || originKey.includes(item.key) || item.key.includes(originKey);
      });

      if (!matchingOrigin) {
        const referenceDistrict = item.relatedDistricts.find((district) =>
          isValidCoordinatePair(district.center)
        );
        return {
          id: `eps-context-${item.key.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          prestador: item.prestador,
          departamento: referenceDistrict?.departamento || item.relatedDistricts[0]?.departamento || "",
          provincia: referenceDistrict?.provincia || item.relatedDistricts[0]?.provincia || "",
          distrito: referenceDistrict?.nombre || item.relatedDistricts[0]?.nombre || "",
          locationType: "no_disponible",
          relatedDistricts: item.relatedDistricts,
          criticalCoverage: item.criticalCoverage,
          interruptions: item.interruptions,
        };
      }

      return {
        ...matchingOrigin,
        prestador: repairText(matchingOrigin.prestador || item.prestador),
        provincia: repairText(matchingOrigin.provincia),
        distrito: repairText(matchingOrigin.distrito),
        locationType: isValidOriginCoordinate(matchingOrigin) ? "exacta" : "no_disponible",
        relatedDistricts: item.relatedDistricts,
        criticalCoverage: item.criticalCoverage,
        interruptions: item.interruptions,
      };
    })
    .sort(
      (a, b) =>
        b.criticalCoverage - a.criticalCoverage ||
        b.interruptions - a.interruptions ||
        b.relatedDistricts.length - a.relatedDistricts.length
    )
    .slice(0, limit);
}

export function buildSelectedEpsContext({ selectedEps, filteredDistricts = [], epsOrigins = [] }) {
  if (!selectedEps || selectedEps === "todos") {
    return {
      title: "EPS relacionadas con el contexto",
      items: [],
      mapOrigins: [],
      missingReference: false,
    };
  }

  const selectedKey = normalizeEpsName(selectedEps);
  const relatedDistricts = filteredDistricts.filter(
    (district) => normalizeEpsName(district.eps_principal) === selectedKey
  );
  const relatedUbigeos = new Set(relatedDistricts.map((district) => normalizeUbigeo(district.ubigeo)));
  const relatedOrigins = epsOrigins
    .filter((origin) => {
      const originKey = normalizeEpsName(origin.prestador);
      const nameMatch =
        originKey === selectedKey || originKey.includes(selectedKey) || selectedKey.includes(originKey);
      const territoryMatch = relatedDistricts.some(
        (district) =>
          normalizeEpsName(district.departamento) === normalizeEpsName(origin.departamento) &&
          normalizeEpsName(district.provincia) === normalizeEpsName(origin.provincia)
      );
      return nameMatch || territoryMatch;
    })
    .map((origin) => ({
      ...origin,
      locationType: "exacta",
      relatedDistricts,
    }));

  const mapOrigins = relatedOrigins.filter(isValidOriginCoordinate);
  const referenceDistrict = relatedDistricts.find((district) => isValidCoordinatePair(district.center));
  const fallbackOrigin =
    !mapOrigins.length && referenceDistrict
      ? {
          id: `eps-ref-${selectedKey.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          prestador: selectedEps,
          departamento: referenceDistrict.departamento,
          provincia: referenceDistrict.provincia,
          distrito: referenceDistrict.nombre,
          lat: Number(referenceDistrict.center[0]),
          lon: Number(referenceDistrict.center[1]),
          locationType: "referencial",
          relatedDistricts,
        }
      : null;

  const panelItems = relatedOrigins.length
    ? relatedOrigins
    : [
        {
          id: `eps-selected-${selectedKey}`,
          prestador: selectedEps,
          departamento: relatedDistricts[0]?.departamento || "",
          provincia: relatedDistricts[0]?.provincia || "",
          distrito: relatedDistricts[0]?.nombre || "",
          locationType: fallbackOrigin ? "referencial" : "no_disponible",
          relatedDistricts,
        },
      ];

  return {
    title: "EPS seleccionada",
    items: panelItems,
    mapOrigins: fallbackOrigin ? [fallbackOrigin] : mapOrigins,
    missingReference: !fallbackOrigin && !mapOrigins.length,
    relatedDistricts,
    relatedUbigeos,
  };
}
