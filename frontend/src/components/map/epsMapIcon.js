import L from "leaflet";

const epsIcon = L.divIcon({
  className: "dashboard-eps-marker",
  html: '<span class="dashboard-eps-water-icon" aria-hidden="true"></span>',
  iconSize: [32, 32],
  iconAnchor: [16, 29],
});

const epsReferenceIcon = L.divIcon({
  className: "dashboard-eps-marker dashboard-eps-marker-reference",
  html: '<span class="dashboard-eps-water-icon" aria-hidden="true"></span>',
  iconSize: [32, 32],
  iconAnchor: [16, 29],
});

export function getEpsMapIcon(origin) {
  return origin?.locationType === "referencial" ? epsReferenceIcon : epsIcon;
}
