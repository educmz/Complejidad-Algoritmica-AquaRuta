from dataclasses import dataclass


@dataclass(frozen=True)
class TrafficMetrics:
    base_duration_min: float
    live_duration_min: float
    traffic_delay_min: float
    traffic_factor: float
    traffic_source: str
    traffic_mode: str
    traffic_updated_at: str
    traffic_is_stale: bool
    traffic_warning: str | None = None

    def to_dict(self) -> dict:
        return {
            "baseDurationMin": self.base_duration_min,
            "liveDurationMin": self.live_duration_min,
            "trafficDelayMin": self.traffic_delay_min,
            "trafficFactor": self.traffic_factor,
            "trafficSource": self.traffic_source,
            "trafficMode": self.traffic_mode,
            "trafficUpdatedAt": self.traffic_updated_at,
            "trafficIsStale": self.traffic_is_stale,
            "trafficWarning": self.traffic_warning,
        }
