import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const agrupacion = await readFile("src/pages/Agrupacion.jsx", "utf8");
const filters = await readFile("src/components/grouping/TerritoryGroupFilters.jsx", "utf8");
const table = await readFile("src/components/grouping/TerritoryGroupTable.jsx", "utf8");
const sidePanel = await readFile("src/components/grouping/TerritoryGroupSidePanel.jsx", "utf8");
const map = await readFile("src/components/grouping/TerritoryCoverageMap.jsx", "utf8");
const css = await readFile("src/styles/globals.css", "utf8");

assert.ok(
  agrupacion.includes("consolidateDashboardDistrictsAndGroups"),
  "Agrupacion debe usar la consolidacion canonica de distritos y grupos"
);
assert.ok(
  agrupacion.includes("runGrouping"),
  "Agrupacion debe mantener UFDS en backend como fuente de ejecucion"
);
assert.ok(agrupacion.includes("TerritoryGroupFilters"), "Agrupacion debe usar una zona unica de filtros");
assert.ok(agrupacion.includes("TerritoryGroupTable"), "Agrupacion debe usar listado paginado");
assert.ok(agrupacion.includes("TerritoryGroupSidePanel"), "Agrupacion debe usar panel lateral simplificado");
assert.ok(agrupacion.includes("MapToolbar"), "Agrupacion debe reutilizar controles de mapa compartidos");
assert.equal(agrupacion.includes("switchMode"), false, "Agrupacion no debe alternar a vista de cobertura");
assert.equal(agrupacion.includes("fetchRouteGeoJson"), false, "Agrupacion no debe ejecutar calculos de cobertura");
assert.equal(agrupacion.includes("Ocultar detalle"), false, "Agrupacion no debe mantener boton antiguo de ocultar detalle");
assert.equal(agrupacion.includes("Ampliar mapa"), false, "Agrupacion no debe mantener boton antiguo de ampliar mapa");
assert.equal(agrupacion.includes("onToggleLayers"), false, "Agrupacion no debe mostrar boton Capas en el detalle");
assert.equal(agrupacion.includes("grupos recalculados"), false, "Agrupacion no debe mostrar texto de recalculo redundante");
assert.equal(agrupacion.includes("totalDistricts"), false, "Agrupacion no debe pasar contador de distritos visibles a la tabla");

assert.ok(filters.includes("SearchableCombobox"), "Filtros de Agrupacion deben reutilizar combobox buscable");
assert.ok(filters.includes("Grupos operativos"), "Encabezado debe decir Grupos operativos");
assert.ok(filters.includes("territory-hero-card"), "Cabecera debe estar en una tarjeta independiente");
assert.ok(filters.includes("territory-options-panel"), "Filtros deben estar en una segunda tarjeta");
assert.ok(filters.includes("Buscar grupo, distrito, provincia o departamento"), "Busqueda no debe mencionar EPS");
assert.equal(filters.includes("Buscar grupo, distrito, provincia o EPS"), false, "Placeholder no debe duplicar filtro de EPS");
assert.ok(filters.includes("Departamento"), "Filtros deben incluir departamento");
assert.ok(filters.includes("Provincia"), "Filtros deben incluir provincia");
assert.ok(filters.includes("Distrito"), "Filtros deben incluir distrito");
assert.ok(filters.includes("Cantidad de distritos"), "Filtro de tamano debe hablar de distritos");
assert.ok(filters.includes("Por página"), "Cantidad por pagina debe estar en el panel superior");
assert.ok(filters.includes("allowClear={false}"), "Los combobox no deben mostrar x de limpieza individual");
assert.equal(filters.includes("Tipo de grupo"), false, "Filtro Tipo de grupo debe eliminarse");
assert.equal(
  filters.includes("Revisa grupos sectorizables"),
  false,
  "Texto introductorio largo debe eliminarse"
);
assert.ok(filters.includes("disabled={!hasActiveFilters}"), "Limpiar filtros debe deshabilitarse sin filtros activos");

