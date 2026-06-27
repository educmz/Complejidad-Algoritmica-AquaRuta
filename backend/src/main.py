from pathlib import Path
import sys
import json
import logging

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "backend" / "src"
sys.path.insert(0, str(SRC))

from loaders.interruptions_loader import InterruptionsLoader
from loaders.district_centers_loader import DistrictCentersLoader
from loaders.eps_loader import EpsLoader
from loaders.demographics_loader import DemographicsLoader
from builders.dataset_builder import (
    build_dataset_metadata,
    build_districts_summary,
    enrich_districts_with_centers,
    strip_internal_fields,
    save_json,
    build_eps_origins,
)
from builders.grouping_builder import build_grouped_zones, save_grouped_zones
from builders.sectorization_builder import build_sectorized_zones, save_sectorized_zones
from builders.operational_builder import build_operational_routes
from builders.local_graph_builder import build_local_graphs
from builders.route_exploration_builder import build_route_explorations, save_route_explorations

RAW_INTERRUPTION_CSV_PATH = ROOT / "data/raw/Interrupciones_Dataset.csv"
RAW_CENTERS_CSV_PATH = ROOT / "data/raw/ubigeo_distrito.csv"
RAW_EPS_CSV_PATH = ROOT / "data/raw/eps_dataset.csv"
RAW_HOUSEHOLDS_CSV_PATH = ROOT / "data/raw/hogares_distrito_inei_2017.csv"
RAW_POPULATION_CSV_PATH = ROOT / "data/raw/poblacion_distrito_inei_2017.csv"

PROCESSED_SUMMARY_PATH = ROOT / "data/processed/districts_summary.json"
PROCESSED_GROUPS_PATH = ROOT / "data/processed/grouped_zones.json"
PROCESSED_SECTORS_PATH = ROOT / "data/processed/sectorized_zones.json"
PROCESSED_EPS_ORIGINS_PATH = ROOT / "data/processed/eps_origins.json"
PROCESSED_OPERATIONAL_ROUTES_PATH = ROOT / "data/processed/operational_routes.json"
PROCESSED_LOCAL_GRAPHS_PATH = ROOT / "data/processed/local_graphs.json"
PROCESSED_ROUTE_EXPLORATIONS_PATH = ROOT / "data/processed/route_explorations.json"
PROCESSED_DEMOGRAPHIC_MATCH_REPORT_PATH = ROOT / "data/processed/demographic_match_report.json"
PROCESSED_DEMOGRAPHIC_VALIDATION_REPORT_PATH = ROOT / "data/processed/demographic_validation_report.json"

EXPORT_JS_PATH = ROOT / "frontend/src/data/aquaRutaData.js"

logger = logging.getLogger(__name__)


def export_to_frontend(
    districts_summary,
    grouped_zones,
    sectorized_zones,
    eps_origins,
    operational_routes,
    local_graphs,
    route_explorations,
    metadata,
    output_path,
):
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
        "export const aquaRutaData = " + json.dumps(export_data, ensure_ascii=False, indent=2) + ";\n",
        encoding="utf-8",
    )


def main():
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    logger.info("Cargando dataset de interrupciones...")
    interruptions_df = InterruptionsLoader(str(RAW_INTERRUPTION_CSV_PATH)).load()
    logger.info("Registros cargados: %s", len(interruptions_df))

    logger.info("Cargando centros distritales...")
    centers_df = DistrictCentersLoader(str(RAW_CENTERS_CSV_PATH)).load()
    logger.info("Centros cargados: %s", len(centers_df))

    logger.info("Cargando fuentes demograficas...")
    demographics = DemographicsLoader(
        str(RAW_HOUSEHOLDS_CSV_PATH),
        str(RAW_POPULATION_CSV_PATH),
        centers_df,
    ).load()

    logger.info("Cargando dataset de EPS...")
    eps_df = EpsLoader(str(RAW_EPS_CSV_PATH)).load()
    logger.info("EPS cargadas: %s", len(eps_df))

    logger.info("Construyendo resumen por distrito...")
    districts_summary, match_report, validation_report = build_districts_summary(
        interruptions_df,
        demographics=demographics,
    )
    logger.info("Distritos resumidos: %s", len(districts_summary))

    dataset_metadata = build_dataset_metadata(interruptions_df)

    logger.info("Asignando centers...")
    districts_summary = enrich_districts_with_centers(districts_summary, centers_df)

    logger.info("Limpiando campos internos...")
    districts_summary_clean = strip_internal_fields(districts_summary)

    logger.info("Guardando resumen distrital y reportes demograficos...")
    save_json(districts_summary_clean, str(PROCESSED_SUMMARY_PATH))
    validation_report["distritos_sin_ubigeo"] = sum(1 for item in districts_summary_clean if not item.get("ubigeo"))
    save_json(match_report, str(PROCESSED_DEMOGRAPHIC_MATCH_REPORT_PATH))
    save_json(validation_report, str(PROCESSED_DEMOGRAPHIC_VALIDATION_REPORT_PATH))

    logger.info("Construyendo agrupaciones UFDS...")
    grouped_zones = build_grouped_zones(districts_summary_clean)
    save_grouped_zones(grouped_zones, str(PROCESSED_GROUPS_PATH))

    logger.info("Construyendo sectorizacion...")
    sectorized_zones = build_sectorized_zones(districts_summary_clean, grouped_zones)
    save_sectorized_zones(sectorized_zones, str(PROCESSED_SECTORS_PATH))

    logger.info("Construyendo nodos EPS...")
    eps_origins = build_eps_origins(eps_df, centers_df)
    save_json(eps_origins, str(PROCESSED_EPS_ORIGINS_PATH))

    logger.info("Construyendo exploracion de rutas con Dijkstra...")
    route_explorations = build_route_explorations(districts_summary_clean, sectorized_zones, eps_origins)
    save_route_explorations(route_explorations, str(PROCESSED_ROUTE_EXPLORATIONS_PATH))

    logger.info("Construyendo recorridos operativos...")
    operational_routes = build_operational_routes(districts_summary_clean, grouped_zones, eps_origins, top_groups=7)
    save_json(operational_routes, str(PROCESSED_OPERATIONAL_ROUTES_PATH))

    logger.info("Construyendo exploracion local...")
    local_graphs = build_local_graphs(districts_summary_clean, sectorized_zones, eps_origins)
    save_json(local_graphs, str(PROCESSED_LOCAL_GRAPHS_PATH))

    logger.info("Exportando al frontend...")
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

    logger.info("Proceso completado.")
    logger.info("Resumen: %s", PROCESSED_SUMMARY_PATH)
    logger.info("Reporte demografico: %s", PROCESSED_DEMOGRAPHIC_VALIDATION_REPORT_PATH)


if __name__ == "__main__":
    main()
