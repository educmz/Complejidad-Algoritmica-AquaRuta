import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildDashboardOptions,
  buildDashboardPath,
  dashboardFiltersFromSearch,
  dashboardFiltersToSearch,
  filterDashboardDistricts,
  getDashboardMapDistricts,
  sanitizeDashboardFilters,
} from "../src/utils/dashboardFilters.js";
import {
  buildDashboardGeoAudit,
  buildRelatedEpsContext,
  buildSelectedEpsContext,
  consolidateDashboardDistrictsAndGroups,
  isValidCoordinatePair,
  normalizeEpsName,
  normalizeUbigeo,
} from "../src/utils/dashboardGeo.js";

const districts = [
  {
    id: "pasco-pasco-yanacancha",
    nombre: "Yanacancha",
    eps_principal: "EMAPA PASCO",
    departamento: "Pasco",
    provincia: "Pasco",
  },
  {
    id: "loreto-maynas-iquitos",
    nombre: "Iquitos",
    eps_principal: "EPS LORETO",
    departamento: "Loreto",
    provincia: "Maynas",
  },
  {
    id: "lima-lima-sjl",
    nombre: "San Juan De Lurigancho",
    eps_principal: "SEDAPAL",
    departamento: "Lima",
    provincia: "Lima",
  },
  {
    id: "lima-lima-miraflores",
    nombre: "Miraflores",
    eps_principal: "SEDAPAL",
    departamento: "Lima",
    provincia: "Lima",
  },
  {
    id: "lima-canete-san-vicente-de-canete",
    nombre: "San Vicente De Cañete",
    eps_principal: "EMAPA CAÑETE",
    departamento: "Lima",
    provincia: "Cañete",
    ubigeo: "150501",
    center: [-13.077778, -76.387778],
  },
  {
    id: "lima-canete-imperial",
    nombre: "Imperial",
    eps_principal: "EMAPA CANETE",
    departamento: "Lima",
    provincia: "Cañete",
    ubigeo: "150507.0",
    center: [-13.060556, -76.352778],
  },
  {
    id: "ica-nazca-nazca",
    nombre: "Nazca",
    eps_principal: "EMAPAVIGS",
    departamento: "Ica",
    provincia: "Nazca",
    ubigeo: "110301",
    center: [-14.826944, -74.9375],
    interrupciones: 11,
  },
  {
    id: "lima-barranca-ate",
    nombre: "Ate",
    eps_principal: "SEDAPAL",
    departamento: "Lima",
    provincia: "Barranca",
    ubigeo: "150103",
    center: null,
    interrupciones: 1,
    conexiones_afectadas: 158,
  },
  {
    id: "lima-lima-ate",
    nombre: "Ate",
    eps_principal: "SEDAPAL",
    departamento: "Lima",
    provincia: "Lima",
    ubigeo: "150103",
    center: [-12.026389, -76.921389],
    interrupciones: 1264,
    conexiones_afectadas: 5078747,
  },
];

const groups = [
  { id: "grupo-pasco", nombre: "Grupo Pasco", zona_ids: ["pasco-pasco-yanacancha"] },
  {
    id: "grupo-lima",
    nombre: "Grupo Lima",
    zona_ids: ["lima-lima-sjl", "lima-lima-miraflores"],
  },
  {
    id: "grupo-ate-a",
    nombre: "Grupo Ate A",
    zona_ids: ["lima-barranca-ate"],
  },
  {
    id: "grupo-ate-b",
    nombre: "Grupo Ate B",
    zona_ids: ["lima-lima-ate"],
  },
];

const numericGroups = [
  { id: "grupo-10", nombre: "Grupo 10", zona_ids: ["lima-lima-sjl"] },
  { id: "grupo-2", nombre: "Grupo 2", zona_ids: ["lima-lima-miraflores"] },
  { id: "grupo-1", nombre: "Grupo 1", zona_ids: ["pasco-pasco-yanacancha"] },
];

const origins = [
  {
    id: "eps-emapa-canete-s-a",
    prestador: "EMAPA CANETE S.A.",
    departamento: "Lima",
    provincia: "Cañete",
    distrito: "San Vicente De Cañete",
    lat: "-13.077778",
    lon: "-76.387778",
  },
];

