import { createBrowserRouter, Navigate } from "react-router-dom";
import {
  AgrupacionRoute,
  DashboardRoute,
  ExploracionLocalRoute,
  MapaOperativoRoute,
  SectorizacionRoute,
} from "./routeElements";

const router = createBrowserRouter([
  {
    path: "/",
    element: <Navigate to="/dashboard" replace />,
  },
  {
    path: "/dashboard",
    element: <DashboardRoute />,
  },
  {
    path: "/agrupacion",
    element: <AgrupacionRoute />,
  },
  {
    path: "/sectorizacion",
    element: <SectorizacionRoute />,
  },
  {
    path: "/mapa",
    element: <MapaOperativoRoute />,
  },
  {
    path: "/exploracion-local",
    element: <ExploracionLocalRoute />,
  },
]);

export default router;
