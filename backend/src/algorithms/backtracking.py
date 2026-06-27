from __future__ import annotations

from math import sqrt
from typing import Any


CRITERION_WEIGHT_FIELD = {
    "distancia": "distance_weight",
    "tiempo": "time_weight",
    "costo": "cost_weight",
    "prioridad": "cost_weight",
}


def euclidean_distance(a, b):
    if not a or not b:
        return 0.0
    return sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2)


def _empty_metrics():
    return {
        "distance_km": 0.0,
        "road_distance_km": 0.0,
        "duration_min": 0.0,
        "operational_cost": 0.0,
        "distance_weight": 0.0,
        "time_weight": 0.0,
        "cost_weight": 0.0,
    }


def _within_constraints(totals, constraints):
    max_distance = constraints.get("max_distance_km")
    max_duration = constraints.get("max_duration_min")
    max_cost = constraints.get("max_operational_cost")
    if max_distance is not None and totals["distance_km"] > max_distance:
        return False
    if max_duration is not None and totals["duration_min"] > max_duration:
        return False
    if max_cost is not None and totals["operational_cost"] > max_cost:
        return False
    return True


def _objective_name(criterion: str) -> str:
    if criterion == "prioridad":
        return "maximize_priority_under_constraints"
    return f"maximize_visits_then_minimize_{criterion}"


def solve_backtracking(
    origin: dict[str, Any],
    destinations: list[dict[str, Any]],
    metrics_matrix: list[list[dict[str, float]]],
    constraints: dict[str, Any] | None = None,
    criterion: str = "distancia",
    used_fallback: bool = False,
) -> dict[str, Any]:
    """Backtracking over candidate visit sequences.

    State: sequence, visited flags, accumulated distance/time/cost and priority.
    Decision: choose the next unvisited destination.
    Base case: no candidate can be added or maxVisits was reached.
    Pruning: reject branches exceeding constraints or unable to improve the best known solution.
    Backtracking: apply candidate, recurse, then undo and restore state snapshots.
    """
    constraints = dict(constraints or {})
    criterion = str(criterion or "distancia").strip().lower()
    if criterion not in CRITERION_WEIGHT_FIELD:
        raise ValueError("Criterio Backtracking no permitido.")
    if not origin or not destinations:
        return _empty_result(criterion, used_fallback)

    max_visits = min(int(constraints.get("max_visits") or len(destinations)), len(destinations))
    if max_visits <= 0:
        return _empty_result(criterion, used_fallback)

    weight_field = CRITERION_WEIGHT_FIELD[criterion]
    visited = [False] * len(destinations)
    current_order: list[int] = []
    current_totals = _empty_metrics()
    current_priority = 0.0
    best_order: list[int] = []
    best_totals = _empty_metrics()
    best_priority = 0.0
    best_score = None
    explored_states = 0
    pruned_branches = 0
    backtracks = 0
    sorted_priorities = sorted(
        [float(destination.get("prioridad_score", 0) or 0) for destination in destinations],
        reverse=True,
    )

    def score(order, totals, priority):
        visited_count = len(order)
        if criterion == "prioridad":
            return (visited_count, round(priority, 12), -round(totals["cost_weight"], 12))
        return (visited_count, -round(totals[weight_field], 12), round(priority, 12))

    def can_beat_best():
        if best_score is None:
            return True
        remaining_slots = max_visits - len(current_order)
        optimistic_count = len(current_order) + min(remaining_slots, visited.count(False))
        if optimistic_count < best_score[0]:
            return False
        if criterion == "prioridad" and optimistic_count == best_score[0]:
            optimistic_priority = current_priority + sum(sorted_priorities[:remaining_slots])
            if optimistic_priority <= best_score[1]:
                return False
        if criterion != "prioridad" and optimistic_count == best_score[0] == max_visits:
            if current_totals[weight_field] >= -best_score[1]:
                return False
        return True

    def update_best():
        nonlocal best_order, best_totals, best_priority, best_score
        if not current_order:
            return
        candidate_score = score(current_order, current_totals, current_priority)
        if best_score is None or candidate_score > best_score:
            best_score = candidate_score
            best_order = list(current_order)
            best_totals = dict(current_totals)
            best_priority = current_priority

    def backtrack(current_index):
        nonlocal explored_states, pruned_branches, backtracks, current_priority
        explored_states += 1
        update_best()
        if len(current_order) >= max_visits:
            return
        if not can_beat_best():
            pruned_branches += 1
            return

        for destination_index, destination in enumerate(destinations):
            if visited[destination_index]:
                continue
            transition = metrics_matrix[current_index][destination_index + 1]
            next_totals = {
                "distance_km": current_totals["distance_km"] + transition["distance_km"],
                "road_distance_km": current_totals["road_distance_km"] + transition["road_distance_km"],
                "duration_min": current_totals["duration_min"] + transition["duration_min"],
                "operational_cost": current_totals["operational_cost"] + transition["operational_cost"],
                "distance_weight": current_totals["distance_weight"] + transition["distance_weight"],
                "time_weight": current_totals["time_weight"] + transition["time_weight"],
                "cost_weight": current_totals["cost_weight"] + transition["cost_weight"],
            }
            if not _within_constraints(next_totals, constraints):
                pruned_branches += 1
                continue

            totals_snapshot = dict(current_totals)
            priority_snapshot = current_priority
            visited[destination_index] = True
            current_order.append(destination_index)
            current_totals.update(next_totals)
            current_priority += float(destination.get("prioridad_score", 0) or 0)

            backtrack(destination_index + 1)

            current_order.pop()
            visited[destination_index] = False
            current_totals.update(totals_snapshot)
            current_priority = priority_snapshot
            backtracks += 1

    backtrack(0)

    sequence = [destinations[index] for index in best_order]
    objective_value = best_priority if criterion == "prioridad" else best_totals[weight_field]
    return {
        "sequence": sequence,
        "sequence_indices": best_order,
        "objective_value": round(float(objective_value or 0), 6),
        "objective": _objective_name(criterion),
        "feasible": bool(sequence),
        "explored_states": explored_states,
        "pruned_branches": pruned_branches,
        "backtracks": backtracks,
        "used_fallback": used_fallback,
        "totals": {key: round(float(value or 0), 6) for key, value in best_totals.items()},
        "priority_total": round(float(best_priority or 0), 6),
        "final_state_restored": not any(visited) and not current_order and all(
            value == 0.0 for value in current_totals.values()
        ),
    }


