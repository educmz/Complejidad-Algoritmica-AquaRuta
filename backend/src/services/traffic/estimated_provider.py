from datetime import datetime, timezone
import math

from config.operational_constants import (
    DEFAULT_ESTIMATED_TRAFFIC_FACTOR,
    MAX_TRAFFIC_FACTOR,
    MIN_TRAFFIC_FACTOR,
    TRAFFIC_ESTIMATED_SOURCE,
    TRAFFIC_ESTIMATED_WARNING,
    TRAFFIC_MODE_ESTIMATED,
)
from .base import TrafficProvider
from .models import TrafficMetrics


class EstimatedTrafficProvider(TrafficProvider):
    def get_route_metrics(
        self,
        origin=None,
        destination=None,
        base_duration_min=0,
        context=None,
    ) -> TrafficMetrics:
        del origin, destination, context
        try:
            base_duration = float(base_duration_min)
        except (TypeError, ValueError):
            base_duration = 0.0
        if not math.isfinite(base_duration) or base_duration <= 0:
            base_duration = 0.0
            factor = 1.0
        else:
            factor = max(
                MIN_TRAFFIC_FACTOR,
                min(MAX_TRAFFIC_FACTOR, float(DEFAULT_ESTIMATED_TRAFFIC_FACTOR)),
            )

        live_duration = base_duration * factor
        delay = max(0.0, live_duration - base_duration)
        updated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
        return TrafficMetrics(
            base_duration_min=round(base_duration, 2),
            live_duration_min=round(live_duration, 2),
            traffic_delay_min=round(delay, 2),
            traffic_factor=round(factor, 3),
            traffic_source=TRAFFIC_ESTIMATED_SOURCE,
            traffic_mode=TRAFFIC_MODE_ESTIMATED,
            traffic_updated_at=updated_at,
            traffic_is_stale=False,
            traffic_warning=TRAFFIC_ESTIMATED_WARNING,
        )
