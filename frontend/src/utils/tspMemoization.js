function euclideanDistance(a, b) {
  if (!a || !b || a.length !== 2 || b.length !== 2) return Infinity;
  return Math.hypot(Number(a[0]) - Number(b[0]), Number(a[1]) - Number(b[1]));
}

function nodeCenter(node) {
  if (Array.isArray(node?.center) && node.center.length === 2) {
    return [Number(node.center[0]), Number(node.center[1])];
  }
  if (node?.lat != null && node?.lon != null) {
    return [Number(node.lat), Number(node.lon)];
  }
  return null;
}

function priorityPenalty(node, usePriorityBonus = true) {
  const interruptions = Number(node?.interrupciones || 0);
  const criticality = String(node?.criticidad || "baja").toLowerCase();
  let bonus = 0;

  if (usePriorityBonus) {
    if (criticality === "critica") bonus = 2;
    else if (criticality === "alta") bonus = 1.2;
    else if (criticality === "media") bonus = 0.5;
  }

  return -(interruptions / 10000 + bonus);
}

function criterionCost(distance, criterion) {
  if (criterion === "tiempo") return distance * 1.25;
  if (criterion === "costo") return distance * 1.4;
  return distance;
}

function buildCostMatrix(originCenter, nodes, criterion) {
  const points = [{ id: "__origin__", center: originCenter }, ...nodes];
  return points.map((from, row) =>
    points.map((to, column) => {
      if (row === column) return 0;
      const distance = euclideanDistance(from.center, to.center);
      return distance === Infinity ? Infinity : criterionCost(distance, criterion);
    })
  );
}

function fallbackOrder(originCenter, nodes, criterion) {
  const pending = [...nodes];
  const order = [];
  let current = { center: originCenter };

  while (pending.length) {
    pending.sort((a, b) => {
      const aScore = criterionCost(euclideanDistance(current.center, a.center), criterion) + priorityPenalty(a);
      const bScore = criterionCost(euclideanDistance(current.center, b.center), criterion) + priorityPenalty(b);
      return aScore - bScore;
    });
    const next = pending.shift();
    order.push(next);
    current = next;
  }

  return order;
}

export function solveTspMemoization({
  originCenter,
  destinations = [],
  criterion = "distancia",
  usePriorityBonus = true,
  maxExactNodes = 12,
}) {
  if (!originCenter || originCenter.length !== 2) {
    return {
      bestOrder: [],
      bestCost: 0,
      totalDistance: 0,
      criterion,
      exploredStates: 0,
      usedFallback: false,
      routePoints: [],
      error: "origin_center invalido",
    };
  }

  const cleanNodes = destinations
    .map((node) => {
      const center = nodeCenter(node);
      if (!center) return null;
      return {
        id: node.id,
        nombre: node.nombre || "Nodo",
        center,
        interrupciones: Number(node.interrupciones || 0),
        criticidad: node.criticidad || "baja",
      };
    })
    .filter(Boolean);

  if (!cleanNodes.length) {
    return {
      bestOrder: [],
      bestCost: 0,
      totalDistance: 0,
      criterion,
      exploredStates: 0,
      usedFallback: false,
      routePoints: [originCenter],
    };
  }

  const usedFallback = cleanNodes.length > maxExactNodes;
  const nodes = usedFallback
    ? fallbackOrder(originCenter, cleanNodes, criterion).slice(0, maxExactNodes)
    : cleanNodes;
  const n = nodes.length;
  const costMatrix = buildCostMatrix(originCenter, nodes, criterion);
  const penalties = [0, ...nodes.map((node) => priorityPenalty(node, usePriorityBonus))];
  const memo = new Map();
  let exploredStates = 0;

  function dp(mask, last) {
    const key = `${mask}:${last}`;
    if (memo.has(key)) return memo.get(key);
    exploredStates += 1;
    if (mask === (1 << n) - 1) return 0;

    let best = Infinity;
    for (let next = 1; next <= n; next += 1) {
      const bit = 1 << (next - 1);
      if (mask & bit) continue;
      const transition = costMatrix[last][next];
      if (transition === Infinity) continue;
      best = Math.min(best, transition + penalties[next] + dp(mask | bit, next));
    }
    memo.set(key, best);
    return best;
  }

  function reconstruct() {
    let mask = 0;
    let last = 0;
    const indices = [];

    while (mask !== (1 << n) - 1) {
      let bestNext = null;
      let bestValue = Infinity;
      for (let next = 1; next <= n; next += 1) {
        const bit = 1 << (next - 1);
        if (mask & bit) continue;
        const value = costMatrix[last][next] + penalties[next] + dp(mask | bit, next);
        if (value < bestValue) {
          bestValue = value;
          bestNext = next;
        }
      }
      if (!bestNext) break;
      indices.push(bestNext);
      mask |= 1 << (bestNext - 1);
      last = bestNext;
    }
    return indices;
  }

  const rawBestCost = dp(0, 0);
  const bestIndices = usedFallback ? nodes.map((_, index) => index + 1) : reconstruct();
  const bestOrder = bestIndices.map((index) => nodes[index - 1]);
  let totalDistance = 0;
  let current = 0;
  const routePoints = [originCenter];

  bestIndices.forEach((index) => {
    totalDistance += costMatrix[current][index];
    routePoints.push(nodes[index - 1].center);
    current = index;
  });

  return {
    bestOrder,
    bestCost: rawBestCost === Infinity ? 0 : Number(rawBestCost.toFixed(6)),
    totalDistance: Number(totalDistance.toFixed(6)),
    criterion,
    exploredStates,
    usedFallback,
    routePoints,
  };
}
