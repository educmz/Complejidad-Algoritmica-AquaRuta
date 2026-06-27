from pathlib import Path
import importlib.util
import sys
import unittest

from pydantic import ValidationError

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "backend" / "src"
sys.path.insert(0, str(SRC))

from services.tsp_service import TspService


def load_backend_app():
    module_path = ROOT / "backend" / "app.py"
    spec = importlib.util.spec_from_file_location("aquaruta_backend_app_tsp", module_path)
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
        "prioridad_score": 0.2,
        "personas_afectadas_estimadas": 10,
        "peso_demanda_familiar": 0.1,
    }


class TspEndpointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.backend_app = load_backend_app()
        cls.backend_app.tsp_service = TspService(
            ROOT,
            districts=[district("A", 0, 2), district("B", 0, 1), district("C", 0, 3), district("D", 0, 4)],
            eps_origins=[{"id": "eps-1", "prestador": "EPS 1", "lat": 0, "lon": 0}],
        )

    def test_endpoint_returns_200_like_exact_response(self):
        payload = self.backend_app.TspRunRequest(
            originId="eps-1",
            destinationIds=["A", "B"],
            criterion="distancia",
            maxExactNodes=12,
        )

        response = self.backend_app.run_local_tsp(payload)

        self.assertEqual(response["metadata"]["algorithm"], "tsp_memoization")
        self.assertEqual(response["metadata"]["implementation"], "python")
        self.assertEqual(response["summary"]["visitedNodes"], 2)
        self.assertFalse(response["summary"]["usedFallback"])
        self.assertIn("sequence", response)
        self.assertIn("edges", response)
        self.assertIn("summary", response)
        self.assertIn("metadata", response)

    def test_endpoint_returns_200_like_fallback_response(self):
        payload = self.backend_app.TspRunRequest(
            originId="eps-1",
            destinationIds=["A", "B", "C", "D"],
            criterion="distancia",
            maxExactNodes=2,
        )

        response = self.backend_app.run_local_tsp(payload)

        self.assertTrue(response["summary"]["usedFallback"])
        self.assertEqual(response["summary"]["visitedNodes"], 4)

    def test_endpoint_rejects_invalid_schema_values(self):
        with self.assertRaises(ValidationError):
            self.backend_app.TspRunRequest(
                originId="eps-1",
                destinationIds=["A"],
                criterion="desconocido",
            )
        with self.assertRaises(ValidationError):
            self.backend_app.TspRunRequest(
                originId="eps-1",
                destinationIds=["A", "A"],
            )
        with self.assertRaises(ValidationError):
            self.backend_app.TspRunRequest(
                originId="eps-1",
                destinationIds=["A"],
                maxExactNodes=99,
            )

    def test_endpoint_reports_functional_errors(self):
        payload = self.backend_app.TspRunRequest(
            originId="missing",
            destinationIds=["A"],
            criterion="distancia",
        )

        with self.assertRaises(Exception) as context:
            self.backend_app.run_local_tsp(payload)

        self.assertEqual(getattr(context.exception, "status_code", None), 400)

    def test_endpoint_handles_sector_without_nodes(self):
        payload = self.backend_app.TspRunRequest(
            originId="eps-1",
            destinationIds=[],
            criterion="distancia",
        )

        response = self.backend_app.run_local_tsp(payload)

        self.assertEqual(response["sequence"], [])
        self.assertEqual(response["summary"]["visitedNodes"], 0)


if __name__ == "__main__":
    unittest.main()