def _empty_result(criterion: str, used_fallback: bool):
    return {
        "sequence": [],
        "sequence_indices": [],
        "objective_value": 0.0,
        "objective": _objective_name(criterion),
        "feasible": False,
        "explored_states": 0,
        "pruned_branches": 0,
        "backtracks": 0,
        "used_fallback": used_fallback,
        "totals": _empty_metrics(),
        "priority_total": 0.0,
        "final_state_restored": True,
    }


def solve_backtracking_route(origin_center, destinations):
    if not origin_center or not destinations:
        return {"best_order": [], "best_cost": 0.0, "explored_solutions": 0}

    nodes = [{"id": "origin", "center": origin_center}] + destinations
    matrix = []
    for source in nodes:
        row = []
        for target in nodes:
            distance = euclidean_distance(source.get("center"), target.get("center"))
            row.append(
                {
                    "distance_km": distance,
                    "road_distance_km": distance,
                    "duration_min": distance,
                    "operational_cost": distance,
                    "distance_weight": distance,
                    "time_weight": distance,
                    "cost_weight": distance,
                }
            )
        matrix.append(row)

    result = solve_backtracking(
        {"id": "origin", "center": origin_center},
        destinations,
        matrix,
        constraints={"max_visits": len(destinations)},
        criterion="distancia",
    )
    return {
        "best_order": [
            {
                "id": item.get("id"),
                "nombre": item.get("nombre"),
                "center": item.get("center"),
                "interrupciones": item.get("interrupciones", 0),
                "personas_afectadas_estimadas": item.get("personas_afectadas_estimadas", 0),
                "prioridad_score": item.get("prioridad_score", 0),
            }
            for item in result["sequence"]
        ],
        "best_cost": result["objective_value"],
        "explored_solutions": result["explored_states"],
    }
