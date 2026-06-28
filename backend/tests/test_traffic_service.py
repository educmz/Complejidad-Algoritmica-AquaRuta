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

    def test_empty_ors_features_return_conceptual_route(self):
        service = ORSService.__new__(ORSService)
        service.traffic_service = TrafficService()
        response = service._normalize_geojson(
            {"features": []},
            source="eps",
            target="district",
            coordinates=[[-77.04, -12.04], [-77.10, -12.10]],
        )

        self.assertTrue(response["routeAvailable"])
        self.assertEqual(response["routeType"], "conceptual")
        self.assertEqual(response["routeMode"], "fallback")
        self.assertEqual(response["source"], "aquaruta_conceptual")
        self.assertEqual(response["features"][0]["geometry"]["type"], "LineString")
        self.assertGreater(response["primaryRoute"]["distanceKm"], 0)
        self.assertGreater(response["primaryRoute"]["durationMin"], 0)
        self.assertEqual(response["primaryRoute"]["traffic"]["trafficMode"], "estimated")
        self.assertEqual(len(response["alternatives"]), 1)
        serialized = json.dumps(response)
        self.assertNotIn("NaN", serialized)
        self.assertNotIn("Infinity", serialized)

    def test_equal_or_very_close_endpoints_do_not_require_route(self):
        service = ORSService.__new__(ORSService)
        service.traffic_service = TrafficService()
        response = service._normalize_geojson(
            {"features": []},
            coordinates=[[-77.04, -12.04], [-77.04, -12.04]],
        )

        self.assertFalse(response["routeAvailable"])
        self.assertEqual(response["routeType"], "not_required")
        self.assertEqual(response["traffic"]["baseDurationMin"], 0)
        self.assertEqual(response["traffic"]["liveDurationMin"], 0)
        self.assertEqual(response["traffic"]["trafficDelayMin"], 0)
        self.assertEqual(response["traffic"]["trafficFactor"], 1)

    def test_invalid_coordinates_keep_safe_unavailable_response(self):
        service = ORSService.__new__(ORSService)
        response = service._unavailable_response(
            "eps",
            "district",
            "unavailable",
            coordinates=[[math.nan, -12], [-77, -11]],
        )
        self.assertEqual(response["features"], [])
        self.assertIsNone(response["metrics"]["trafficFactor"])

    def test_successful_ors_response_is_explicitly_road(self):
        service = ORSService.__new__(ORSService)
        service.traffic_service = TrafficService()
        service.config = type("Config", (), {
            "max_operational_distance_km": 80,
            "max_operational_duration_min": 180,
            "max_operational_cost": 600,
        })()
        response = service._normalize_geojson({
            "features": [{
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[-77.04, -12.04], [-77.10, -12.10]],
                },
                "properties": {
                    "summary": {"distance": 9000, "duration": 1200},
                },
            }],
        }, source="eps", target="district")

        self.assertEqual(response["routeType"], "road")
        self.assertEqual(response["routeMode"], "ors")
        self.assertEqual(response["source"], "openrouteservice")
        self.assertEqual(response["primaryRoute"]["routeType"], "road")

    def test_local_view_has_distinct_identity_and_cache_key(self):
        service = ORSService.__new__(ORSService)
        service.traffic_service = TrafficService()
        coordinates = [[-77.04, -12.04], [-77.10, -12.10]]
        response = service._local_response("eps", "district", coordinates)
        road_key, _ = service._cache_key(coordinates, 3, view_mode="road")
        local_key, _ = service._cache_key(coordinates, 3, view_mode="local")

        self.assertNotEqual(road_key, local_key)
        self.assertEqual(response["routeType"], "local")
        self.assertEqual(response["routeMode"], "local_estimated")
        self.assertEqual(response["source"], "aquaruta_local")
        self.assertEqual(response["primaryRoute"]["routeType"], "local")

    def test_conceptual_cache_never_matches_road_mode(self):
        service = ORSService.__new__(ORSService)
        conceptual = {
            "routeType": "conceptual",
            "routeMode": "fallback",
            "source": "aquaruta_conceptual",
            "edge_type": "conceptual_route",
            "features": [{
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[-77.04, -12.04], [-77.10, -12.10]],
                },
                "properties": {
                    "summary": {"distance": 9000, "duration": 1200},
                },
            }],
        }
        self.assertFalse(service._cache_matches_mode(conceptual, "road"))

    def test_ors_segments_are_normalized_when_summary_is_missing(self):
        service = ORSService.__new__(ORSService)
        feature = service._normalize_ors_feature({
            "geometry": {
                "type": "LineString",
                "coordinates": [[-77.04, -12.04], [-77.10, -12.10]],
            },
            "properties": {
                "segments": [
                    {"distance": 4000, "duration": 600},
                    {"distance": 5000, "duration": 700},
                ],
            },
        })
        self.assertIsNotNone(feature)
        self.assertEqual(feature["properties"]["summary"]["distance"], 9000)
        self.assertEqual(feature["properties"]["summary"]["duration"], 1300)

    def test_empty_geometry_is_not_accepted_as_ors_road(self):
        service = ORSService.__new__(ORSService)
        feature = service._normalize_ors_feature({
            "geometry": {"type": "LineString", "coordinates": []},
            "properties": {
                "summary": {"distance": 9000, "duration": 1200},
            },
        })
        self.assertIsNone(feature)


if __name__ == "__main__":
    unittest.main()
