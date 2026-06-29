import {
  dashboardFiltersFromSearch,
  dashboardFiltersToSearch,
  emptyDashboardFilters,
  normalizeDashboardFilters,
} from "./dashboardFilters";

export const ROUTE_CONTEXT_STORAGE_KEY = "aquaruta.route-context.v1";

export function isActiveFilter(value) {
  return Boolean(value && value !== "todos");
}

export function readRouteContext(searchParams) {
  const filtersFromUrl = dashboardFiltersFromSearch(searchParams);
  const hasUrlFilters = dashboardFiltersToSearch(filtersFromUrl).toString().length > 0;
  const hasUrlContext = [
    "grupo",
    "groupId",
    "sectorId",
    "distrito",
    "districtId",
    "criterio",
    "modo",
  ].some((key) => searchParams.has(key));
  const stored = (() => {
    if (!hasUrlContext && !hasUrlFilters) return {};
    try {
      return JSON.parse(window.sessionStorage.getItem(ROUTE_CONTEXT_STORAGE_KEY) || "{}");
    } catch {
      return {};
    }
  })();

  return {
    filters: hasUrlFilters
      ? filtersFromUrl
      : normalizeDashboardFilters(emptyDashboardFilters()),
    groupId: searchParams.get("grupo") || stored.groupId || "",
    sectorId: searchParams.get("sectorId") || stored.sectorId || "",
    districtId: searchParams.get("distrito") || searchParams.get("districtId") || stored.districtId || "",
    criterion: searchParams.get("criterio") || stored.criterion || "",
    mode: searchParams.get("modo") || stored.mode || "",
  };
}

export function writeRouteContext(context) {
  try {
    window.sessionStorage.setItem(
      ROUTE_CONTEXT_STORAGE_KEY,
      JSON.stringify({
        filters: normalizeDashboardFilters(context.filters || {}),
        groupId: context.groupId || "",
        sectorId: context.sectorId || "",
        districtId: context.districtId || "",
        criterion: context.criterion || "",
        mode: context.mode || "",
      })
    );
  } catch {
    // URL params still preserve the current context when storage is unavailable.
  }
}

export function buildRouteContextSearch(context) {
  const searchParams = dashboardFiltersToSearch(context.filters || {});
  const entries = {
    grupo: context.groupId,
    sectorId: context.sectorId,
    distrito: context.districtId,
    criterio: context.criterion,
    modo: context.mode,
  };

  for (const [key, value] of Object.entries(entries)) {
    if (isActiveFilter(value)) searchParams.set(key, value);
  }

  return searchParams;
}

export function buildRouteContextPath(path, context) {
  const query = buildRouteContextSearch(context).toString();
  return query ? `${path}?${query}` : path;
}
