export default function MapToolbar({
  expanded = false,
  legendVisible = true,
  layersActive = false,
  onToggleExpanded,
  onToggleLayers,
  onToggleLegend,
  onCenter,
  layersLabel = "Capas",
  centerLabel = "Centrar seleccion",
  centerBeforeLegend = false,
}) {
  const centerButton = onCenter ? (
    <button
      type="button"
      aria-label={centerLabel}
      title="Centrar seleccion"
      onClick={onCenter}
    >
      <span className="toolbar-icon toolbar-icon-target" aria-hidden="true" />
      <span>Centrar</span>
    </button>
  ) : null;

  return (
    <div className="dashboard-map-toolbar" aria-label="Controles del mapa">
      {onToggleExpanded && (
        <button
          type="button"
          aria-label={expanded ? "Reducir mapa" : "Ampliar mapa"}
          aria-pressed={expanded}
          title={expanded ? "Reducir mapa" : "Ampliar mapa"}
          onClick={onToggleExpanded}
        >
          <span className="toolbar-icon toolbar-icon-expand" aria-hidden="true" />
          <span>{expanded ? "Reducir" : "Ampliar"}</span>
        </button>
      )}
      {centerBeforeLegend && centerButton}
      {onToggleLayers && (
        <button
          type="button"
          aria-label={layersLabel}
          aria-pressed={layersActive}
          title="Capas"
          onClick={onToggleLayers}
        >
          <span className="toolbar-icon toolbar-icon-layers" aria-hidden="true" />
          <span>Capas</span>
        </button>
      )}
      {onToggleLegend && (
        <button
          type="button"
          aria-label={legendVisible ? "Ocultar leyenda" : "Mostrar leyenda"}
          aria-expanded={legendVisible}
          title="Leyenda"
          onClick={onToggleLegend}
        >
          <span className="toolbar-icon toolbar-icon-legend" aria-hidden="true" />
          <span>Leyenda</span>
        </button>
      )}
      {!centerBeforeLegend && centerButton}
    </div>
  );
}