assert.ok(table.includes("Afectaciones estimadas"), "Listado debe tener columna de impacto social");
assert.ok(table.includes("affectedHouseholds"), "Listado debe usar hogares procesados");
assert.ok(table.includes("≈ {formatMil(block.affectedHouseholds, \"hogares\")}"), "Listado debe mostrar hogares en mil sin abreviatura k");
assert.ok(table.includes("Censo 2017"), "La fuente demografica debe quedar solo como ayuda contextual");
assert.ok(table.includes(" mil "), "Listado debe usar formato mil en vez de k");
assert.equal(table.includes("distritos visibles"), false, "Listado no debe mostrar contador de distritos visibles");
assert.equal(table.includes("hogares 2017"), false, "Listado no debe dejar etiqueta de hogares sin contexto");
assert.ok(table.includes("Página {currentPage} de {totalPages}"), "Listado debe mostrar pagina actual");
assert.ok(table.includes("Anterior"), "Listado debe tener pagina anterior");
assert.ok(table.includes("Siguiente"), "Listado debe tener pagina siguiente");
assert.ok(table.includes("territory-heading-help"), "Ayuda de criticidad debe estar en encabezado");
assert.ok(table.includes("territory-criticality-label"), "Filas deben mostrar criticidad como texto");
assert.ok(table.includes("Crítica"), "Criticidad debe mostrar texto Crítica");
assert.ok(table.includes("Ver grupo"), "Accion principal debe ser Ver grupo");
assert.equal(table.includes("Ver zonas"), false, "Listado no debe hablar de zonas");
assert.equal(table.includes("Peso demanda"), false, "Listado no debe mostrar peso de demanda");
assert.equal(table.includes("Buscar grupo"), false, "Tabla no debe duplicar busqueda");

assert.ok(sidePanel.includes("Distritos del grupo"), "Panel debe listar Distritos del grupo");
assert.ok(sidePanel.includes("Afectaciones estimadas acumuladas"), "Panel debe nombrar acumulados");
assert.ok(sidePanel.includes("Tiempo acumulado sin servicio"), "Panel debe mostrar tiempo acumulado");
assert.ok(sidePanel.includes("Ver sectorización"), "Panel debe permitir navegar a Sectorizacion si aplica");
assert.equal(sidePanel.includes("Distrito seleccionado:"), false, "Panel no debe repetir seleccion como texto redundante");
assert.equal(sidePanel.includes("Peso demanda familiar"), false, "Panel principal no debe mostrar peso de demanda familiar");
assert.equal(sidePanel.includes("Promedio de integrantes"), false, "Panel principal no debe mostrar promedio de hogar");
assert.equal(
  sidePanel.includes("La EPS de referencia se encuentra cerca"),
  false,
  "Panel no debe mostrar explicacion generica de EPS"
);

assert.equal(map.includes("  Circle,"), false, "Mapa de Agrupacion no debe importar Circle");
assert.equal(map.includes("<Circle\n"), false, "Mapa de Agrupacion no debe dibujar circulos de cobertura");
assert.equal(map.includes("map-action-controls"), false, "Mapa no debe renderizar controles antiguos superpuestos");
assert.ok(map.includes("{mapControls}"), "Controles deben renderizarse en la franja superior del mapa");
assert.equal(map.includes("territory-map-overlay-toolbar"), false, "Controles no deben flotar sobre Leaflet");
assert.ok(
  map.includes("Selecciona un distrito para consultar sus indicadores y localizarlo en el mapa."),
  "Mapa de detalle debe explicar la seleccion de distritos"
);
assert.ok(map.includes("territory-map-legend"), "Mapa debe incluir leyenda operativa");
assert.equal(map.includes("Nodos del grupo"), false, "Mapa debe hablar de Distritos del grupo");
assert.equal(map.includes("Cobertura sobre red vial"), false, "Agrupacion no debe mostrar modo Cobertura");

for (const selector of [
  ".territory-options-grid",
  ".territory-hero-card",
  ".territory-options-panel",
  ".territory-map-toolbar",
  ".territory-map-legend",
  ".territory-pagination",
  ".territory-heading-help",
  ".territory-criticality-label",
  ".territory-group-list-table",
  ".territory-page.workspace-expanded .territory-detail-header",
]) {
  assert.ok(css.includes(selector), `CSS debe incluir ${selector}`);
}
