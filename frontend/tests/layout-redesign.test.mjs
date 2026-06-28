import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const mainLayout = await readFile("src/components/layout/MainLayout.jsx", "utf8");
const appHeader = await readFile("src/components/layout/AppHeader.jsx", "utf8");
const router = await readFile("src/router.jsx", "utf8");
const routeElements = await readFile("src/routeElements.jsx", "utf8");
const css = await readFile("src/styles/globals.css", "utf8");
const mapa = await readFile("src/pages/MapaOperativo.jsx", "utf8");
const local = await readFile("src/pages/ExploracionLocal.jsx", "utf8");
const sector = await readFile("src/pages/Sectorizacion.jsx", "utf8");
const sectorizationApi = await readFile("src/services/sectorizationApi.js", "utf8");
const searchableCombobox = await readFile("src/components/forms/SearchableCombobox.jsx", "utf8");
const mapToolbar = await readFile("src/components/map/MapToolbar.jsx", "utf8");

assert.equal(mainLayout.includes("Sidebar"), false, "MainLayout no debe montar sidebar permanente");
assert.ok(mainLayout.includes("AppHeader"), "MainLayout debe usar header horizontal");
assert.ok(appHeader.includes("app-header-nav"), "AppHeader debe exponer navegacion horizontal");
assert.ok(appHeader.includes("aria-expanded"), "Menu movil debe comunicar estado expandido");
assert.ok(appHeader.includes("Escape"), "Menu movil debe cerrar con Escape");

assert.ok(router.includes("DashboardRoute"), "Router debe montar rutas diferidas");
assert.ok(routeElements.includes("lazy("), "Las paginas deben cargarse por lazy loading");
assert.ok(routeElements.includes("Suspense"), "Las rutas diferidas deben usar Suspense");

for (const [name, content] of [
  ["MapaOperativo", mapa],
  ["ExploracionLocal", local],
]) {
  assert.ok(content.includes("workspace-toolbar"), `${name} debe tener barra de herramientas`);
  assert.ok(content.includes("workspace-expanded"), `${name} debe tener modo mapa ampliado`);
  assert.ok(content.includes("aria-expanded"), `${name} debe tener panel colapsable accesible`);
}