const pascoOptions = buildDashboardOptions(districts, groups, {
  eps: "EMAPA PASCO",
});
assert.deepEqual(pascoOptions.departamentos, ["Pasco"]);
assert.equal(pascoOptions.departamentos.includes("Loreto"), false);

assert.deepEqual(
  buildDashboardOptions(districts, numericGroups, {}).grupos.map((group) => group.nombre),
  ["Grupo 1", "Grupo 2", "Grupo 10"]
);

const loretoOptions = buildDashboardOptions(districts, groups, {
  departamento: "Loreto",
});
assert.deepEqual(loretoOptions.eps, ["EPS LORETO"]);
assert.equal(loretoOptions.eps.includes("EMAPA PASCO"), false);

assert.deepEqual(
  sanitizeDashboardFilters(districts, groups, {
    eps: "EMAPA PASCO",
    departamento: "Loreto",
    provincia: "Maynas",
    distrito: "loreto-maynas-iquitos",
  }),
  {
    eps: "todos",
    departamento: "todos",
    provincia: "todos",
    distrito: "todos",
    grupo: "todos",
  }
);

assert.equal(
  sanitizeDashboardFilters(districts, groups, {
    departamento: "Pasco",
    distrito: "lima-lima-sjl",
    grupo: "grupo-lima",
  }).grupo,
  "todos"
);

assert.deepEqual(
  filterDashboardDistricts(districts, groups, {
    departamento: "Lima",
    provincia: "Lima",
  }).map((district) => district.id),
  ["lima-lima-sjl", "lima-lima-miraflores", "lima-lima-ate"]
);

assert.deepEqual(getDashboardMapDistricts(districts, "lima-lima-sjl"), [districts[2]]);
assert.equal(normalizeUbigeo("150507.0"), "150507");
assert.equal(normalizeUbigeo(" 10101 "), "010101");
assert.equal(normalizeEpsName("EMAPA CAÑETE S.A."), normalizeEpsName("emapa canete"));

const selectedEpsContext = buildSelectedEpsContext({
  selectedEps: "EMAPA CAÑETE",
  filteredDistricts: districts.filter((district) => normalizeEpsName(district.eps_principal) === normalizeEpsName("EMAPA CAÑETE")),
  epsOrigins: origins,
});
assert.equal(selectedEpsContext.title, "EPS seleccionada");
assert.equal(selectedEpsContext.items.length, 1);
assert.equal(selectedEpsContext.items[0].prestador, "EMAPA CANETE S.A.");
assert.equal(selectedEpsContext.mapOrigins.length, 1);

const withoutExactOrigin = buildSelectedEpsContext({
  selectedEps: "EMAPA CAÑETE",
  filteredDistricts: districts.filter((district) => normalizeEpsName(district.eps_principal) === normalizeEpsName("EMAPA CAÑETE")),
  epsOrigins: [],
});
assert.equal(withoutExactOrigin.items[0].locationType, "referencial");
assert.equal(withoutExactOrigin.mapOrigins[0].locationType, "referencial");

const nazcaRelatedEps = buildRelatedEpsContext({
  filteredDistricts: districts.filter((district) => district.id === "ica-nazca-nazca"),
  epsOrigins: [],
});
assert.equal(nazcaRelatedEps.length, 1);
assert.equal(nazcaRelatedEps[0].prestador, "EMAPAVIGS");
assert.equal(nazcaRelatedEps[0].relatedDistricts.length, 1);
assert.equal(nazcaRelatedEps[0].locationType, "no_disponible");

const canonicalDashboard = consolidateDashboardDistrictsAndGroups(districts, groups);
const canonicalAte = canonicalDashboard.districts.filter((district) => district.ubigeo === "150103");
const groupMemberships = canonicalDashboard.groups.filter((group) =>
  (group.zona_ids || []).includes(canonicalAte[0]?.id)
);
assert.equal(canonicalAte.length, 1);
assert.equal(canonicalAte[0].interrupciones, 1265);
assert.equal(canonicalAte[0].center[0], -12.026389);
assert.equal(groupMemberships.length, 2);
assert.ok(
  groupMemberships.every((group) => new Set(group.zona_ids || []).size === (group.zona_ids || []).length),
  "La consolidacion no debe duplicar distritos dentro del mismo grupo"
);
assert.equal(canonicalDashboard.stats.before - canonicalDashboard.stats.after >= 1, true);

