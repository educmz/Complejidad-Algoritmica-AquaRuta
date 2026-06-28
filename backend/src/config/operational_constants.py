ROAD_DISTANCE_FACTOR = 1.35
AVERAGE_SPEED_KMH = 28.0
DISTANCE_COST_FACTOR = 4.6
TIME_COST_FACTOR = 0.85
DEFAULT_TIMEOUT_SECONDS = 12.0
ORS_MAX_ALTERNATIVE_ROUTES = 3

DEFAULT_ESTIMATED_TRAFFIC_FACTOR = 1.15
MIN_TRAFFIC_FACTOR = 1.0
MAX_TRAFFIC_FACTOR = 1.6
TRAFFIC_ESTIMATED_SOURCE = "aquaruta_estimated"
TRAFFIC_MODE_ESTIMATED = "estimated"
TRAFFIC_STATUS_ESTIMATED_LABEL = "Tráfico estimado"
TRAFFIC_ESTIMATED_WARNING = (
    "Tráfico estimado por AquaRuta. No corresponde a tráfico vehicular en vivo."
)

DEFAULT_CONCEPTUAL_ROUTE_SPEED_KMH = 28.0
CONCEPTUAL_ROUTE_SOURCE = "aquaruta_conceptual"
CONCEPTUAL_ROUTE_WARNING = (
    "OpenRouteService no encontró una ruta vial por calles. "
    "Se muestra una referencia aproximada."
)
CONCEPTUAL_ROUTE_MIN_DISTANCE_KM = 0.01
LOCAL_ROUTE_SOURCE = "aquaruta_local"
LOCAL_ROUTE_WARNING = (
    "Conexión local estimada por AquaRuta. No corresponde a una ruta vial validada."
)

