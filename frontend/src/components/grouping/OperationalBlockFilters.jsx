const criticityOptions = [
  ["todas", "Todas"],
  ["critica", "Crítica"],
  ["alta", "Alta"],
  ["media", "Media"],
  ["baja", "Baja"],
];

const statusOptions = [
  ["todos", "Todos"],
  ["pendiente", "Pendiente"],
  ["priorizado", "Priorizado"],
  ["revision", "En revisión"],
  ["rutas", "Listo para ruteo"],
];

export default function OperationalBlockFilters({
  filters,
  options,
  counters,
  layers,
  onFilterChange,
  onLayerChange,
  onReset,
}) {
  return (
    <article className="panel operational-filters-panel">
      <div className="operational-panel-heading compact">
        <div>
          <h3 className="panel-title">Filtros operativos</h3>
          <p className="panel-subtitle">
            Delimita grupos por territorio, criticidad, cobertura y estado.
          </p>
        </div>
      </div>

      <div className="operational-counter-grid">
        <div>
          <span>Grupos totales</span>
          <strong>{counters.total}</strong>
        </div>
        <div>
          <span>Grupos visibles</span>
          <strong>{counters.visible}</strong>
        </div>
      </div>

      <div className="operational-filter-stack">
        <label className="control-group">
          <span className="control-label">EPS</span>
          <select
            className="control-select"
            value={filters.eps}
            onChange={(event) => onFilterChange("eps", event.target.value)}
          >
            <option value="todos">Todas</option>
            {options.eps.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label className="control-group">
          <span className="control-label">Departamento</span>
          <select
            className="control-select"
            value={filters.departamento}
            onChange={(event) => onFilterChange("departamento", event.target.value)}
          >
            <option value="todos">Todos</option>
            {options.departamentos.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label className="control-group">
          <span className="control-label">Provincia</span>
          <select
            className="control-select"
            value={filters.provincia}
            onChange={(event) => onFilterChange("provincia", event.target.value)}
          >
            <option value="todos">Todas</option>
            {options.provincias.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label className="control-group">
          <span className="control-label">Distrito</span>
          <select
            className="control-select"
            value={filters.distrito}
            onChange={(event) => onFilterChange("distrito", event.target.value)}
          >
            <option value="todos">Todos</option>
            {options.distritos.map((item) => (
              <option key={item.id} value={item.id}>
                {item.nombre}
              </option>
            ))}
          </select>
        </label>

        <label className="control-group">
          <span className="control-label">Criticidad</span>
          <select
            className="control-select"
            value={filters.criticidad}
            onChange={(event) => onFilterChange("criticidad", event.target.value)}
          >
            {criticityOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="control-group">
          <span className="control-label">Tamaño del grupo</span>
          <select
            className="control-select"
            value={filters.tamano}
            onChange={(event) => onFilterChange("tamano", event.target.value)}
          >
            <option value="todos">Todos</option>
            <option value="pequeno">1 a 3 zonas</option>
            <option value="mediano">4 a 12 zonas</option>
            <option value="grande">13+ zonas</option>
          </select>
        </label>

        <label className="control-group">
          <span className="control-label">Interrupciones</span>
          <select
            className="control-select"
            value={filters.interrupciones}
            onChange={(event) => onFilterChange("interrupciones", event.target.value)}
          >
            <option value="todos">Todas</option>
            <option value="bajas">Hasta 450</option>
            <option value="medias">451 a 1,500</option>
            <option value="altas">Más de 1,500</option>
          </select>
        </label>

        <label className="control-group">
          <span className="control-label">Personas estimadas</span>
          <select
            className="control-select"
            value={filters.poblacion}
            onChange={(event) => onFilterChange("poblacion", event.target.value)}
          >
            <option value="todos">Todas</option>
            <option value="baja">Hasta 100 mil</option>
            <option value="media">100 mil a 1 millón</option>
            <option value="alta">Más de 1 millón</option>
          </select>
        </label>

        <label className="control-group">
          <span className="control-label">Nodo cercano</span>
          <select
            className="control-select"
            value={filters.nodo}
            onChange={(event) => onFilterChange("nodo", event.target.value)}
          >
            <option value="todos">Todos</option>
            <option value="cercano">Cercano</option>
            <option value="intermedio">Intermedio</option>
            <option value="sin-cobertura">Sin cobertura cercana</option>
          </select>
        </label>

        <label className="control-group">
          <span className="control-label">Cobertura logística</span>
          <select
            className="control-select"
            value={filters.logistica}
            onChange={(event) => onFilterChange("logistica", event.target.value)}
          >
            <option value="todos">Todas</option>
            <option value="alta">Alta</option>
            <option value="media">Media</option>
            <option value="baja">Baja</option>
          </select>
        </label>

        <label className="control-group">
          <span className="control-label">Estado del grupo</span>
          <select
            className="control-select"
            value={filters.estado}
            onChange={(event) => onFilterChange("estado", event.target.value)}
          >
            {statusOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="operational-layer-box">
        <div className="operational-section-label">Capas del mapa</div>
        {[
          ["showHalos", "Áreas de grupo"],
          ["showZones", "Zonas afectadas"],
          ["showEps", "Nodo EPS sugerido"],
          ["showConnections", "Conexión al nodo"],
        ].map(([key, label]) => (
          <label key={key} className="operational-check-row">
            <input
              type="checkbox"
              checked={layers[key]}
              onChange={(event) => onLayerChange(key, event.target.checked)}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>

      <button type="button" className="operational-reset-button" onClick={onReset}>
        Limpiar filtros
      </button>
    </article>
  );
}