const geoAudit = buildDashboardGeoAudit(districts);
assert.equal(geoAudit.total, districts.length);
assert.equal(geoAudit.validUbigeo >= 2, true);
assert.equal(isValidCoordinatePair([999, -77]), false);

const path = buildDashboardPath(
  "/sectorizacion",
  { departamento: "Lima", distrito: "lima-lima-sjl" },
  { grupo: "grupo-lima" }
);
assert.equal(path, "/sectorizacion?departamento=Lima&distrito=lima-lima-sjl&grupo=grupo-lima");

const encoded = dashboardFiltersToSearch({
  eps: "SEDAPAL",
  departamento: "Lima",
  provincia: "Lima",
  distrito: "lima-lima-sjl",
});
assert.equal(
  dashboardFiltersFromSearch(encoded).distrito,
  "lima-lima-sjl"
);

const dashboard = await readFile("src/pages/DashboardOperativo.jsx", "utf8");
const dashboardMap = await readFile("src/components/dashboard/DashboardMiniMap.jsx", "utf8");
const epsMarker = await readFile("src/components/map/EpsMapMarker.jsx", "utf8");
const epsIcon = await readFile("src/components/map/epsMapIcon.js", "utf8");
const dashboardGeo = await readFile("src/utils/dashboardGeo.js", "utf8");
const css = await readFile("src/styles/globals.css", "utf8");
const routeElements = await readFile("src/routeElements.jsx", "utf8");
assert.equal(routeElements.includes("./pages/DashboardOperativo"), true);
for (const badText of ["Recursos operativos disponibles", "Capacidad diaria"]) {
  assert.equal(dashboard.includes(badText), false, `Dashboard activo no debe contener ${badText}`);
}

assert.equal(dashboard.includes("dashboard-pill"), false, "Ranking no debe mostrar Max. X dias");
assert.equal(dashboard.includes("eventos"), false, "Dashboard visible no debe usar eventos");
assert.equal(dashboard.includes("<small>{item.description}</small>"), false);
assert.equal(dashboard.includes("InfoTooltip"), false, "KPI no deben tener tooltip");
assert.equal(dashboard.includes("dashboard-info-button"), false, "KPI no deben tener icono info");
assert.ok(dashboard.includes("Ver grupo operativo"));
assert.ok(dashboard.includes("Sectorizar grupo"));
assert.equal(dashboard.includes("Alertas operativas"), false);
assert.equal(dashboard.includes("Sin alertas operativas"), false);
assert.equal(dashboard.includes("Datos geograficos incompletos"), false);
assert.equal(dashboard.includes("distritos no pudieron representarse"), false);
assert.equal(dashboard.includes("requiere sectorizacion"), false);
assert.ok(dashboardGeo.includes("EPS seleccionada"));
assert.equal(dashboard.includes("No hay EPS relacionadas con los filtros seleccionados."), true);

assert.equal(dashboardMap.includes(".slice(0, 80)"), false, "Mapa no debe truncar distritos");
assert.ok(dashboardMap.includes("data-district-count"));
assert.ok(dashboardMap.includes("epsOrigins"));
assert.ok(dashboardMap.includes("EpsMapMarker"));
assert.ok(epsMarker.includes("getEpsMapIcon"));
assert.ok(epsIcon.includes("dashboard-eps-marker"));
assert.ok(epsIcon.includes("dashboard-eps-marker-reference"));
assert.ok(dashboardMap.includes("fitBounds"));

assert.ok(css.includes(".dashboard-group-grid"));
assert.ok(css.includes("grid-template-columns: repeat(2, minmax(0, 1fr));"));
assert.ok(css.includes("@media (max-width: 1180px)"));
assert.ok(css.includes(".dashboard-eps-marker"));
assert.ok(css.includes(".dashboard-map-toolbar"));
assert.equal(css.includes(".dashboard-alert-card"), false);
assert.equal(css.includes(".dashboard-tooltip-content"), false);
