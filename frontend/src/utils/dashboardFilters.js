const EMPTY_FILTERS = {
  eps: "todos",
  departamento: "todos",
  provincia: "todos",
  distrito: "todos",
  grupo: "todos",
};

function isActive(value) {
  return Boolean(value && value !== "todos");
}

function sortText(values) {
  return [...values].sort((a, b) => String(a).localeCompare(String(b), "es"));
}

function groupNumber(group = {}) {
  const match = String(group.id || group.nombre || "").match(/grupo-(\d+)|grupo\s+(\d+)/i);
  return match ? Number(match[1] || match[2]) : Number.POSITIVE_INFINITY;
}

function sortGroupsNaturally(groups = []) {
  return [...groups].sort(
    (a, b) => groupNumber(a) - groupNumber(b) || String(a.nombre).localeCompare(String(b.nombre), "es")
  );
}

function groupDistrictIds(groups = [], groupId) {
  if (!isActive(groupId)) return null;
  const group = groups.find((item) => item.id === groupId);
  return group ? new Set(group.zona_ids || []) : new Set();
}

export function normalizeDashboardFilters(filters = {}) {
  return {
    eps: filters.eps || EMPTY_FILTERS.eps,
    departamento: filters.departamento || EMPTY_FILTERS.departamento,
    provincia: filters.provincia || EMPTY_FILTERS.provincia,
    distrito: filters.distrito || EMPTY_FILTERS.distrito,
    grupo: filters.grupo || EMPTY_FILTERS.grupo,
  };
}

export function dashboardFiltersFromSearch(searchParams) {
  return normalizeDashboardFilters({
    eps: searchParams.get("eps"),
    departamento: searchParams.get("departamento"),
    provincia: searchParams.get("provincia"),
    distrito: searchParams.get("distrito"),
    grupo: searchParams.get("grupo"),
  });
}

export function dashboardFiltersToSearch(filters = {}) {
  const normalized = normalizeDashboardFilters(filters);
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(normalized)) {
    if (isActive(value)) searchParams.set(key, value);
  }

  return searchParams;
}

export function filterDashboardDistricts(
  districts = [],
  groups = [],
  filters = {},
  ignoreKeys = []
) {
  const normalized = normalizeDashboardFilters(filters);
  const ignored = new Set(ignoreKeys);
  const selectedGroupIds = ignored.has("grupo")
    ? null
    : groupDistrictIds(groups, normalized.grupo);

  return districts.filter((district) => {
    if (selectedGroupIds && !selectedGroupIds.has(district.id)) return false;
    if (!ignored.has("eps") && isActive(normalized.eps) && district.eps_principal !== normalized.eps) {
      return false;
    }
    if (
      !ignored.has("departamento") &&
      isActive(normalized.departamento) &&
      district.departamento !== normalized.departamento
    ) {
      return false;
    }
    if (
      !ignored.has("provincia") &&
      isActive(normalized.provincia) &&
      district.provincia !== normalized.provincia
    ) {
      return false;
    }
    if (!ignored.has("distrito") && isActive(normalized.distrito) && district.id !== normalized.distrito) {
      return false;
    }
    return true;
  });
}

export function buildDashboardOptions(districts = [], groups = [], filters = {}) {
  const normalized = normalizeDashboardFilters(filters);
  const epsDistricts = filterDashboardDistricts(districts, groups, normalized, ["eps"]);
  const departmentDistricts = filterDashboardDistricts(districts, groups, normalized, ["departamento"]);
  const provinceDistricts = filterDashboardDistricts(districts, groups, normalized, ["provincia"]);
  const districtDistricts = filterDashboardDistricts(districts, groups, normalized, ["distrito"]);
  const groupDistricts = filterDashboardDistricts(districts, groups, normalized, ["grupo"]);
  const groupCandidateIds = new Set(groupDistricts.map((district) => district.id));

  return {
    eps: sortText(new Set(epsDistricts.map((district) => district.eps_principal).filter(Boolean))),
    departamentos: sortText(
      new Set(departmentDistricts.map((district) => district.departamento).filter(Boolean))
    ),
    provincias: sortText(new Set(provinceDistricts.map((district) => district.provincia).filter(Boolean))),
    distritos: districtDistricts
      .filter((district) => district.id && district.nombre)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
    grupos: sortGroupsNaturally(
      groups.filter((group) => (group.zona_ids || []).some((id) => groupCandidateIds.has(id)))
    ),
  };
}

export function sanitizeDashboardFilters(districts = [], groups = [], filters = {}) {
  const sanitized = normalizeDashboardFilters(filters);
  let changed = false;

  for (let index = 0; index < 5; index += 1) {
    const options = buildDashboardOptions(districts, groups, sanitized);

    if (isActive(sanitized.eps) && !options.eps.includes(sanitized.eps)) {
      sanitized.eps = "todos";
      changed = true;
    }
    if (
      isActive(sanitized.departamento) &&
      !options.departamentos.includes(sanitized.departamento)
    ) {
      sanitized.departamento = "todos";
      sanitized.provincia = "todos";
      sanitized.distrito = "todos";
      changed = true;
    }
    if (isActive(sanitized.provincia) && !options.provincias.includes(sanitized.provincia)) {
      sanitized.provincia = "todos";
      sanitized.distrito = "todos";
      changed = true;
    }
    if (
      isActive(sanitized.distrito) &&
      !options.distritos.some((district) => district.id === sanitized.distrito)
    ) {
      sanitized.distrito = "todos";
      changed = true;
    }
    if (
      isActive(sanitized.grupo) &&
      !options.grupos.some((group) => group.id === sanitized.grupo)
    ) {
      sanitized.grupo = "todos";
      changed = true;
    }

    if (!changed) break;
  }

  return sanitized;
}

export function buildDashboardPath(path, filters = {}, extra = {}) {
  const searchParams = dashboardFiltersToSearch(filters);

  for (const [key, value] of Object.entries(extra)) {
    if (isActive(value)) searchParams.set(key, value);
  }

  const query = searchParams.toString();
  return query ? `${path}?${query}` : path;
}

export function getDashboardMapDistricts(districts = [], selectedDistrictId = "todos") {
  if (isActive(selectedDistrictId)) {
    return districts.filter((district) => district.id === selectedDistrictId);
  }
  return districts;
}

export function emptyDashboardFilters() {
  return { ...EMPTY_FILTERS };
}
