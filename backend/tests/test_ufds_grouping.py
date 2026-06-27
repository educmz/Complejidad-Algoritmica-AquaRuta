from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "backend" / "src"
sys.path.insert(0, str(SRC))

from algorithms.ufds import UFDS, _evaluate_connection, agrupar_zonas_operativas
from services.grouping_service import GroupingConfigError, GroupingService


def zone(zone_id, lat, lon, **overrides):
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


class UFDSTests(unittest.TestCase):
    def test_initialization_starts_each_node_as_own_component(self):
        ufds = UFDS(4)

        self.assertEqual(ufds.parent, [0, 1, 2, 3])
        self.assertEqual({ufds.find(index) for index in range(4)}, {0, 1, 2, 3})

    def test_union_connects_two_nodes(self):
        ufds = UFDS(3)

        self.assertTrue(ufds.union(0, 1))

        self.assertEqual(ufds.find(0), ufds.find(1))
        self.assertNotEqual(ufds.find(0), ufds.find(2))

    def test_duplicate_union_does_not_reduce_components_again(self):
        ufds = UFDS(3)
        ufds.union(0, 1)
        before = {ufds.find(index) for index in range(3)}

        self.assertFalse(ufds.union(0, 1))
        after = {ufds.find(index) for index in range(3)}

        self.assertEqual(len(before), len(after))

    def test_union_by_rank_attaches_smaller_tree_to_representative(self):
        ufds = UFDS(4)
        ufds.union(0, 1)
        ufds.union(2, 3)
        representative = ufds.find(0)

        self.assertTrue(ufds.union(0, 2))

        self.assertEqual(ufds.find(2), representative)
        self.assertEqual(ufds.find(3), representative)
        self.assertGreaterEqual(ufds.rank[representative], 2)

    def test_path_compression_points_nodes_to_representative_after_find(self):
        ufds = UFDS(4)
        ufds.parent = [0, 0, 1, 2]

        representative = ufds.find(3)

        self.assertEqual(representative, 0)
        self.assertEqual(ufds.parent[3], 0)
        self.assertEqual(ufds.parent[2], 0)

    def test_components_after_two_independent_unions(self):
        ufds = UFDS(4)
        ufds.union(0, 1)
        ufds.union(2, 3)

        components = {}
        for index in range(4):
            components.setdefault(ufds.find(index), []).append(index)

        self.assertEqual(sorted(sorted(items) for items in components.values()), [[0, 1], [2, 3]])


class OperationalCriteriaTests(unittest.TestCase):
    def test_close_and_connected_districts_are_grouped_apart_from_far_district(self):
        districts = [
            zone("A", -12.0, -77.0),
            zone("B", -12.01, -77.01),
            zone("C", -13.0, -78.0),
        ]

        groups = agrupar_zonas_operativas(
            districts,
            criterio="combinado",
            max_geographic_distance_km=5,
            max_road_distance_km=8,
            max_time_min=40,
            max_cost=100,
            average_speed_kmh=28,
            road_factor=1.35,
            max_candidate_neighbors=4,
        )

        grouped_sets = [set(group["zona_ids"]) for group in groups]
        self.assertIn({"A", "B"}, grouped_sets)
        self.assertIn({"C"}, grouped_sets)

    def test_close_without_operational_connectivity_is_not_grouped(self):
        districts = [
            zone("A", -12.0, -77.0),
            zone("B", -12.01, -77.01),
        ]

        groups = agrupar_zonas_operativas(
            districts,
            criterio="geografico",
            max_geographic_distance_km=5,
            max_road_distance_km=0.5,
            max_time_min=1,
            max_cost=1,
            average_speed_kmh=10,
            road_factor=1.35,
            max_candidate_neighbors=4,
        )

        self.assertEqual(sorted(len(group["zona_ids"]) for group in groups), [1, 1])

    def test_family_demand_changes_route_factor_and_derived_time_cost(self):
        low_a = zone("A", -12.0, -77.0, peso_demanda_familiar=0)
        low_b = zone("B", -12.01, -77.01, peso_demanda_familiar=0)
        high_b = zone("B", -12.01, -77.01, peso_demanda_familiar=1)
        config = {
            "criterio": "combinado",
            "umbral_distancia_geografica_km": 5,
            "umbral_distancia_vial_km": 8,
            "umbral_tiempo_min": 60,
            "umbral_costo": 100,
            "velocidad_promedio_kmh": 28,
            "factor_vial": 1.35,
        }

        low = _evaluate_connection(low_a, low_b, config)["metrics"]
        high = _evaluate_connection(low_a, high_b, config)["metrics"]

        self.assertGreater(high["factor_trafico"], low["factor_trafico"])
        self.assertGreater(high["tiempo_estimado_min"], low["tiempo_estimado_min"])
        self.assertGreater(high["costo_estimado"], low["costo_estimado"])


class GroupingServiceTests(unittest.TestCase):
    def test_service_filters_and_preserves_priority_and_demand_summary(self):
        service = GroupingService(
            ROOT,
            districts=[
                zone("A", -12.0, -77.0, departamento="Lima", prioridad_score=0.9, personas_afectadas_estimadas=300),
                zone("B", -12.01, -77.01, departamento="Lima", prioridad_score=0.7, personas_afectadas_estimadas=200),
                zone("C", -13.0, -78.0, departamento="Arequipa", prioridad_score=0.3, personas_afectadas_estimadas=50),
            ],
        )

        result = service.run(filters={"departamento": "Lima"}, config={"umbral_distancia_geografica_km": 5})

        self.assertEqual(result["summary"]["districtCount"], 2)
        self.assertEqual(result["summary"]["estimatedAffectedPeople"], 500)
        self.assertEqual(result["metadata"]["implementation"], "python")
        self.assertTrue(result["groups"])
        self.assertIn("prioridad_score", result["groups"][0])
        self.assertIn("personas_afectadas_estimadas", result["groups"][0])

    def test_service_returns_empty_grouping_for_empty_filter_result(self):
        service = GroupingService(ROOT, districts=[zone("A", -12.0, -77.0)])

        result = service.run(filters={"departamento": "Cusco"})

        self.assertEqual(result["groups"], [])
        self.assertEqual(result["summary"]["districtCount"], 0)
        self.assertEqual(result["summary"]["groupCount"], 0)

    def test_service_rejects_invalid_config(self):
        service = GroupingService(ROOT, districts=[zone("A", -12.0, -77.0)])

        with self.assertRaises(GroupingConfigError):
            service.run(config={"velocidad_promedio_kmh": 0})


if __name__ == "__main__":
    unittest.main()
