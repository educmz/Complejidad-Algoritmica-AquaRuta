import { useEffect, useId, useState } from "react";
import { NavLink } from "react-router-dom";
import logo from "../../assets/logo.png";

const navItems = [
  { label: "Dashboard", path: "/dashboard", short: "Dashboard" },
  { label: "Agrupacion", path: "/agrupacion", short: "Agrupacion" },
  { label: "Sectorizacion", path: "/sectorizacion", short: "Sectores" },
  { label: "Mapa operativo", path: "/mapa", short: "Mapa" },
  { label: "Exploracion local", path: "/exploracion-local", short: "Local" },
];

export default function AppHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();

  useEffect(() => {
    if (!menuOpen) return undefined;

    function handleKeyDown(event) {
      if (event.key === "Escape") setMenuOpen(false);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [menuOpen]);

  function closeMenu() {
    setMenuOpen(false);
  }

  return (
    <header className="app-header">
      <a className="app-header-brand" href="/dashboard" aria-label="AquaRuta dashboard">
        <img src={logo} alt="" />
      </a>

      <nav className="app-header-nav" aria-label="Navegacion principal">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) => (isActive ? "app-nav-link active" : "app-nav-link")}
            aria-label={item.label}
          >
            {item.short}
          </NavLink>
        ))}
      </nav>

      <div className="app-header-status" aria-label="Estado del sistema">
        <span className="system-dot" aria-hidden="true" />
        <span>Operativo</span>
      </div>

      <button
        type="button"
        className="app-menu-button"
        aria-controls={menuId}
        aria-expanded={menuOpen}
        aria-label={menuOpen ? "Cerrar menu" : "Abrir menu"}
        onClick={() => setMenuOpen((current) => !current)}
      >
        <span aria-hidden="true" />
      </button>

      {menuOpen && (
        <button
          type="button"
          className="mobile-nav-backdrop"
          aria-label="Cerrar menu"
          onClick={closeMenu}
        />
      )}

      <nav
        id={menuId}
        className={`mobile-nav-panel ${menuOpen ? "open" : ""}`}
        aria-label="Navegacion movil"
      >
        <div className="mobile-nav-heading">
          <strong>AquaRuta</strong>
          <button type="button" onClick={closeMenu} aria-label="Cerrar menu">
            Cerrar
          </button>
        </div>
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) => (isActive ? "mobile-nav-link active" : "mobile-nav-link")}
            onClick={closeMenu}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}
