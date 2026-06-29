import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
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
  const [navIndicator, setNavIndicator] = useState({ left: 0, visible: false });
  const location = useLocation();
  const menuId = useId();
  const navRef = useRef(null);
  const linkRefs = useRef({});

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

  useLayoutEffect(() => {
    function findActivePath() {
      return (
        navItems.find((item) =>
          item.path === "/dashboard"
            ? location.pathname === item.path || location.pathname === "/"
            : location.pathname.startsWith(item.path)
        )?.path || "/dashboard"
      );
    }

    function updateIndicator() {
      const navElement = navRef.current;
      const activeLink = linkRefs.current[findActivePath()];
      if (!navElement || !activeLink) {
        setNavIndicator((current) => ({ ...current, visible: false }));
        return;
      }

      const navRect = navElement.getBoundingClientRect();
      const linkRect = activeLink.getBoundingClientRect();
      setNavIndicator({
        left: linkRect.left - navRect.left + linkRect.width / 2,
        visible: true,
      });
    }

    updateIndicator();
    window.addEventListener("resize", updateIndicator);
    return () => window.removeEventListener("resize", updateIndicator);
  }, [location.pathname]);

  return (
    <header className="app-header">
      <a className="app-header-brand" href="/dashboard" aria-label="AquaRuta dashboard">
        <img src={logo} alt="" />
      </a>

      <nav className="app-header-nav" aria-label="Navegacion principal" ref={navRef}>
        <span
          className={`app-nav-orb ${navIndicator.visible ? "visible" : ""}`}
          style={{ left: `${navIndicator.left}px` }}
          aria-hidden="true"
        />
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            ref={(element) => {
              linkRefs.current[item.path] = element;
            }}
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
