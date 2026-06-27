from pathlib import Path
import importlib.util
import sys
import unittest

from fastapi import HTTPException
from pydantic import ValidationError

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "backend" / "src"
sys.path.insert(0, str(SRC))

from algorithms.divide_conquer import sectorize_divide_and_conquer
from services.sectorization_service import SectorizationService


def load_backend_app():
    module_path = ROOT / "backend" / "app.py"
    spec = importlib.util.spec_from_file_location("aquaruta_backend_app_sectorization", module_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def node(index, lat=None, lon=None, **overrides):
    data = {
        "id": f"N{index:02d}",
        "nombre": f"Nodo {index:02d}",
        "center": [lat if lat is not None else -12.0 + index * 0.01, lon if lon is not None else -77.0],
        "interrupciones": index * 10,
        "criticidad": "media",
        "personas_afectadas_estimadas": index * 100,
        "peso_demanda_familiar": index / 100,
        "prioridad_score": index / 10,
        "promedio_integrantes_hogar": 3.5,
        "conexiones_afectadas_evento_max": index,
    }
    data.update(overrides)
    return data


def assert_invariants(testcase, result, input_nodes, max_sector_size, allow_oversize=False):
    input_ids = {item["id"] for item in input_nodes}
    output_ids = [
        item["id"]
        for sector in result["sectors"]
        for item in sector["nodes"]
    ]
    testcase.assertEqual(set(output_ids), input_ids)
    testcase.assertEqual(len(output_ids), len(set(output_ids)))
    testcase.assertTrue(all(sector["nodes"] for sector in result["sectors"]))
    if not allow_oversize:
        testcase.assertTrue(all(len(sector["nodes"]) <= max_sector_size for sector in result["sectors"]))


class DivideConquerAlgorithmTests(unittest.TestCase):
    def test_base_case_small_group(self):
        nodes = [node(index) for index in range(4)]
        result = sectorize_divide_and_conquer(nodes, max_sector_size=5)

        self.assertEqual(len(result["sectors"]), 1)
        self.assertEqual(result["metrics"]["split_count"], 0)
        self.assertEqual(result["metrics"]["base_case_count"], 1)
        assert_invariants(self, result, nodes, 5)

    def test_single_split_balanced(self):
        nodes = [node(index, lon=-77 + index) for index in range(6)]
        result = sectorize_divide_and_conquer(nodes, max_sector_size=3)

        self.assertEqual([len(sector["nodes"]) for sector in result["sectors"]], [3, 3])
        self.assertEqual(result["metrics"]["split_count"], 1)
        assert_invariants(self, result, nodes, 3)

    def test_multiple_levels_for_seventeen_nodes(self):
        nodes = [node(index, lon=-77 + index * 0.01) for index in range(17)]
        result = sectorize_divide_and_conquer(nodes, max_sector_size=4)

        self.assertGreater(result["metrics"]["recursive_calls"], 3)
        self.assertGreater(result["metrics"]["split_count"], 1)
        self.assertGreater(result["metrics"]["max_depth_reached"], 1)
        assert_invariants(self, result, nodes, 4)

    def test_odd_size_splits_are_balanced(self):
        nodes = [node(index, lon=-77 + index) for index in range(7)]
        result = sectorize_divide_and_conquer(nodes, max_sector_size=4)
        sizes = sorted(len(sector["nodes"]) for sector in result["sectors"])

        self.assertEqual(sizes, [3, 4])
        assert_invariants(self, result, nodes, 4)

    def test_identical_coordinates_terminate_with_stable_fallback(self):
        nodes = [node(index, lat=-12, lon=-77) for index in range(7)]
        result = sectorize_divide_and_conquer(nodes, max_sector_size=3)

        self.assertLessEqual(result["metrics"]["max_depth_reached"], 10)
        assert_invariants(self, result, nodes, 3)

    def test_duplicate_and_empty_inputs_are_rejected(self):
        with self.assertRaises(ValueError):
            sectorize_divide_and_conquer([])
        with self.assertRaises(ValueError):
            sectorize_divide_and_conquer([node(1), node(1)])

    def test_single_node(self):
        nodes = [node(1)]
        result = sectorize_divide_and_conquer(nodes, max_sector_size=3)

        self.assertEqual(len(result["sectors"]), 1)
        self.assertEqual(result["sectors"][0]["nodes"][0]["id"], "N01")

    def test_determinism_with_unordered_input(self):
        nodes = [node(index, lon=-77 + index) for index in range(8)]
        first = sectorize_divide_and_conquer(list(reversed(nodes)), max_sector_size=2)
        second = sectorize_divide_and_conquer(list(reversed(nodes)), max_sector_size=2)
        first_ids = [[item["id"] for item in sector["nodes"]] for sector in first["sectors"]]
        second_ids = [[item["id"] for item in sector["nodes"]] for sector in second["sectors"]]

        self.assertEqual(first_ids, second_ids)

    def test_geographic_axis_selection(self):
        lon_nodes = [node(index, lat=-12, lon=-77 + index) for index in range(6)]
        lon_result = sectorize_divide_and_conquer(lon_nodes, max_sector_size=3)
        self.assertEqual(lon_result["split_trace"][0]["splitBy"], "longitude")

        lat_nodes = [node(index, lat=-12 + index, lon=-77) for index in range(6)]
        lat_result = sectorize_divide_and_conquer(lat_nodes, max_sector_size=3)
        self.assertEqual(lat_result["split_trace"][0]["splitBy"], "latitude")

    def test_max_depth_warning_allows_oversize_sector(self):
        nodes = [node(index) for index in range(8)]
        result = sectorize_divide_and_conquer(nodes, max_sector_size=2, max_depth=0)

        self.assertTrue(result["warnings"])
        assert_invariants(self, result, nodes, 2, allow_oversize=True)


class SectorizationServiceTests(unittest.TestCase):
    def setUp(self):
        self.nodes = [node(index) for index in range(6)]
        self.group = {
            "id": "grupo-test",
            "nombre": "Grupo Test",
            "zona_ids": [item["id"] for item in self.nodes],
            "center": [-12, -77],
        }
        self.service = SectorizationService(ROOT, districts=self.nodes, grouped_zones=[self.group])

    def test_service_resolves_group_and_generates_stable_ids(self):
        response = self.service.run("grupo-test", max_sector_size=3)

        self.assertEqual(response["metadata"]["algorithm"], "divide_and_conquer")
        self.assertEqual(response["metadata"]["implementation"], "python")
        self.assertEqual(response["summary"]["inputNodes"], 6)
        self.assertEqual(response["summary"]["duplicatedNodes"], 0)
        self.assertEqual(response["summary"]["missingNodes"], 0)
        self.assertTrue(response["summary"]["allNodesCovered"])
        self.assertEqual(response["sectors"][0]["sectorId"], "grupo-test-sector-1")
        self.assertIn("estimatedAffectedPeople", response["sectors"][0]["summary"])

    def test_service_warns_when_depth_prevents_size_limit(self):
        response = self.service.run("grupo-test", max_sector_size=2, max_depth=0)

        self.assertFalse(response["summary"]["maxSectorSizeSatisfied"])
        self.assertTrue(response["warnings"])

    def test_service_rejects_invalid_group_nodes_and_coordinates(self):
        with self.assertRaises(ValueError):
            self.service.run("no-existe")
        with self.assertRaises(ValueError):
            self.service.run("grupo-test", node_ids=["N01", "N01"])
        with self.assertRaises(ValueError):
            self.service.run("grupo-test", node_ids=["fuera"])

        invalid = [node(1, center=None)]
        service = SectorizationService(
            ROOT,
            districts=invalid,
            grouped_zones=[{"id": "grupo-invalid", "nombre": "Invalid", "zona_ids": ["N01"]}],
        )
        with self.assertRaises(ValueError):
            service.run("grupo-invalid")


class SectorizationEndpointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.backend_app = load_backend_app()
        cls.nodes = [node(index) for index in range(7)]
        cls.backend_app.sectorization_service = SectorizationService(
            ROOT,
            districts=cls.nodes,
            grouped_zones=[
                {
                    "id": "grupo-api",
                    "nombre": "Grupo API",
                    "zona_ids": [item["id"] for item in cls.nodes],
                    "center": [-12, -77],
                }
            ],
        )

    def test_endpoint_returns_small_group_single_sector(self):
        payload = self.backend_app.SectorizationRunRequest(
            groupId="grupo-api",
            nodeIds=["N00", "N01"],
            maxSectorSize=5,
            splitCriterion="geografico",
        )
        response = self.backend_app.run_sectorization(payload)

        self.assertEqual(response["metadata"]["splitCount"], 0)
        self.assertEqual(response["summary"]["outputSectors"], 1)

    def test_endpoint_returns_divided_group(self):
        payload = self.backend_app.SectorizationRunRequest(
            groupId="grupo-api",
            maxSectorSize=3,
            splitCriterion="geografico",
        )
        response = self.backend_app.run_sectorization(payload)

        self.assertGreater(response["metadata"]["splitCount"], 0)
        self.assertTrue(response["summary"]["allNodesCovered"])

    def test_endpoint_returns_depth_warning(self):
        payload = self.backend_app.SectorizationRunRequest(
            groupId="grupo-api",
            maxSectorSize=2,
            maxDepth=0,
        )
        response = self.backend_app.run_sectorization(payload)

        self.assertTrue(response["warnings"])

    def test_endpoint_validation_errors(self):
        with self.assertRaises(ValidationError):
            self.backend_app.SectorizationRunRequest(groupId="grupo-api", maxSectorSize=0)
        with self.assertRaises(ValidationError):
            self.backend_app.SectorizationRunRequest(groupId="grupo-api", splitCriterion="kmeans")
        with self.assertRaises(ValidationError):
            self.backend_app.SectorizationRunRequest(groupId="grupo-api", nodeIds=["N01", "N01"])

        payload = self.backend_app.SectorizationRunRequest(groupId="no-existe")
        with self.assertRaises(HTTPException) as context:
            self.backend_app.run_sectorization(payload)
        self.assertEqual(context.exception.status_code, 422)
