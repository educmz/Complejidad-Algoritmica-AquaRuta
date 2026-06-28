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
  ["Sectorizacion", sector],
]) {
  assert.ok(content.includes("workspace-expanded"), `${name} debe tener modo mapa ampliado`);
}

assert.equal(mapa.includes("Ocultar controles"), false, "Mapa no debe ocultar sus controles");
assert.equal(local.includes("Ocultar controles"), false, "ExploracionLocal no debe ocultar sus controles");
assert.ok(sector.includes("workspace-toolbar"), "Sectorizacion debe tener barra de herramientas");
assert.ok(sector.includes("aria-expanded"), "Sectorizacion debe tener panel colapsable accesible");

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
