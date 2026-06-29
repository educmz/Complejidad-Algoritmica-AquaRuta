import { useEffect, useMemo, useState } from "react";
import { aquaRutaData } from "../data/aquaRutaData";
import { runGrouping, DEFAULT_GROUPING_CONFIG } from "../services/groupingApi";
import { runSectorization } from "../services/sectorizationApi";
import { consolidateDashboardDistrictsAndGroups } from "../utils/dashboardGeo";

export const GROUPING_FILTERS = {};

export function groupNumber(groupId = "") {
  const match = String(groupId).match(/grupo-(\d+)/i);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

export function useOperationalGroups() {
  const rawDistricts = useMemo(() => aquaRutaData.districts || [], []);
  const epsOrigins = useMemo(() => aquaRutaData.epsOrigins || [], []);
  const [groups, setGroups] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [groupingError, setGroupingError] = useState("");

  const districts = useMemo(
    () => consolidateDashboardDistrictsAndGroups(rawDistricts, []).districts,
    [rawDistricts]
  );

  useEffect(() => {
    const controller = new AbortController();
    const loadingTimer = window.setTimeout(() => {
      setLoadingGroups(true);
      setGroupingError("");
      setGroups([]);
    }, 0);

    runGrouping(
      { filters: GROUPING_FILTERS, config: DEFAULT_GROUPING_CONFIG },
      { signal: controller.signal }
    )
      .then((payload) => {
        if (controller.signal.aborted) return;
        const canonical = consolidateDashboardDistrictsAndGroups(
          rawDistricts,
          payload.groups || []
        );
        const orderedGroups = canonical.groups
          .filter((group) => (group.zona_ids || []).length > 0)
          .sort(
            (a, b) =>
              groupNumber(a.id) - groupNumber(b.id) ||
              String(a.nombre || a.id).localeCompare(String(b.nombre || b.id), "es")
          );
        setGroups(orderedGroups);
        setSummary(payload.summary || null);
        setLoadingGroups(false);
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        setGroups([]);
        setSummary(null);
        setGroupingError(error?.message || "No se pudo calcular la agrupacion operativa.");
        setLoadingGroups(false);
      });

    return () => {
      window.clearTimeout(loadingTimer);
      controller.abort();
    };
  }, [rawDistricts]);

  return {
    districts,
    epsOrigins,
    groups,
    summary,
    loadingGroups,
    groupingError,
  };
}

export function groupToOption(group) {
  return {
    groupId: group.id,
    groupName: group.nombre || group.id,
    zoneIds: group.zona_ids || [],
    zonesCount: group.cantidad_zonas || group.zona_ids?.length || 0,
    sourceGroup: group,
  };
}

export function normalizeSectorizationSectors(payload, districtMap) {
  return (payload?.sectors || []).map((sector) => {
    const nodeIds = sector.nodeIds || sector.zona_ids || [];
    const zones = (sector.nodes?.length ? sector.nodes : nodeIds)
      .map((item) => {
        const id = typeof item === "string" ? item : item?.id;
        const district = districtMap.get(id);
        return district ? { ...district, ...(typeof item === "string" ? {} : item) } : null;
      })
      .filter(Boolean)
      .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), "es"));

    return {
      ...sector,
      id: sector.sectorId || sector.id,
      key: sector.sectorId || sector.id,
      group_id: sector.groupId,
      groupId: sector.groupId,
      nombre: sector.nombre || sector.sectorId || sector.id,
      zona_ids: nodeIds,
      district_ids: nodeIds,
      zones,
      districts: zones,
      cantidad_zonas: sector.summary?.districts || nodeIds.length,
      center: sector.center,
      metrics: sector.summary || {},
    };
  });
}

export function useCurrentSectorization(selectedGroup, districtMap, options = {}) {
  const [sectors, setSectors] = useState([]);
  const [payload, setPayload] = useState(null);
  const [loadingSectors, setLoadingSectors] = useState(false);
  const [sectorizationError, setSectorizationError] = useState("");
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    if (!selectedGroup?.sourceGroup) {
      const timer = window.setTimeout(() => {
        setSectors([]);
        setPayload(null);
        setLoadingSectors(false);
        setSectorizationError("");
      }, 0);
      return () => window.clearTimeout(timer);
    }

    const controller = new AbortController();
    const loadingTimer = window.setTimeout(() => {
      setSectors([]);
      setPayload(null);
      setLoadingSectors(true);
      setSectorizationError("");
    }, 0);

    runSectorization(
      {
        groupId: selectedGroup.groupId,
        group: selectedGroup.sourceGroup,
        splitCriterion: options.splitCriterion || "geografico",
        maxSectorSize: options.maxSectorSize || 8,
      },
      { signal: controller.signal }
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        setPayload(result);
        setSectors(normalizeSectorizationSectors(result, districtMap));
        setLoadingSectors(false);
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        setSectors([]);
        setPayload(null);
        setSectorizationError(error?.message || "No se pudo sectorizar el grupo.");
        setLoadingSectors(false);
      });

    return () => {
      window.clearTimeout(loadingTimer);
      controller.abort();
    };
  }, [
    districtMap,
    options.maxSectorSize,
    options.splitCriterion,
    retryToken,
    selectedGroup?.groupId,
    selectedGroup?.sourceGroup,
  ]);

  return {
    sectors,
    payload,
    loadingSectors,
    sectorizationError,
    retrySectorization: () => setRetryToken((current) => current + 1),
  };
}
