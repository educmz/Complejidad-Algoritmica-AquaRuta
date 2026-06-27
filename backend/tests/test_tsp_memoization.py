from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "backend" / "src"
sys.path.insert(0, str(SRC))

from algorithms.tsp_memorization import build_cost_matrix, solve_tsp_memoization
from services.tsp_service import TspService, TspServiceError


def destination(node_id, lat, lon, **overrides):
    data = {
        "id": node_id,
        "nombre": node_id,
        "center": [lat, lon],
        "interrupciones": 0,
        "criticidad": "baja",
        "prioridad_score": 0.4,
        "personas_afectadas_estimadas": 100,
        "peso_demanda_familiar": 0.1,
    }
    data.update(overrides)
    return data


class TspMemoizationAlgorithmTests(unittest.TestCase):
    def test_zero_destinations_returns_origin_only(self):
        result = solve_tsp_memoization([0, 0], [], use_priority_bonus=False)

        self.assertEqual(result["best_order"], [])
        self.assertEqual(result["total_distance"], 0)
        self.assertEqual(result["route_points"], [[0, 0]])

    def test_single_destination_returns_origin_to_destination(self):
        result = solve_tsp_memoization(
            [0, 0],
            [destination("A", 0, 2)],
            use_priority_bonus=False,
        )

        self.assertEqual([node["id"] for node in result["best_order"]], ["A"])
        self.assertEqual(result["total_distance"], 2)
        self.assertFalse(result["used_fallback"])

    def test_two_destinations_compares_both_orders(self):
        result = solve_tsp_memoization(
            [0, 0],
            [destination("A", 0, 2), destination("B", 0, 1)],
            use_priority_bonus=False,
        )

        self.assertEqual([node["id"] for node in result["best_order"]], ["B", "A"])
        self.assertEqual(result["total_distance"], 2)

    def test_known_exact_solution_visits_all_nodes_once(self):
        nodes = [
            destination("A", 0, 2),
            destination("B", 0, 1),
            destination("C", 0, 3),
        ]

        result = solve_tsp_memoization([0, 0], nodes, use_priority_bonus=False)

        self.assertEqual([node["id"] for node in result["best_order"]], ["B", "A", "C"])
        self.assertEqual(result["total_distance"], 3)
        self.assertEqual(sorted(node["id"] for node in result["best_order"]), ["A", "B", "C"])
        self.assertFalse(result["used_fallback"])

    def test_memoization_reports_cache_hits_or_reduced_states(self):
        nodes = [
            destination("A", 0, 1),
            destination("B", 1, 0),
            destination("C", 1, 1),
            destination("D", 2, 1),
        ]

        result = solve_tsp_memoization([0, 0], nodes, use_priority_bonus=False)

        self.assertGreater(result["cache_hits"], 0)

    def test_criteria_change_cost_matrix_values(self):
        nodes = [destination("A", 0, 2), destination("B", 0, 1)]

        distance_matrix = build_cost_matrix([0, 0], nodes, criterion="distancia")
        time_matrix = build_cost_matrix([0, 0], nodes, criterion="tiempo")
        cost_matrix = build_cost_matrix([0, 0], nodes, criterion="costo")

        self.assertNotEqual(distance_matrix[0][1], time_matrix[0][1])
        self.assertNotEqual(time_matrix[0][1], cost_matrix[0][1])

    def test_fallback_is_deterministic_and_visits_each_node_once(self):
        nodes = [destination(f"N{index}", 0, index) for index in range(1, 6)]

        first = solve_tsp_memoization([0, 0], nodes, use_priority_bonus=False, max_exact_nodes=3)
        second = solve_tsp_memoization([0, 0], nodes, use_priority_bonus=False, max_exact_nodes=3)

        self.assertTrue(first["used_fallback"])
        self.assertEqual([node["id"] for node in first["best_order"]], [node["id"] for node in second["best_order"]])
        self.assertEqual(sorted(node["id"] for node in first["best_order"]), [f"N{index}" for index in range(1, 6)])


class TspServiceTests(unittest.TestCase):
    def service(self):
        return TspService(
            ROOT,
            districts=[
                destination("A", 0, 2),
                destination("B", 0, 1),
                destination("C", 0, 3),
                {**destination("NO_CENTER", 0, 0), "center": None, "lat": None, "lon": None},
            ],
            eps_origins=[
                {"id": "eps-1", "prestador": "EPS 1", "lat": 0, "lon": 0},
            ],
        )

    def test_service_resolves_ids_and_preserves_priority_metadata(self):
        result = self.service().run("eps-1", ["A", "B"], criterion="distancia")

        self.assertEqual(result["metadata"]["implementation"], "python")
        self.assertEqual(result["summary"]["visitedNodes"], 2)
        self.assertIn("priorityScore", result["sequence"][0])
        self.assertEqual(result["edges"][0]["source"], "eps-1")

    def test_service_builds_distance_time_and_cost_results(self):
        service = self.service()

        distance = service.run("eps-1", ["A"], criterion="distancia")
        time = service.run("eps-1", ["A"], criterion="tiempo")
        cost = service.run("eps-1", ["A"], criterion="costo")

        self.assertLess(distance["summary"]["totalCost"], time["summary"]["totalCost"])
        self.assertLess(time["summary"]["totalCost"], cost["summary"]["totalCost"])

    def test_service_fallback(self):
        service = TspService(
            ROOT,
            districts=[destination(f"N{index}", 0, index) for index in range(1, 6)],
            eps_origins=[{"id": "eps-1", "prestador": "EPS 1", "lat": 0, "lon": 0}],
        )

        result = service.run("eps-1", [f"N{index}" for index in range(1, 6)], max_exact_nodes=3)

        self.assertTrue(result["summary"]["usedFallback"])
        self.assertEqual(result["summary"]["visitedNodes"], 5)

    def test_service_empty_destinations(self):
        result = self.service().run("eps-1", [])

        self.assertEqual(result["sequence"], [])
        self.assertEqual(result["summary"]["visitedNodes"], 0)

    def test_service_rejects_invalid_inputs(self):
        service = self.service()

        with self.assertRaises(TspServiceError):
            service.run("missing", ["A"])
        with self.assertRaises(TspServiceError):
            service.run("eps-1", ["A", "A"])
        with self.assertRaises(TspServiceError):
            service.run("eps-1", ["A"], criterion="prioridad")
        with self.assertRaises(TspServiceError):
            service.run("eps-1", ["NO_CENTER"])
        with self.assertRaises(TspServiceError):
            service.run("eps-1", ["A"], max_exact_nodes=99)


if __name__ == "__main__":
    unittest.main()
