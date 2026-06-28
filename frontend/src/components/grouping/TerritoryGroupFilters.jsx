import SearchableCombobox from "../forms/SearchableCombobox";

const criticityOptions = [
  { value: "critica", label: "Crítica" },
  { value: "alta", label: "Alta" },
  { value: "media", label: "Media" },
  { value: "baja", label: "Baja" },
];

const sizeOptions = [
  { value: "individual", label: "1 distrito" },
  { value: "pequeno", label: "2 a 5 distritos" },
  { value: "mediano", label: "6 a 15 distritos" },
  { value: "grande", label: "16 o más distritos" },
];

const sortOptions = [
  { value: "interrupciones", label: "Interrupciones" },
  { value: "poblacion", label: "Afectaciones estimadas" },
  { value: "hogares", label: "Hogares" },
  { value: "zonas", label: "Distritos" },
  { value: "distancia", label: "Distancia EPS" },
];

export default function TerritoryGroupFilters({
  filters,
  options,
  search,
  sortBy,
  pageSize,
  onFilterChange,
  onSearchChange,
  onSortChange,
  onPageSizeChange,
  onReset,
}) {
  const epsOptions = options.epsOrigins.map((origin) => ({
    value: origin.id,
    label: `${origin.prestador} - ${origin.distrito}`,
  }));
  const departmentOptions = options.departments.map((department) => ({
    value: department,
    label: department,
  }));
  const provinceOptions = options.provinces.map((province) => ({
    value: province,
    label: province,
  }));
  const hasActiveFilters =
    search.trim() ||
    filters.criticidad !== "todas" ||
    filters.epsOriginId !== "todos" ||
    filters.zoneSize !== "todos" ||
    filters.departamento !== "todos" ||
    filters.provincia !== "todos" ||
    filters.distrito !== "todos" ||
    sortBy !== "criticidad" ||
    pageSize !== 20;

  return (
    <>
      <article className="territory-hero-card">
        <h2>Grupos operativos</h2>
        <p>Consulta los grupos generados, filtra sus resultados y revisa los distritos que conforman cada agrupación.</p>
      </article>

      <article className="territory-filter-panel territory-options-panel">
        <div className="territory-options-grid">
          <label className="control-group territory-search-control">
            <span className="control-label">Búsqueda</span>
            <input
              className="control-input"
              type="search"
              placeholder="Buscar grupo, distrito, provincia o departamento"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
            />
          </label>
          <SearchableCombobox
            label="Departamento"
            value={filters.departamento}
            allLabel="Todos"
            options={departmentOptions}
            allowClear={false}
            onChange={(value) => onFilterChange("departamento", value)}
          />
          <SearchableCombobox
            label="Provincia"
            value={filters.provincia}
            allLabel="Todas"
            options={provinceOptions}
            allowClear={false}
            onChange={(value) => onFilterChange("provincia", value)}
          />
          <SearchableCombobox
            label="Distrito"
            value={filters.distrito}
            allLabel="Todos"
            options={options.districts}
            allowClear={false}
            onChange={(value) => onFilterChange("distrito", value)}
          />
          <SearchableCombobox
            label="Criticidad"
            value={filters.criticidad}
            allLabel="Todas"
            options={criticityOptions}
            allowClear={false}
            onChange={(value) => onFilterChange("criticidad", value)}
          />
          <SearchableCombobox
            label="EPS de referencia"
            value={filters.epsOriginId}
            allLabel="Todas las EPS"
            options={epsOptions}
            allowClear={false}
            onChange={(value) => onFilterChange("epsOriginId", value)}
          />
          <SearchableCombobox
            label="Cantidad de distritos"
            value={filters.zoneSize}
            allLabel="Todas"
            options={sizeOptions}
            allowClear={false}
            onChange={(value) => onFilterChange("zoneSize", value)}
          />
          <SearchableCombobox
            label="Ordenar por"
            value={sortBy}
            allLabel="Criticidad"
            options={sortOptions}
            allowClear={false}
            onChange={onSortChange}
          />
          <label className="control-group">
            <span className="control-label">Por página</span>
            <select
              className="control-select"
              value={pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
            >
              {[10, 20, 50].map((value) => (
                <option key={value} value={value}>
                  {value} grupos
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="territory-clear-button"
            onClick={onReset}
            disabled={!hasActiveFilters}
          >
            Limpiar filtros
          </button>
        </div>
      </article>
    </>
  );
}
