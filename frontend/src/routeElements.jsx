import { lazy, Suspense } from "react";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const Agrupacion = lazy(() => import("./pages/Agrupacion"));
const Sectorizacion = lazy(() => import("./pages/Sectorizacion"));
const MapaOperativo = lazy(() => import("./pages/MapaOperativo"));
const ExploracionLocal = lazy(() => import("./pages/ExploracionLocal"));

function RouteFallback() {
  return (
    <div className="route-loading-shell" role="status" aria-live="polite">
      Cargando modulo operativo...
    </div>
  );
}

function LazyRoute({ children }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>;
}

export function DashboardRoute() {
  return (
    <LazyRoute>
      <Dashboard />
    </LazyRoute>
  );
}

export function AgrupacionRoute() {
  return (
    <LazyRoute>
      <Agrupacion />
    </LazyRoute>
  );
}

export function SectorizacionRoute() {
  return (
    <LazyRoute>
      <Sectorizacion />
    </LazyRoute>
  );
}

export function MapaOperativoRoute() {
  return (
    <LazyRoute>
      <MapaOperativo />
    </LazyRoute>
  );
}

export function ExploracionLocalRoute() {
  return (
    <LazyRoute>
      <ExploracionLocal />
    </LazyRoute>
  );
}
