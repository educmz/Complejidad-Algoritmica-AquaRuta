import { createBrowserRouter, Navigate } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import Agrupacion from "./pages/Agrupacion";
import Sectorizacion from "./pages/Sectorizacion";
import MapaOperativo from "./pages/MapaOperativo";
import ExploracionLocal from "./pages/ExploracionLocal";

const router = createBrowserRouter([
  {
    path: "/",
    element: <Navigate to="/dashboard" replace />,
  },
  {
    path: "/dashboard",
    element: <Dashboard />,
  },
  {
    path: "/agrupacion",
    element: <Agrupacion />,
  },
  {
    path: "/sectorizacion",
    element: <Sectorizacion />,
  },
  {
    path: "/mapa",
    element: <MapaOperativo />,
  },
  {
    path: "/exploracion-local",
    element: <ExploracionLocal />,
  },
]);

export default router;
