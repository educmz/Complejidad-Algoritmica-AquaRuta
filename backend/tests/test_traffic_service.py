from pathlib import Path
import json
import math
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend" / "src"))

from config.operational_constants import MAX_TRAFFIC_FACTOR, MIN_TRAFFIC_FACTOR
from services.ors_service import ORSService
from services.traffic import EstimatedTrafficProvider, TrafficService


class TrafficServiceTests(unittest.TestCase):
    def test_status_describes_estimated_provider(self):
        status = TrafficService().status()
        self.assertTrue(status["configured"])
        self.assertTrue(status["available"])
        self.assertEqual(status["provider"], "aquaruta_estimated")
        self.assertEqual(status["mode"], "estimated")

    def test_valid_duration_is_estimated_and_serialized_in_camel_case(self):
        metrics = EstimatedTrafficProvider().get_route_metrics(base_duration_min=20)
        payload = metrics.to_dict()
        self.assertEqual(payload["baseDurationMin"], 20)
        self.assertEqual(payload["liveDurationMin"], 23)
        self.assertEqual(payload["trafficDelayMin"], 3)
        self.assertEqual(payload["trafficMode"], "estimated")
        self.assertEqual(payload["trafficSource"], "aquaruta_estimated")
        self.assertGreaterEqual(payload["trafficFactor"], MIN_TRAFFIC_FACTOR)
        self.assertLessEqual(payload["trafficFactor"], MAX_TRAFFIC_FACTOR)

    def test_zero_and_invalid_durations_are_safe(self):
        for value in (0, -2, None, "invalid", math.nan, math.inf, -math.inf):
            payload = EstimatedTrafficProvider().get_route_metrics(
                base_duration_min=value
            ).to_dict()
            self.assertEqual(payload["baseDurationMin"], 0)
            self.assertEqual(payload["liveDurationMin"], 0)
            self.assertEqual(payload["trafficDelayMin"], 0)
            self.assertEqual(payload["trafficFactor"], 1)
            self.assertNotIn("NaN", json.dumps(payload))
            self.assertNotIn("Infinity", json.dumps(payload))

    def test_ors_routes_and_metrics_include_traffic(self):
        service = ORSService.__new__(ORSService)
        service.traffic_service = TrafficService()
        feature = {
            "geometry": {"type": "LineString", "coordinates": [[-77, -12], [-76, -11]]},
            "properties": {"summary": {"distance": 1000, "duration": 600}},
        }
        route = service._route_from_feature(feature)
        self.assertEqual(route["traffic"]["trafficDelayMin"], 1.5)

        service.config = type("Config", (), {
            "max_operational_distance_km": 80,
            "max_operational_duration_min": 180,
            "max_operational_cost": 600,
        })()
        metrics = service._metrics_from_routes(route, [])
        self.assertEqual(metrics["traffic"], route["traffic"])
        self.assertEqual(metrics["trafficMode"], "estimated")

    def test_unavailable_response_contains_only_json_safe_traffic_values(self):
        service = ORSService.__new__(ORSService)
        payload = service._unavailable_response("a", "b", "unavailable")
        serialized = json.dumps(payload)
        self.assertNotIn("NaN", serialized)
        self.assertNotIn("Infinity", serialized)
        self.assertIsNone(payload["metrics"]["trafficFactor"])

    def test_legacy_cached_response_is_enriched_with_traffic(self):
        service = ORSService.__new__(ORSService)
        service.traffic_service = TrafficService()
        cached = service._mark_cached({
            "primaryRoute": {"durationMin": 10},
            "alternatives": [{"durationMin": 12}],
            "metrics": {"duracion_principal_min": 10},
        })
        self.assertEqual(cached["primaryRoute"]["traffic"]["trafficDelayMin"], 1.5)
        self.assertEqual(cached["alternatives"][0]["traffic"]["trafficDelayMin"], 1.8)
        self.assertEqual(cached["metrics"]["trafficMode"], "estimated")


if __name__ == "__main__":
    unittest.main()
