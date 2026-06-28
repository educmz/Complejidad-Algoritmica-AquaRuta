import { Marker, Popup, Tooltip } from "react-leaflet";
import { getEpsMapIcon } from "./epsMapIcon";

function isValidOrigin(origin) {
  const lat = Number(origin?.lat);
  const lon = Number(origin?.lon);
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

export default function EpsMapMarker({ origin, children }) {
  if (!isValidOrigin(origin)) return null;

  return (
    <Marker
      key={origin.id}
      position={[Number(origin.lat), Number(origin.lon)]}
      icon={getEpsMapIcon(origin)}
      zIndexOffset={600}
    >
      <Tooltip direction="top" opacity={0.95}>
        {origin.prestador}
      </Tooltip>
      <Popup>
        <strong>{origin.prestador}</strong>
        <br />
        {origin.distrito}, {origin.provincia}
        <br />
        {origin.locationType === "referencial"
          ? "Ubicación referencial de la EPS"
          : "Ubicación de referencia EPS"}
        {children}
      </Popup>
    </Marker>
  );
}
