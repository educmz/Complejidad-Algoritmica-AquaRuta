export function euclideanDistance(a, b) {
  if (!a || !b) return 0;
  const dLat = (a[0] || 0) - (b[0] || 0);
  const dLon = (a[1] || 0) - (b[1] || 0);
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

export function buildLogicalAdjacency(districts = [], maxNeighbors = 3) {
  const adjacency = {};

  for (const district of districts) {
    adjacency[district.id] = [];
  }

  for (const district of districts) {
    const neighbors = districts
      .filter((other) => other.id !== district.id && other.center && district.center)
      .map((other) => ({
        id: other.id,
        distance: euclideanDistance(district.center, other.center),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, maxNeighbors);

    adjacency[district.id] = neighbors.map((item) => item.id);
  }

  return adjacency;
}

export function bfsTraversal(adjacency, startId) {
  if (!startId || !adjacency[startId]) return [];

  const visited = new Set([startId]);
  const queue = [startId];
  const order = [];

  while (queue.length > 0) {
    const current = queue.shift();
    order.push(current);

    for (const neighbor of adjacency[current] || []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  return order;
}

export function dfsTraversal(adjacency, startId) {
  if (!startId || !adjacency[startId]) return [];

  const visited = new Set();
  const stack = [startId];
  const order = [];

  while (stack.length > 0) {
    const current = stack.pop();

    if (visited.has(current)) continue;

    visited.add(current);
    order.push(current);

    const neighbors = [...(adjacency[current] || [])].reverse();
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        stack.push(neighbor);
      }
    }
  }

  return order;
}