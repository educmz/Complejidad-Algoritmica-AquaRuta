from pathlib import Path
from types import SimpleNamespace
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "backend" / "src"
sys.path.insert(0, str(SRC))

from builders.dataset_builder import _apply_demographics
from services.ors_service import ORSService, RouteConfig


class DemandFamilyWeightTests(unittest.TestCase):
    def test_demographic_weight_uses_event_connections_and_household_average(self):
        records = [
            {
                "departamento_norm": "lima",
                "provincia_norm": "lima",
                "distrito_norm": "miraflores",
                "interrupciones": 10,
                "conexiones_afectadas_evento_max": 100,
                "duracion_maxima_horas": 5,
            },
            {
                "departamento_norm": "lima",
                "provincia_norm": "lima",
                "distrito_norm": "surco",
                "interrupciones": 5,
                "conexiones_afectadas_evento_max": 50,
                "duracion_maxima_horas": 2,
            },
        ]
        demographics = SimpleNamespace(
            load_report={
                "coincidencias_exactas": 0,
                "coincidencias_por_ubigeo": 0,
                "coincidencias_departamento_distrito": 0,
                "coincidencias_distrito_unico": 0,
                "coincidencias_alias": 0,
                "sin_coincidencia": 0,
            },
            by_full_name={
                ("LIMA", "LIMA", "MIRAFLORES"): {
                    "ubigeo": "150122",
                    "poblacion_censada": 1000,
                    "total_hogares": 250,
                },
                ("LIMA", "LIMA", "SURCO"): {
                    "ubigeo": "150140",
                    "poblacion_censada": 600,
                    "total_hogares": 200,
                },
            },
            by_ubigeo={},
            by_department_district_unique={},
            by_national_district_unique={},
        )

        result, _, validation = _apply_demographics(records, demographics)

        self.assertEqual(result[0]["promedio_integrantes_hogar"], 4.0)
        self.assertEqual(result[0]["personas_afectadas_estimadas"], 400)
        self.assertEqual(result[0]["peso_demanda_familiar"], 1.0)
        self.assertEqual(result[1]["personas_afectadas_estimadas"], 150)
        self.assertGreater(result[0]["prioridad_score"], result[1]["prioridad_score"])
        self.assertEqual(validation["distritos_con_fallback"], 0)


class RouteFragilityTests(unittest.TestCase):
    def test_route_metrics_include_fragility_and_operational_edge_weight(self):
        service = ORSService.__new__(ORSService)
        service.config = RouteConfig(
            api_key=None,
            base_url="https://example.invalid",
            timeout_seconds=1,
            max_retries=0,
            alternative_target_count=3,
            cache_ttl_hours=1,
            max_operational_distance_km=100,
            max_operational_duration_min=200,
            max_operational_cost=800,
            cache_path=ROOT / "data" / "cache" / "test_ors_routes.sqlite3",
            cooldown_seconds=0,
        )
        payload = {
            "features": [
                {
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": [[-77.0, -12.0], [-77.1, -12.1]]},
                    "properties": {"summary": {"distance": 10000, "duration": 1800}},
                },
                {
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": [[-77.0, -12.0], [-77.2, -12.2]]},
                    "properties": {"summary": {"distance": 14000, "duration": 2400}},
                },
            ]
        }

        normalized = service._normalize_geojson(payload, source="eps", target="district")

        metrics = normalized["metrics"]
        self.assertEqual(normalized["edge_type"], "road_route")
        self.assertEqual(metrics["cantidad_rutas_validas"], 2)
        self.assertGreaterEqual(metrics["penalizacion_fragilidad_ruta"], 0)
        self.assertLessEqual(metrics["penalizacion_fragilidad_ruta"], 1)
        self.assertGreaterEqual(metrics["peso_operativo_arista"], 0)
        self.assertLessEqual(metrics["peso_operativo_arista"], 1)


if __name__ == "__main__":
    unittest.main()
