import { NavLink } from "react-router-dom";
import logo from "../../assets/logo.png";
import icono from "../../assets/icono.png";

const navItems = [
  {
    label: "Dashboard",
    path: "/dashboard",
    icon: "dashboard",
    meta: "Resumen ejecutivo",
  },
  {
    label: "Grupos operativos",
    path: "/agrupacion",
    icon: "grouping",
    meta: "Organización territorial",
  },
  {
    label: "Sectorización",
    path: "/sectorizacion",
    icon: "sector",
    meta: "Grupos operativos",
  },
  {
    label: "Exploración de rutas",
    path: "/mapa",
    icon: "map",
    meta: "Grafo vial",
  },
  {
    label: "Exploración local",
    path: "/exploracion-local",
    icon: "explore",
    meta: "Rutas candidatas",
  },
];

export default function Sidebar({ isOpen, onToggle }) {
  const handleToggle = (event) => {
    event.stopPropagation();
    onToggle();
  };

  return (
    <aside
      className={`sidebar ${isOpen ? "open" : "collapsed"}`}
      aria-label="Navegación principal"
    >
      <div className="sidebar-top">
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <img
              src={isOpen ? logo : icono}
              alt="AquaRuta"
              className={isOpen ? "sidebar-logo-full" : "sidebar-logo-icon"}
            />
          </div>
        </div>

        <div className="sidebar-section-title">Navegación</div>

        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                isActive ? "sidebar-link active" : "sidebar-link"
              }
              title={item.label}
              aria-label={item.label}
            >
              <span
                className={`sidebar-link-icon ${item.icon}`}
                aria-hidden="true"
              />
              <span className="sidebar-link-content">
                <span className="sidebar-link-text">{item.label}</span>
                <span className="sidebar-link-meta">{item.meta}</span>
              </span>
            </NavLink>
          ))}
        </nav>
      </div>

      <button
        type="button"
        className="sidebar-icon-toggle"
        onClick={handleToggle}
        title={isOpen ? "Ocultar panel" : "Mostrar panel"}
        aria-label={isOpen ? "Ocultar panel" : "Mostrar panel"}
        aria-expanded={isOpen}
      >
        <span aria-hidden="true">{isOpen ? "‹" : "›"}</span>
      </button>
    </aside>
  );
}
