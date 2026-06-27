from pathlib import Path
import importlib.util
import sys
import unittest

from fastapi import HTTPException
from pydantic import ValidationError

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "backend" / "src"
sys.path.insert(0, str(SRC))

from algorithms.bfs import bfs
from algorithms.dfs import dfs
from services.graph_traversal_service import GraphTraversalService, GraphTraversalServiceError


def load_backend_app():
    module_path = ROOT / "backend" / "app.py"
    spec = importlib.util.spec_from_file_location("aquaruta_backend_app_traversal", module_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def district(node_id, lat, lon):
    return {
        "id": node_id,
        "nombre": node_id,
        "center": [lat, lon],
        "interrupciones": 0,
        "criticidad": "baja",
        "prioridad_score": 0,
        "personas_afectadas_estimadas": 0,
    }


class TraversalAlgorithmTests(unittest.TestCase):
    def setUp(self):
        self.graph = {
            "A": ["B", "C"],
            "B": ["D"],
            "C": ["E"],
            "D": [],
            "E": [],
            "Z": [],
        }

    def test_bfs_uses_fifo_order_and_levels(self):
        result = bfs(self.graph, "A", with_metadata=True)

        self.assertEqual(result["order"], ["A", "B", "C", "D", "E"])
        self.assertEqual(result["levels"], {"A": 0, "B": 1, "C": 1, "D": 2, "E": 2})
        self.assertEqual(result["parents"]["D"], "B")
        self.assertEqual(result["tree_edges"][0], {"source": "A", "target": "B"})
        self.assertEqual(len(result["order"]), len(set(result["order"])))

    def test_bfs_handles_cycles_and_disconnected_components(self):
        graph = {"A": ["B"], "B": ["A", "C"], "C": ["A"], "Z": []}
        result = bfs(graph, "A", with_metadata=True)

        self.assertEqual(result["order"], ["A", "B", "C"])
        self.assertNotIn("Z", result["order"])

    def test_bfs_empty_or_missing_origin(self):
        self.assertEqual(bfs({}, "A", with_metadata=True)["order"], [])
        self.assertEqual(bfs(self.graph, "X", with_metadata=True)["order"], [])

    def test_dfs_uses_lifo_order_and_depths(self):
        result = dfs(self.graph, "A", with_metadata=True)

        self.assertEqual(result["order"], ["A", "B", "D", "C", "E"])
        self.assertEqual(result["depths"], {"A": 0, "B": 1, "D": 2, "C": 1, "E": 2})
        self.assertEqual(result["parents"]["E"], "C")
        self.assertEqual(result["tree_edges"][0], {"source": "A", "target": "B"})
        self.assertEqual(len(result["order"]), len(set(result["order"])))

    def test_dfs_handles_cycles_and_disconnected_components(self):
        graph = {"A": ["B"], "B": ["A", "C"], "C": ["A"], "Z": []}
        result = dfs(graph, "A", with_metadata=True)

        self.assertEqual(result["order"], ["A", "B", "C"])
        self.assertNotIn("Z", result["order"])

    def test_dfs_empty_or_missing_origin(self):
        self.assertEqual(dfs({}, "A", with_metadata=True)["order"], [])
        self.assertEqual(dfs(self.graph, "X", with_metadata=True)["order"], [])

    def test_bfs_and_dfs_visit_same_reachable_set_with_different_order(self):
        bfs_result = bfs(self.graph, "A", with_metadata=True)
        dfs_result = dfs(self.graph, "A", with_metadata=True)

        self.assertEqual(set(bfs_result["order"]), set(dfs_result["order"]))
        self.assertNotEqual(bfs_result["order"], dfs_result["order"])


class GraphTraversalServiceTests(unittest.TestCase):
    def setUp(self):
        self.service = GraphTraversalService(
            ROOT,
            districts=[
                district("A", 0, 0),
                district("B", 0, 0.01),
                district("C", 0, 10),
                district("D", 0, 10.01),
            ],
        )

    def test_service_runs_bfs_and_returns_unreachable_nodes(self):
        result = self.service.run("A", ["A", "B", "C", "D"], algorithm="bfs", max_neighbors=1)

        self.assertEqual(result["metadata"]["algorithm"], "bfs")
        self.assertEqual(result["metadata"]["implementation"], "python")
        self.assertEqual([item["nodeId"] for item in result["order"]], ["A", "B"])
        self.assertEqual([item["id"] for item in result["unreachableNodes"]], ["C", "D"])
        self.assertEqual(result["summary"]["visitedNodes"], 2)
        self.assertEqual(result["summary"]["treeEdges"], 1)

    def test_service_runs_dfs(self):
        result = self.service.run("A", ["A", "B", "C", "D"], algorithm="dfs", max_neighbors=2)

        self.assertEqual(result["metadata"]["algorithm"], "dfs")
        self.assertIn("depth", result["order"][0])
        self.assertEqual(result["origin"]["id"], "A")

    def test_service_rejects_invalid_input(self):
        with self.assertRaises(GraphTraversalServiceError):
            self.service.run("A", ["A", "A"], algorithm="bfs")
        with self.assertRaises(GraphTraversalServiceError):
            self.service.run("X", ["A", "B"], algorithm="bfs")
        with self.assertRaises(GraphTraversalServiceError):
            self.service.run("A", ["A", "B"], algorithm="astar")


class GraphTraversalEndpointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.backend_app = load_backend_app()
        cls.backend_app.graph_traversal_service = GraphTraversalService(
            ROOT,
            districts=[
                district("A", 0, 0),
                district("B", 0, 0.01),
                district("C", 0, 10),
            ],
        )

    def test_endpoint_returns_bfs_response(self):
        payload = self.backend_app.GraphTraversalRequest(
            originId="A",
            nodeIds=["A", "B", "C"],
            algorithm="bfs",
            maxNeighbors=1,
        )
        response = self.backend_app.run_local_traversal(payload)

        self.assertEqual(response["metadata"]["algorithm"], "bfs")
        self.assertEqual(response["metadata"]["implementation"], "python")
        self.assertEqual(response["metadata"]["graphType"], "logical")
        self.assertIn("order", response)
        self.assertIn("treeEdges", response)
        self.assertIn("summary", response)

    def test_endpoint_returns_dfs_response(self):
        payload = self.backend_app.GraphTraversalRequest(
            originId="A",
            nodeIds=["A", "B", "C"],
            algorithm="dfs",
        )
        response = self.backend_app.run_local_traversal(payload)

        self.assertEqual(response["metadata"]["algorithm"], "dfs")
        self.assertIn("depth", response["order"][0])

    def test_endpoint_reports_partial_reachability(self):
        payload = self.backend_app.GraphTraversalRequest(
            originId="A",
            nodeIds=["A", "B", "C"],
            algorithm="bfs",
            maxNeighbors=1,
        )
        response = self.backend_app.run_local_traversal(payload)

        self.assertGreater(len(response["unreachableNodes"]), 0)

    def test_endpoint_rejects_invalid_payloads(self):
        with self.assertRaises(ValidationError):
            self.backend_app.GraphTraversalRequest(originId="A", nodeIds=["A"], algorithm="astar")
        with self.assertRaises(ValidationError):
            self.backend_app.GraphTraversalRequest(originId="A", nodeIds=[])
        with self.assertRaises(ValidationError):
            self.backend_app.GraphTraversalRequest(originId="A", nodeIds=["A"] * 121)

    def test_endpoint_rejects_unknown_origin(self):
        payload = self.backend_app.GraphTraversalRequest(
            originId="X",
            nodeIds=["A", "B"],
            algorithm="bfs",
        )

        with self.assertRaises(HTTPException) as context:
            self.backend_app.run_local_traversal(payload)
        self.assertEqual(context.exception.status_code, 422)
