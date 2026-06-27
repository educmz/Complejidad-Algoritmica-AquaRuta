from pathlib import Path
import importlib.util
import sys
import unittest

from fastapi import HTTPException
from pydantic import ValidationError

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "backend" / "src"
sys.path.insert(0, str(SRC))

from algorithms.backtracking import solve_backtracking
from services.backtracking_service import BacktrackingService


def load_backend_app():
    module_path = ROOT / "backend" / "app.py"
    spec = importlib.util.spec_from_file_location("aquaruta_backend_app_backtracking", module_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def metrics(value):
    return {
        "distance_km": float(value),
        "road_distance_km": float(value),
        "duration_min": float(value),
        "operational_cost": float(value),
        "distance_weight": float(value),
        "time_weight": float(value),
        "cost_weight": float(value),
    }


def matrix(values):
    return [[metrics(value) for value in row] for row in values]


def district(node_id, lat, lon, priority=0.0):
    return {
        "id": node_id,
        "nombre": node_id,
        "center": [lat, lon],
        "interrupciones": 0,
        "criticidad": "baja",
        "duracion_promedio_horas": 0,
        "peso_demanda_familiar": 0,
        "prioridad_score": priority,
        "personas_afectadas_estimadas": 10,
    }


class BacktrackingAlgorithmTests(unittest.TestCase):
    def test_decision_backtrack_and_state_restoration(self):
        destinations = [district("A", 0, 0, 0.1), district("B", 0, 0, 0.2)]
        result = solve_backtracking(
            {"id": "O"},
            destinations,
            matrix(
                [
                    [0, 10, 1],
                    [10, 0, 1],
                    [1, 1, 0],
                ]
            ),
            constraints={"max_visits": 1},
            criterion="distancia",
        )

        self.assertEqual([node["id"] for node in result["sequence"]], ["B"])
        self.assertGreaterEqual(result["backtracks"], 2)
        self.assertTrue(result["final_state_restored"])

    def test_restriction_rejects_expensive_sequence(self):
        destinations = [district("A", 0, 0)]
        result = solve_backtracking(
            {"id": "O"},
            destinations,
            matrix([[0, 5], [5, 0]]),
            constraints={"max_visits": 1, "max_operational_cost": 1},
            criterion="costo",
        )

        self.assertFalse(result["feasible"])
        self.assertEqual(result["sequence"], [])
        self.assertGreater(result["pruned_branches"], 0)

    def test_prunes_branch_that_cannot_improve_best_cost(self):
        destinations = [district("A", 0, 0), district("B", 0, 0), district("C", 0, 0)]
        result = solve_backtracking(
            {"id": "O"},
            destinations,
            matrix(
                [
                    [0, 1, 9, 10],
                    [1, 0, 1, 10],
                    [9, 1, 0, 1],
                    [10, 1, 1, 0],
                ]
            ),
            constraints={"max_visits": 2},
            criterion="distancia",
        )

        self.assertEqual([node["id"] for node in result["sequence"]], ["A", "B"])
        self.assertEqual(result["objective_value"], 2)
        self.assertGreater(result["pruned_branches"], 0)

    def test_known_priority_solution(self):
        destinations = [
            district("A", 0, 0, 0.2),
            district("B", 0, 0, 0.9),
            district("C", 0, 0, 0.4),
        ]
        result = solve_backtracking(
            {"id": "O"},
            destinations,
            matrix(
                [
                    [0, 1, 1, 1],
                    [1, 0, 1, 1],
                    [1, 1, 0, 1],
                    [1, 1, 1, 0],
                ]
            ),
            constraints={"max_visits": 2},
            criterion="prioridad",
        )

        self.assertTrue(result["feasible"])
        self.assertEqual([node["id"] for node in result["sequence"]], ["B", "C"])
        self.assertEqual(result["objective"], "maximize_priority_under_constraints")
        self.assertAlmostEqual(result["objective_value"], 1.3)
        self.assertEqual(len(result["sequence"]), len({node["id"] for node in result["sequence"]}))
        self.assertFalse(result["used_fallback"])

    def test_empty_and_single_destination_cases(self):
        empty = solve_backtracking({"id": "O"}, [], [], criterion="distancia")
        self.assertFalse(empty["feasible"])

        single = solve_backtracking(
            {"id": "O"},
            [district("A", 0, 0)],
            matrix([[0, 3], [3, 0]]),
            constraints={"max_visits": 1},
            criterion="distancia",
        )
        self.assertEqual([node["id"] for node in single["sequence"]], ["A"])

    def test_backtracking_can_choose_subset_unlike_tsp(self):
        destinations = [district("A", 0, 0), district("B", 0, 0), district("C", 0, 0), district("D", 0, 0)]
        result = solve_backtracking(
            {"id": "O"},
            destinations,
            matrix(
                [
                    [0, 1, 2, 3, 4],
                    [1, 0, 1, 1, 1],
                    [2, 1, 0, 1, 1],
                    [3, 1, 1, 0, 1],
                    [4, 1, 1, 1, 0],
                ]
            ),
            constraints={"max_visits": 2},
            criterion="distancia",
        )

        self.assertEqual(len(result["sequence"]), 2)
        self.assertLess(len(result["sequence"]), len(destinations))

    def test_deterministic_result(self):
        destinations = [district("A", 0, 0), district("B", 0, 0)]
        cost_matrix = matrix([[0, 2, 1], [2, 0, 1], [1, 1, 0]])
        first = solve_backtracking({"id": "O"}, destinations, cost_matrix, {"max_visits": 1}, "distancia")
        second = solve_backtracking({"id": "O"}, destinations, cost_matrix, {"max_visits": 1}, "distancia")
        self.assertEqual(first["sequence"], second["sequence"])


class BacktrackingServiceTests(unittest.TestCase):
    def setUp(self):
        self.service = BacktrackingService(
            ROOT,
            districts=[
                district("A", -12.0, -77.0, 0.4),
                district("B", -12.01, -77.01, 0.9),
                district("C", -12.02, -77.02, 0.2),
            ],
            eps_origins=[{"id": "EPS_1", "prestador": "EPS Uno", "lat": -12.0, "lon": -77.001}],
        )

    def test_service_returns_feasible_sequence_and_metrics(self):
        response = self.service.run(
            "EPS_1",
            ["A", "B", "C"],
            criterion="prioridad",
            constraints={"maxVisits": 2, "maxDistanceKm": 100, "maxDurationMin": 500, "maxOperationalCost": 1000},
        )

        self.assertTrue(response["feasible"])
        self.assertEqual(response["metadata"]["algorithm"], "backtracking")
        self.assertEqual(response["metadata"]["implementation"], "python")
        self.assertEqual(response["summary"]["visitedDestinations"], 2)
        self.assertGreaterEqual(response["summary"]["prunedBranches"], 0)
        self.assertTrue(response["summary"]["finalStateRestored"])
        self.assertEqual(len(response["unvisitedDestinations"]), 1)

    def test_service_returns_infeasible_without_http_error(self):
        response = self.service.run(
            "EPS_1",
            ["A"],
            criterion="costo",
            constraints={"maxVisits": 1, "maxOperationalCost": 0.01},
        )

        self.assertFalse(response["feasible"])
        self.assertEqual(response["sequence"], [])
        self.assertGreater(response["summary"]["prunedBranches"], 0)

    def test_service_uses_fallback_for_large_sets(self):
        many = [district(f"D{i}", -12.0 - i * 0.001, -77.0, i / 20) for i in range(12)]
        service = BacktrackingService(
            ROOT,
            districts=many,
            eps_origins=[{"id": "EPS_1", "prestador": "EPS Uno", "lat": -12.0, "lon": -77.0}],
        )
        response = service.run("EPS_1", [node["id"] for node in many], max_exact_nodes=10)

        self.assertTrue(response["summary"]["usedFallback"])


class BacktrackingEndpointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.backend_app = load_backend_app()
        cls.backend_app.backtracking_service = BacktrackingService(
            ROOT,
            districts=[district("A", -12.02, -77.02, 0.5), district("B", -12.01, -77.01, 0.8)],
            eps_origins=[{"id": "EPS_1", "prestador": "EPS Uno", "lat": -12.0, "lon": -77.0}],
        )

    def test_endpoint_returns_feasible_200_shape(self):
        payload = self.backend_app.BacktrackingRunRequest(
            originId="EPS_1",
            destinationIds=["A", "B"],
            criterion="prioridad",
            constraints={"maxVisits": 1},
        )
        response = self.backend_app.run_local_backtracking(payload)

        self.assertEqual(response["metadata"]["algorithm"], "backtracking")
        self.assertEqual(response["metadata"]["implementation"], "python")
        self.assertIn("sequence", response)
        self.assertIn("edges", response)
        self.assertIn("summary", response)

    def test_endpoint_returns_infeasible_200(self):
        payload = self.backend_app.BacktrackingRunRequest(
            originId="EPS_1",
            destinationIds=["A"],
            criterion="costo",
            constraints={"maxVisits": 1, "maxOperationalCost": 0.01},
        )
        response = self.backend_app.run_local_backtracking(payload)

        self.assertFalse(response["feasible"])

    def test_endpoint_validation_errors(self):
        with self.assertRaises(ValidationError):
            self.backend_app.BacktrackingRunRequest(originId="EPS_1", destinationIds=["A"], criterion="desconocido")
        with self.assertRaises(ValidationError):
            self.backend_app.BacktrackingRunRequest(originId="EPS_1", destinationIds=["A", "A"])
        with self.assertRaises(ValidationError):
            self.backend_app.BacktrackingRunRequest(originId="EPS_1", destinationIds=["A"], constraints={"maxVisits": -1})
        with self.assertRaises(ValidationError):
            self.backend_app.BacktrackingRunRequest(originId="EPS_1", destinationIds=["A"], maxExactNodes=11)

    def test_endpoint_rejects_unknown_origin(self):
        payload = self.backend_app.BacktrackingRunRequest(
            originId="EPS_X",
            destinationIds=["A"],
            criterion="distancia",
        )
        with self.assertRaises(HTTPException) as context:
            self.backend_app.run_local_backtracking(payload)
        self.assertEqual(context.exception.status_code, 422)
