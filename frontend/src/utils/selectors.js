export function buildDistrictMap(districts = []) {
  return new Map(districts.map((district) => [district.id, district]));
}

export function getGroupDistricts(group, districtMap) {
  if (!group) return [];
  return (group.zona_ids || [])
    .map((id) => districtMap.get(id))
    .filter(Boolean);
}

export function findClosestOriginToGroup(group, epsOrigins = []) {
  if (!group?.center || !epsOrigins.length) return null;

  const [groupLat, groupLon] = group.center;

  let best = null;
  let bestDistance = Infinity;

  for (const origin of epsOrigins) {
    const dLat = (origin.lat || 0) - groupLat;
    const dLon = (origin.lon || 0) - groupLon;
    const distance = dLat * dLat + dLon * dLon;

    if (distance < bestDistance) {
      bestDistance = distance;
      best = origin;
    }
  }

  return best;
}