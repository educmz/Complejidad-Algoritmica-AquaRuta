from pathlib import Path
import importlib.util
import sys
import unittest

from pydantic import ValidationError

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "backend" / "src"
sys.path.insert(0, str(SRC))

from algorithms.dijkstra import dijkstra
from services.dijkstra_service import DijkstraService, DijkstraServiceError


def load_backend_app():
    module_path = ROOT / "backend" / "app.py"
    spec = importlib.util.spec_from_file_location("aquaruta_backend_app_dijkstra", module_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def district(node_id, lat, lon, **overrides):
    data = {
        "id": node_id,
        "nombre": node_id,
        "center": [lat, lon],
        "interrupciones": 0,
        "criticidad": "baja",
        "duracion_promedio_horas": 0,
        "peso_demanda_familiar": 0,
        "prioridad_score": 0,
        "personas_afectadas_estimadas": 10,
    }
    data.update(overrides)
    return data


class DijkstraAlgorithmTests(unittest.TestCase):
    def test_basic_shortest_path(self):
        graph = {
            "A": [{"to": "B", "weight": 1}, {"to": "C", "weight": 2}],
            "B": [{"to": "D", "weight": 1}],
            "C": [{"to": "D", "weight": 4}],
            "D": [],
        }

        result = dijkstra(graph, "A", "D")

        self.assertEqual(result["path"], ["A", "B", "D"])
        self.assertEqual(result["cost"], 2)

    def test_relaxation_updates_parent_when_better_path_appears(self):
        graph = {
            "A": [{"to": "B", "weight": 10}, {"to": "C", "weight": 1}],
            "B": [{"to": "D", "weight": 1}],
            "C": [{"to": "B", "weight": 1}],
            "D": [],
        }

        result = dijkstra(graph, "A", "D")

        self.assertEqual(result["path"], ["A", "C", "B", "D"])
        self.assertEqual(result["distances"]["B"], 2)
        self.assertEqual(result["parents"]["B"], "C")

    def test_unreachable_target(self):
        result = dijkstra({"A": [], "B": []}, "A", "B")

        self.assertFalse(result["reachable"])
        self.assertEqual(result["path"], [])

    def test_same_origin_and_target_returns_zero_path(self):
        result = dijkstra({"A": []}, "A", "A")

        self.assertTrue(result["reachable"])
        self.assertEqual(result["path"], ["A"])
        self.assertEqual(result["cost"], 0)

    def test_invalid_weights_are_rejected(self):
        invalid_values = [-1, float("inf"), float("nan")]
        for value in invalid_values:
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    dijkstra({"A": [{"to": "B", "weight": value}], "B": []}, "A", "B")

    def test_directed_graph_does_not_infer_reverse_edges(self):
        graph = {"A": [{"to": "B", "weight": 1}], "B": []}

        result = dijkstra(graph, "B", "A")

        self.assertFalse(result["reachable"])

    def test_criterion_weight_fields_can_select_different_paths(self):
        graph = {
            "A": [
                {"to": "B", "distance_weight": 5, "time_weight": 20, "cost_weight": 35},
                {"to": "C", "distance_weight": 7, "time_weight": 10, "cost_weight": 20},
                {"to": "E", "distance_weight": 8, "time_weight": 18, "cost_weight": 5},
            ],
            "B": [{"to": "D", "distance_weight": 5, "time_weight": 20, "cost_weight": 35}],
            "C": [{"to": "D", "distance_weight": 7, "time_weight": 10, "cost_weight": 20}],
            "E": [{"to": "D", "distance_weight": 8, "time_weight": 18, "cost_weight": 5}],
            "D": [],
        }

        by_distance = dijkstra(graph, "A", "D", weight_field="distance_weight")
        by_time = dijkstra(graph, "A", "D", weight_field="time_weight")
        by_cost = dijkstra(graph, "A", "D", weight_field="cost_weight")

        self.assertEqual(by_distance["path"], ["A", "B", "D"])
        self.assertEqual(by_distance["cost"], 10)
        self.assertEqual(by_time["path"], ["A", "C", "D"])
        self.assertEqual(by_time["cost"], 20)
        self.assertEqual(by_cost["path"], ["A", "E", "D"])
        self.assertEqual(by_cost["cost"], 10)


class DijkstraServiceTests(unittest.TestCase):
    def service(self):
        return DijkstraService(
            ROOT,
            districts=[
                district("A", 0, 0.01, criticidad="baja"),
                district("B", 0, 0.02, criticidad="critica", interrupciones=12000, peso_demanda_familiar=1),
                district("C", 0.01, 0.01, criticidad="media"),
            ],
            eps_origins=[{"id": "eps-1", "prestador": "EPS 1", "lat": 0, "lon": 0}],
        )

    def test_service_builds_metrics_and_selects_weight_field(self):
        result = self.service().run(
            "eps-1",
            "B",
            ["A", "B", "C"],
            criterion="tiempo",
            max_neighbors=2,
        )

        self.assertEqual(result["metadata"]["algorithm"], "dijkstra")
        self.assertEqual(result["metadata"]["implementation"], "python")
        self.assertEqual(result["metadata"]["weightField"], "time_weight")
        self.assertTrue(result["edges"])
        self.assertIn("durationMin", result["edges"][0])
        self.assertGreater(result["summary"]["totalDurationMin"], 0)
        self.assertGreater(result["summary"]["relaxedEdges"], 0)

    def test_service_reports_unreachable(self):
        result = self.service().run(
            "eps-1",
            "B",
            ["A", "B", "C"],
            criterion="distancia",
            max_neighbors=1,
        )

        self.assertIn(result["status"], {"success", "unreachable"})

    def test_service_rejects_invalid_inputs(self):
        service = self.service()
        with self.assertRaises(DijkstraServiceError):
            service.run("missing", "A", ["A"])
        with self.assertRaises(DijkstraServiceError):
            service.run("eps-1", "A", ["A", "A"])
        with self.assertRaises(DijkstraServiceError):
            service.run("eps-1", "A", ["A"], criterion="prioridad")
        with self.assertRaises(DijkstraServiceError):
            service.run("eps-1", "A", [{}, "A"])


class DijkstraEndpointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.backend_app = load_backend_app()
        cls.backend_app.dijkstra_service = DijkstraService(
            ROOT,
            districts=[
                district("A", 0, 0.01),
                district("B", 0, 0.02, criticidad="alta", interrupciones=1000),
                district("C", 0.01, 0.01),
            ],
            eps_origins=[{"id": "eps-1", "prestador": "EPS 1", "lat": 0, "lon": 0}],
        )

    def test_endpoint_returns_distance_time_and_cost_responses(self):
        rows = []
        for criterion in ("distancia", "tiempo", "costo"):
            payload = self.backend_app.DijkstraRunRequest(
                originId="eps-1",
                targetId="B",
                nodeIds=["A", "B", "C"],
                criterion=criterion,
            )
            response = self.backend_app.run_local_dijkstra(payload)
            rows.append((criterion, [item["nodeId"] for item in response["path"]], response["summary"]["totalWeight"]))
            self.assertEqual(response["metadata"]["algorithm"], "dijkstra")
            self.assertEqual(response["metadata"]["implementation"], "python")
        self.assertEqual(len(rows), 3)

    def test_endpoint_rejects_invalid_schema(self):
        with self.assertRaises(ValidationError):
            self.backend_app.DijkstraRunRequest(
                originId="eps-1",
                targetId="A",
                nodeIds=["A"],
                criterion="desconocido",
            )
        with self.assertRaises(ValidationError):
            self.backend_app.DijkstraRunRequest(
                originId="eps-1",
                targetId="A",
                nodeIds=["A", "A"],
            )

    def test_endpoint_returns_400_for_missing_origin(self):
        payload = self.backend_app.DijkstraRunRequest(
            originId="missing",
            targetId="A",
            nodeIds=["A"],
            criterion="distancia",
        )
        with self.assertRaises(Exception) as context:
            self.backend_app.run_local_dijkstra(payload)
        self.assertEqual(getattr(context.exception, "status_code", None), 400)


if __name__ == "__main__":
    unittest.main()