assert.ok(sector.includes("SearchableCombobox"), "Sectorizacion debe reutilizar el combobox buscable");
assert.ok(sector.includes("allowClear={false}"), "Sectorizacion no debe permitir limpiar el grupo seleccionado con x");
assert.ok(sector.includes("MapToolbar"), "Sectorizacion debe reutilizar la barra de mapa compartida");
assert.ok(sector.includes("sector-map-expanded"), "Sectorizacion debe ampliar solo el mapa sin ocultar cabecera ni controles");
assert.equal(sector.includes("workspace-expanded"), false, "Sectorizacion no debe usar el modo global que oculta bloques superiores");
assert.ok(sector.includes("DEFAULT_GROUP_ID = \"grupo-1\""), "Sectorizacion debe seleccionar Grupo 1 por defecto");
assert.ok(sector.includes("searchParams.get(\"groupId\")"), "Sectorizacion debe aceptar groupId por navegacion");
assert.ok(searchableCombobox.includes("aria-expanded"), "Combobox compartido debe exponer expansion accesible");
assert.ok(searchableCombobox.includes("role=\"combobox\""), "Combobox compartido debe declarar rol combobox");
assert.ok(searchableCombobox.includes("role=\"listbox\""), "Combobox compartido debe declarar lista desplegable");
assert.ok(mapToolbar.includes("aria-expanded"), "Toolbar compartida debe exponer leyenda accesible");
assert.ok(searchableCombobox.includes("▾"), "Combobox compartido no debe usar una V como icono de apertura");
assert.ok(sector.includes("runSectorization"), "Sectorizacion debe ejecutar el backend al seleccionar grupo");
assert.ok(sectorizationApi.includes("/sectorization/run"), "El servicio debe apuntar a /sectorization/run");
assert.equal(sector.includes("sectorizedZones"), false, "Sectorizacion no debe usar sectores precalculados");
assert.equal(sector.includes("maxSectorSize"), false, "Sectorizacion no debe mostrar tamano maximo editable");
assert.equal(sector.includes("splitCriterion"), false, "Sectorizacion no debe mostrar criterio sin efecto visible");
assert.equal(sector.includes("Ocultar configuracion"), false, "Sectorizacion no debe mantener boton de ocultar configuracion");
assert.equal(sector.includes("sectores oficiales"), false, "Sectorizacion no debe mencionar sectores oficiales");
assert.equal(sector.includes("Sector recomendado"), false, "Sectorizacion no debe mostrar sector recomendado");
assert.equal(
  sector.includes("El grupo es manejable y se mantiene como un único sector"),
  false,
  "Sectorizacion no debe mostrar aviso especial cuando hay un unico sector"
);
assert.equal(
  sector.includes("fue dividido en"),
  false,
  "Sectorizacion no debe mostrar resumen narrativo de division"
);
assert.equal(
  sector.includes("Este sector pertenece al grupo operativo seleccionado"),
  false,
  "Sectorizacion no debe mostrar texto generico en el panel"
);
assert.ok(
  sector.includes("sector-overview-table"),
  "Sectorizacion debe mostrar resumen tabular de sectores junto al selector"
);
assert.equal(sector.includes("sector-tabs-panel"), false, "Sectorizacion no debe conservar chips simples separados");
assert.equal(sector.includes("className=\"sector-tabs\""), false, "Sectorizacion no debe usar la fila antigua de chips");
assert.ok(
  sector.indexOf("sector-overview-table") < sector.indexOf("sector-detail-layout"),
  "El resumen de sectores debe aparecer antes del mapa y el panel"
);
assert.equal(sector.includes("sector-comparison-grid"), false, "Sectorizacion no debe renderizar resumen comparativo");
assert.equal(sector.includes("sector-table-panel"), false, "Sectorizacion no debe renderizar tabla inferior");
assert.equal(sector.includes("sector-table"), false, "Sectorizacion no debe mantener tabla de sectores");
assert.equal(sector.includes("Resumen comparativo"), false, "Sectorizacion no debe mostrar resumen comparativo");
assert.equal(
  sector.includes("Selecciona un sector para sincronizar tabla, mapa y detalle"),
  false,
  "Sectorizacion no debe conservar instrucciones de la tabla eliminada"
);
assert.equal(sector.includes("  Circle,"), false, "Sectorizacion no debe importar circulos decorativos");
assert.equal(sector.includes("<Circle\n"), false, "Sectorizacion no debe dibujar radios circulares");
assert.equal(sector.includes("EPS local"), false, "Sectorizacion no debe mostrar categoria EPS local");
assert.equal(sector.includes("EPS externa"), false, "Sectorizacion no debe mostrar categoria EPS externa");
assert.equal(sector.includes("EPS lejana"), false, "Sectorizacion no debe mostrar categoria EPS lejana");
assert.equal(sector.includes("Validación operativa requerida"), false, "Sectorizacion no debe mostrar validacion EPS sin accion");
assert.equal(sector.includes("Zonas"), false, "Sectorizacion debe usar Distritos como termino visual");
assert.ok(
  sector.includes("Afectaciones estimadas acumuladas"),
  "Sectorizacion debe nombrar acumulados de personas con precision"
);
const mojibakePattern = new RegExp("[\\u00c3\\u00c2\\ufffd]");
assert.equal(mojibakePattern.test(sector), false, "Sectorizacion no debe contener mojibake");

for (const selector of [
  ".app-header",
  ".app-header-nav",
  ".workspace-expanded",
  ".panel-collapsed .workspace-side-panel",
  ".algorithm-tabs",
  "@media (prefers-reduced-motion: reduce)",
]) {
  assert.ok(css.includes(selector), `CSS debe incluir ${selector}`);
}
