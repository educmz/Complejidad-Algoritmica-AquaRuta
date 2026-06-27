from pathlib import Path
import importlib.util
import sys
import unittest

from pydantic import ValidationError

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "backend" / "src"
sys.path.insert(0, str(SRC))

from services.grouping_service import GroupingService


def load_backend_app():
    module_path = ROOT / "backend" / "app.py"
    spec = importlib.util.spec_from_file_location("aquaruta_backend_app", module_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def zone(zone_id, lat=-12.0, lon=-77.0, **overrides):
    data = {
        "id": zone_id,
        "nombre": zone_id,
        "departamento": "Lima",
        "provincia": "Lima",
        "distrito": zone_id,
        "center": [lat, lon],
        "criticidad": "media",
        "interrupciones": 10,
        "duracion_promedio_horas": 1,
        "personas_afectadas_estimadas": 100,
        "peso_demanda_familiar": 0.2,
        "prioridad_score": 0.5,
        "conexiones_afectadas_evento_max": 20,
        "promedio_integrantes_hogar": 4,
        "eps_principal": "Sedapal",
    }
    data.update(overrides)
    return data


class GroupingEndpointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.backend_app = load_backend_app()
        cls.backend_app.grouping_service = GroupingService(
            ROOT,
            districts=[
                zone("A", -12.0, -77.0, departamento="Lima"),
                zone("B", -12.01, -77.01, departamento="Lima"),
                zone("C", -13.0, -78.0, departamento="Arequipa"),
            ],
        )

    def test_grouping_endpoint_returns_valid_200_response(self):
        payload = self.backend_app.GroupingRunRequest(
            **{
                "filters": {"departamento": "Lima"},
                "config": {
                    "criterio": "combinado",
                    "umbral_distancia_geografica_km": 5,
                    "umbral_distancia_vial_km": 8,
                    "umbral_tiempo_min": 40,
                    "umbral_costo": 100,
                    "velocidad_promedio_kmh": 28,
                    "factor_vial": 1.35,
                    "max_vecinos_candidatos": 4,
                },
            },
        )
        response = self.backend_app.run_grouping(payload)

        self.assertEqual(response["metadata"]["algorithm"], "ufds")
        self.assertEqual(response["metadata"]["implementation"], "python")
        self.assertEqual(response["summary"]["districtCount"], 2)
        self.assertEqual(response["summary"]["groupCount"], len(response["groups"]))
        self.assertNotIn("parent", response)
        self.assertNotIn("rank", response)

    def test_grouping_endpoint_rejects_invalid_config(self):
        with self.assertRaises(ValidationError):
            self.backend_app.GroupingRunRequest(
                **{"filters": {}, "config": {"velocidad_promedio_kmh": 0}}
            )

    def test_grouping_endpoint_rejects_unknown_criterion(self):
        with self.assertRaises(ValidationError):
            self.backend_app.GroupingRunRequest(
                **{"filters": {}, "config": {"criterio": "desconocido"}}
            )

    def test_grouping_endpoint_returns_empty_for_filter_without_results(self):
        payload = self.backend_app.GroupingRunRequest(
            **{"filters": {"departamento": "Cusco"}, "config": {}}
        )
        response = self.backend_app.run_grouping(payload)

        self.assertEqual(response["groups"], [])
        self.assertEqual(response["summary"]["districtCount"], 0)

    def test_grouping_endpoint_rejects_absent_required_body(self):
        with self.assertRaises(ValidationError):
            self.backend_app.GroupingRunRequest(**{})

    def test_grouping_endpoint_rejects_extra_fields(self):
        with self.assertRaises(ValidationError):
            self.backend_app.GroupingRunRequest(
                **{"filters": {}, "config": {}, "parent": [0, 1]}
            )


if __name__ == "__main__":
    unittest.main()
