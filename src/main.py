from pathlib import Path
import sys
import json
#Hola, soy un comentario
ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
sys.path.insert(0, str(SRC))

from loaders.interruptions_loader import InterruptionsLoader
from loaders.district_centers_loader import DistrictCentersLoader
from loaders.eps_loader import EpsLoader
from builders.dataset_builder import (
    build_dataset_metadata,
    build_districts_summary,
    enrich_districts_with_centers,
    strip_internal_fields,
    save_json,
    build_eps_origins,
)
from builders.grouping_builder import (
    build_grouped_zones,
    save_grouped_zones,
)
from builders.sectorization_builder import (
    build_sectorized_zones,
    save_sectorized_zones,
)
from builders.operational_builder import build_operational_routes
from builders.local_graph_builder import build_local_graphs
from builders.route_exploration_builder import (
    build_route_explorations,
    save_route_explorations,
)

RAW_INTERRUPTION_CSV_PATH = ROOT / "data/raw/Interrupciones_Dataset.csv"
RAW_CENTERS_CSV_PATH = ROOT / "data/raw/ubigeo_distrito.csv"
RAW_EPS_CSV_PATH = ROOT / "data/raw/eps_dataset.csv"

PROCESSED_SUMMARY_PATH = ROOT / "data/processed/districts_summary.json"
PROCESSED_GROUPS_PATH = ROOT / "data/processed/grouped_zones.json"
PROCESSED_SECTORS_PATH = ROOT / "data/processed/sectorized_zones.json"
PROCESSED_EPS_ORIGINS_PATH = ROOT / "data/processed/eps_origins.json"
PROCESSED_OPERATIONAL_ROUTES_PATH = ROOT / "data/processed/operational_routes.json"
PROCESSED_LOCAL_GRAPHS_PATH = ROOT / "data/processed/local_graphs.json"
PROCESSED_ROUTE_EXPLORATIONS_PATH = ROOT / "data/processed/route_explorations.json"

EXPORT_JS_PATH = ROOT / "frontend/src/data/aquaRutaData.js"


def export_to_frontend(
    districts_summary: list[dict],
    grouped_zones: list[dict],
    sectorized_zones: dict,
    eps_origins: list[dict],
    operational_routes: dict,
    local_graphs: dict,
    route_explorations: dict,
    metadata: dict,
    output_path: str,
) -> None:
    export_data = {
        "metadata": metadata,
        "districts": districts_summary,
        "groupedZones": grouped_zones,
        "sectorizedZones": sectorized_zones,
        "epsOrigins": eps_origins,
        "operationalRoutes": operational_routes,
        "localGraphs": local_graphs,
        "routeExplorations": route_explorations,
    }

    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "export const aquaRutaData = "
        + json.dumps(export_data, ensure_ascii=False, indent=2)
        + ";\n",
        encoding="utf-8",
    )


def main():
    print("Cargando dataset de interrupciones...")
    interruptions_loader = InterruptionsLoader(str(RAW_INTERRUPTION_CSV_PATH))
    interruptions_df = interruptions_loader.load()
    print(f"Registros cargados: {len(interruptions_df)}")

    print("Cargando centros distritales...")
    centers_loader = DistrictCentersLoader(str(RAW_CENTERS_CSV_PATH))
    centers_df = centers_loader.load()
    print(f"Centros cargados: {len(centers_df)}")

    print("Cargando dataset de EPS...")
    eps_loader = EpsLoader(str(RAW_EPS_CSV_PATH))
    eps_df = eps_loader.load()
    print(f"EPS cargadas: {len(eps_df)}")

    print("Construyendo resumen por distrito...")
    districts_summary = build_districts_summary(interruptions_df)
    print(f"Distritos resumidos: {len(districts_summary)}")

    dataset_metadata = build_dataset_metadata(interruptions_df)

    print("Asignando centers...")
    districts_summary = enrich_districts_with_centers(districts_summary, centers_df)

    print("Limpiando campos internos...")
    districts_summary_clean = strip_internal_fields(districts_summary)

    print("Guardando resumen distrital...")
    save_json(districts_summary_clean, str(PROCESSED_SUMMARY_PATH))

    print("Construyendo agrupaciones UFDS...")
    grouped_zones = build_grouped_zones(districts_summary_clean)
    print(f"Grupos generados: {len(grouped_zones)}")

    print("Guardando grupos...")
    save_grouped_zones(grouped_zones, str(PROCESSED_GROUPS_PATH))

    print("Construyendo sectorización por divide y vencerás dentro de grupos UFDS...")
    sectorized_zones = build_sectorized_zones(districts_summary_clean, grouped_zones)
    print(f"Sectorizaciones generadas para {len(sectorized_zones)} grupos principales")

    print("Guardando sectores...")
    save_sectorized_zones(sectorized_zones, str(PROCESSED_SECTORS_PATH))

    print("Construyendo nodos de origen EPS...")
    eps_origins = build_eps_origins(eps_df, centers_df)
    print(f"Orígenes EPS generados: {len(eps_origins)}")

    print("Guardando orígenes EPS...")
    save_json(eps_origins, str(PROCESSED_EPS_ORIGINS_PATH))

    print("Construyendo exploracion de rutas con Dijkstra...")
    route_explorations = build_route_explorations(
        districts_summary_clean,
        sectorized_zones,
        eps_origins,
    )
    print(f"Exploraciones de rutas generadas: {len(route_explorations)} grupos")

    print("Guardando exploraciones de rutas...")
    save_route_explorations(route_explorations, str(PROCESSED_ROUTE_EXPLORATIONS_PATH))

    print("Construyendo recorridos operativos con DFS, BFS y Backtracking...")
    operational_routes = build_operational_routes(
        districts_summary_clean,
        grouped_zones,
        eps_origins,
        top_groups=7,
    )
    print(f"Escenarios operativos generados: {len(operational_routes)}")

    print("Guardando recorridos operativos...")
    save_json(operational_routes, str(PROCESSED_OPERATIONAL_ROUTES_PATH))

    print("Construyendo exploracion local con TSP por memorizacion...")
    local_graphs = build_local_graphs(
        districts_summary_clean,
        sectorized_zones,
        eps_origins,
    )
    print(f"Exploraciones locales generadas: {len(local_graphs)} grupos")

    print("Guardando subgrafos locales...")
    save_json(local_graphs, str(PROCESSED_LOCAL_GRAPHS_PATH))

    print("Exportando al frontend...")
    export_to_frontend(
        districts_summary_clean,
        grouped_zones,
        sectorized_zones,
        eps_origins,
        operational_routes,
        local_graphs,
        route_explorations,
        dataset_metadata,
        str(EXPORT_JS_PATH),
    )

    print("Proceso completado.")
    print(f"Resumen: {PROCESSED_SUMMARY_PATH}")
    print(f"Grupos: {PROCESSED_GROUPS_PATH}")
    print(f"Sectores: {PROCESSED_SECTORS_PATH}")
    print(f"EPS Origins: {PROCESSED_EPS_ORIGINS_PATH}")
    print(f"Operational Routes: {PROCESSED_OPERATIONAL_ROUTES_PATH}")
    print(f"Local Graphs: {PROCESSED_LOCAL_GRAPHS_PATH}")
    print(f"Route Explorations: {PROCESSED_ROUTE_EXPLORATIONS_PATH}")
    print(f"Export: {EXPORT_JS_PATH}")


if __name__ == "__main__":
    main()
