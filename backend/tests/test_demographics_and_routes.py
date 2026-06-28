from pathlib import Path
from types import SimpleNamespace
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "backend" / "src"
sys.path.insert(0, str(SRC))

from builders.dataset_builder import _apply_demographics
from builders.dataset_builder import consolidate_district_records
from builders.dataset_builder import enrich_districts_with_centers
from loaders.district_centers_loader import DistrictCentersLoader
from services.ors_service import ORSService, RouteConfig
from utils.text_utils import normalize_ubigeo
import pandas as pd


class DemandFamilyWeightTests(unittest.TestCase):
    def test_normalize_ubigeo_keeps_text_shape(self):
        self.assertEqual(normalize_ubigeo("10101"), "010101")
        self.assertEqual(normalize_ubigeo(" 150101 "), "150101")
        self.assertEqual(normalize_ubigeo("150101.0"), "150101")
        self.assertEqual(normalize_ubigeo(None), "")
        self.assertEqual(normalize_ubigeo("abc"), "")

    def test_district_centers_loader_normalizes_ubigeo_and_coordinates(self):
        source = pd.DataFrame(
            {
                "inei": ["010101.0", " 150101 ", "999999"],
                "departamento": ["AMAZONAS", "LIMA", "LIMA"],
                "provincia": ["CHACHAPOYAS", "LIMA", "LIMA"],
                "distrito": ["CHACHAPOYAS", "LIMA", "INVALIDO"],
                "latitude": ["-6.1", "-12.0", "not-a-number"],
                "longitude": ["-77.1", "-77.0", "-77.0"],
            }
        )

        with (
            patch.object(Path, "exists", return_value=True),
            patch("loaders.district_centers_loader.pd.read_csv", return_value=source),
        ):
            df = DistrictCentersLoader("ubigeo_loader.csv").load()

            self.assertEqual(df["ubigeo"].tolist(), ["010101", "150101"])
            self.assertEqual(float(df.iloc[0]["latitude"]), -6.1)

    def test_enrich_districts_with_centers_uses_territorial_fallback_when_no_ubigeo(self):
        districts = [
            {
                "departamento_norm": "lima",
                "provincia_norm": "canete",
                "distrito_norm": "san vicente de canete",
            }
        ]
        centers = pd.DataFrame(
            [
                {
                    "departamento_norm": "lima",
                    "provincia_norm": "canete",
                    "distrito_norm": "san vicente de canete",
                    "latitude": "-13.077778",
                    "longitude": "-76.387778",
                    "ubigeo": "150501",
                }
            ]
        )

        result = enrich_districts_with_centers(districts, centers)

        self.assertEqual(result[0]["ubigeo"], "150501")
        self.assertEqual(result[0]["center"], [-13.077778, -76.387778])

    def test_enrich_districts_with_centers_does_not_invent_coordinates(self):
        districts = [
            {
                "departamento_norm": "lima",
                "provincia_norm": "canete",
                "distrito_norm": "no existe",
            }
        ]
        centers = pd.DataFrame(
            [
                {
                    "departamento_norm": "lima",
                    "provincia_norm": "canete",
                    "distrito_norm": "san vicente de canete",
                    "latitude": "-13.077778",
                    "longitude": "-76.387778",
                    "ubigeo": "150501",
                }
            ]
        )

        result = enrich_districts_with_centers(districts, centers)

        self.assertNotIn("center", result[0])

    def test_consolidate_district_records_uses_ubigeo_as_canonical_node(self):
        records = [
            {
                "id": "lima-barranca-ate",
                "nombre": "Ate",
                "departamento": "Lima",
                "provincia": "Barranca",
                "ubigeo": "150103",
                "center": None,
                "interrupciones": 1,
                "conexiones_afectadas": 158,
                "conexiones_afectadas_evento_max": 158,
                "unidades_afectadas": 24,
                "camiones_puntos": 0,
                "personas_afectadas_estimadas": 545,
                "duracion_promedio_horas": 8,
                "duracion_maxima_horas": 8,
            },
            {
                "id": "lima-lima-ate",
                "nombre": "Ate",
                "departamento": "Lima",
                "provincia": "Lima",
                "ubigeo": "150103",
                "center": [-12.026389, -76.921389],
                "interrupciones": 1264,
                "conexiones_afectadas": 5078747,
                "conexiones_afectadas_evento_max": 3101147,
                "unidades_afectadas": 2262006,
                "camiones_puntos": 17,
                "personas_afectadas_estimadas": 10698957,
                "duracion_promedio_horas": 8.2,
                "duracion_maxima_horas": 724,
            },
        ]

        consolidated, report = consolidate_district_records(records)

        self.assertEqual(report["nodos_antes"], 2)
        self.assertEqual(report["nodos_despues"], 1)
        self.assertEqual(report["duplicados_detectados"], 1)
        self.assertEqual(consolidated[0]["id"], "lima-lima-ate")
        self.assertEqual(consolidated[0]["interrupciones"], 1265)
        self.assertEqual(consolidated[0]["conexiones_afectadas"], 5078905)
        self.assertEqual(consolidated[0]["center"], [-12.026389, -76.921389])

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
