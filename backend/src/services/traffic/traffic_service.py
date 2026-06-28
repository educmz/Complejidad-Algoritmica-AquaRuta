from config.operational_constants import (
    TRAFFIC_ESTIMATED_SOURCE,
    TRAFFIC_ESTIMATED_WARNING,
    TRAFFIC_MODE_ESTIMATED,
)
from .estimated_provider import EstimatedTrafficProvider


class TrafficService:
    def __init__(self, provider=None):
        self.provider = provider or EstimatedTrafficProvider()

    def get_route_metrics(
        self,
        base_duration_min,
        origin=None,
        destination=None,
        context=None,
    ):
        return self.provider.get_route_metrics(
            origin=origin,
            destination=destination,
            base_duration_min=base_duration_min,
            context=context,
        )

    def status(self) -> dict:
        return {
            "provider": TRAFFIC_ESTIMATED_SOURCE,
            "configured": True,
            "available": True,
            "mode": TRAFFIC_MODE_ESTIMATED,
            "cacheEnabled": False,
            "message": TRAFFIC_ESTIMATED_WARNING,
        }
