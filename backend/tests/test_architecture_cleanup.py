from pathlib import Path
import importlib.util
import sys
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "backend" / "src"
sys.path.insert(0, str(SRC))

from config.algorithm_limits import (
    MAX_BACKTRACKING_NODES,
    MAX_DIJKSTRA_NEIGHBORS,
    MAX_SECTORIZATION_DEPTH,
    MAX_TSP_EXACT_NODES,
)
from config.operational_constants import (
    AVERAGE_SPEED_KMH,
    DISTANCE_COST_FACTOR,
    ROAD_DISTANCE_FACTOR,
    TIME_COST_FACTOR,
)
from services.ors_service import ORSService, RouteConfig


def load_backend_app():
    module_path = ROOT / "backend" / "app.py"
    spec = importlib.util.spec_from_file_location("aquaruta_backend_app_cleanup", module_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ArchitectureCleanupTests(unittest.TestCase):
    def test_public_routes_remain_registered(self):
        backend_app = load_backend_app()
        routes = {
            (route.path, ",".join(sorted(route.methods or [])))
            for route in backend_app.app.routes
        }

        expected = {
            ("/grouping/run", "POST"),
            ("/local-exploration/tsp", "POST"),
            ("/local-exploration/dijkstra", "POST"),
            ("/local-exploration/traversal", "POST"),
            ("/local-exploration/backtracking", "POST"),
            ("/sectorization/run", "POST"),
            ("/route", "POST"),
            ("/routes-batch", "POST"),
            ("/dashboard", "GET"),
        }
        self.assertTrue(expected.issubset(routes))

    def test_centralized_constants_preserve_current_values(self):
        self.assertEqual(MAX_TSP_EXACT_NODES, 12)
        self.assertEqual(MAX_DIJKSTRA_NEIGHBORS, 20)
        self.assertEqual(MAX_BACKTRACKING_NODES, 10)
        self.assertEqual(MAX_SECTORIZATION_DEPTH, 12)
        self.assertEqual(ROAD_DISTANCE_FACTOR, 1.35)
        self.assertEqual(AVERAGE_SPEED_KMH, 28.0)
        self.assertEqual(DISTANCE_COST_FACTOR, 4.6)
        self.assertEqual(TIME_COST_FACTOR, 0.85)

    def test_ors_sqlite_connection_is_closed_after_context(self):
        connection = Mock()
        with patch("services.ors_service.sqlite3.connect", return_value=connection):
            config = RouteConfig(
                api_key=None,
                base_url="https://example.invalid",
                timeout_seconds=1,
                max_retries=0,
                alternative_target_count=1,
                cache_ttl_hours=1,
                max_operational_distance_km=100,
                max_operational_duration_min=200,
                max_operational_cost=800,
                cache_path=ROOT / "data" / "cache" / "mocked_ors.sqlite3",
                cooldown_seconds=0,
            )
            service = ORSService(config)
            with service._connect() as active_connection:
                self.assertIs(active_connection, connection)

        self.assertGreaterEqual(connection.commit.call_count, 2)
        self.assertGreaterEqual(connection.close.call_count, 2)

    def test_dashboard_filters_do_not_return_data_outside_context(self):
        backend_app = load_backend_app()
        all_data = backend_app.get_dashboard()
        districts = all_data["districts"]
        sample = next(item for item in districts if item.get("departamento"))

        response = backend_app.get_dashboard(departamento=sample["departamento"])

        self.assertTrue(response["districts"])
        self.assertTrue(
            all(item["departamento"] == sample["departamento"] for item in response["districts"])
        )

    def test_dashboard_incompatible_eps_and_department_returns_empty_context(self):
        backend_app = load_backend_app()
        districts = backend_app.get_dashboard()["districts"]
        departments_by_eps = {}
        for district in districts:
            departments_by_eps.setdefault(district.get("eps_principal"), set()).add(
                district.get("departamento")
            )

        eps, departments = next(
            (eps, departments)
            for eps, departments in departments_by_eps.items()
            if eps and len(departments) >= 1
        )
        incompatible_department = next(
            district["departamento"]
            for district in districts
            if district.get("departamento") not in departments
        )

        response = backend_app.get_dashboard(eps=eps, departamento=incompatible_department)

        self.assertEqual(response["districts"], [])
        self.assertEqual(response["groupedZones"], [])

    def test_dashboard_incompatible_province_or_district_returns_empty_context(self):
        backend_app = load_backend_app()
        districts = backend_app.get_dashboard()["districts"]
        sample = next(item for item in districts if item.get("provincia"))
        incompatible_province = next(
            item["provincia"]
            for item in districts
            if item.get("departamento") != sample["departamento"] and item.get("provincia")
        )

        response = backend_app.get_dashboard(
            departamento=sample["departamento"],
            provincia=incompatible_province,
        )
        self.assertEqual(response["districts"], [])

        response = backend_app.get_dashboard(
            provincia=incompatible_province,
            distrito=sample["id"],
        )
        self.assertEqual(response["districts"], [])

    def test_dashboard_group_outside_selected_district_returns_empty_context(self):
        backend_app = load_backend_app()
        all_data = backend_app.get_dashboard()
        group = next(group for group in all_data["groupedZones"] if group.get("zona_ids"))
        outside_district = next(
            district for district in all_data["districts"] if district["id"] not in group["zona_ids"]
        )

        response = backend_app.get_dashboard(grupo=group["id"], distrito=outside_district["id"])

        self.assertEqual(response["districts"], [])
