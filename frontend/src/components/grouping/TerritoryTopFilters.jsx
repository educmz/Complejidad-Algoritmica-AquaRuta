const criticityOptions = [
  ["todas", "Todas"],
  ["critica", "Crítica"],
  ["alta", "Alta"],
  ["media", "Media"],
  ["baja", "Baja"],
];

const sizeOptions = [
  ["todos", "Todas"],
  ["individual", "1 zona (grupo individual)"],
  ["pequeno", "2 a 5 zonas"],
  ["mediano", "6 a 15 zonas"],
  ["grande", "16 o más zonas"],
];

const groupTypeOptions = [
  ["todos", "Todos"],
  ["sectorizable", "Sectorizables"],
  ["individual", "Individuales"],
  ["sin-georreferenciacion", "Sin georreferenciación"],
  ["con-eps", "Con EPS de referencia"],
  ["sin-eps", "Sin EPS de referencia"],
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
  return (
    <article className="territory-filter-panel territory-list-header">
      <div className="territory-filter-header">
        <div>
          <h2>Seleccionar grupo operativo</h2>
          <span>
            Un grupo operativo reúne zonas afectadas que pueden analizarse juntas según criticidad,
            cercanía, cobertura EPS y cantidad de zonas. Los grupos individuales representan zonas
            que se atienden de forma independiente.
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
          label="EPS de referencia"
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
          label="Tipo de grupo"
          value={filters.groupType}
          options={groupTypeOptions}
          onChange={(value) => onFilterChange("groupType", value)}
        />
        <button type="button" className="territory-clear-button" onClick={onReset}>
          Limpiar filtros
        </button>
      </div>
    </article>
  );
}
