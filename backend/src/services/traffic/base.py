from abc import ABC, abstractmethod


class TrafficProvider(ABC):
    @abstractmethod
    def get_route_metrics(
        self,
        origin=None,
        destination=None,
        base_duration_min=0,
        context=None,
    ):
        """Return traffic metrics for a route without changing the route."""
