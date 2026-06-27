const criticityOptions = [
  ["todas", "Todas"],
  ["critica", "Crítica"],
  ["alta", "Alta"],
  ["media", "Media"],
  ["baja", "Baja"],
];

const sizeOptions = [
  ["todos", "Todas"],
  ["pequeno", "1 a 5"],
  ["mediano", "6 a 15"],
  ["grande", "16 o más"],
];

function SelectField({ label, value, options, onChange }) {
  return (
    <label className="control-group">
      <span className="control-label">{label}</span>
      <select
        className="control-select"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function TerritoryTopFilters({
  filters,
  options,
  onFilterChange,
  onReset,
}) {
  const epsOptions = [
    ["todos", "Todas las EPS"],
    ...options.epsOrigins.map((origin) => [
      origin.id,
      `${origin.prestador} - ${origin.distrito}`,
    ]),
  ];
  const priorityOptions = [
    ["todos", "Todas"],
    ...options.priorities.map((priority) => [String(priority), `Prioridad ${priority}`]),
  ];

  return (
    <article className="territory-filter-panel territory-list-header">
      <div className="territory-filter-header">
        <div>
          <h2>Seleccionar grupo operativo</h2>
          <span>
            Compara grupos por criticidad, zonas, cobertura y EPS sugerida antes de abrir el detalle.
          </span>
        </div>
      </div>

      <div className="territory-filter-grid contextual">
        <SelectField
          label="Criticidad"
          value={filters.criticidad}
          options={criticityOptions}
          onChange={(value) => onFilterChange("criticidad", value)}
        />
        <SelectField
          label="EPS sugerida"
          value={filters.epsOriginId}
          options={epsOptions}
          onChange={(value) => onFilterChange("epsOriginId", value)}
        />
        <SelectField
          label="Cantidad de zonas"
          value={filters.zoneSize}
          options={sizeOptions}
          onChange={(value) => onFilterChange("zoneSize", value)}
        />
        <SelectField
          label="Prioridad"
          value={filters.priority}
          options={priorityOptions}
          onChange={(value) => onFilterChange("priority", value)}
        />
        <button type="button" className="territory-clear-button" onClick={onReset}>
          Limpiar filtros
        </button>
      </div>
    </article>
  );
}
