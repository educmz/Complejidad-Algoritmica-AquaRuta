export function epsCoverageStatus(distance) {
  const value = Number(distance);
  if (!Number.isFinite(value)) {
    return {
      key: "sin_eps",
      label: "Sin EPS viable",
      description: "No se encontró una EPS de referencia con datos suficientes.",
    };
  }
  if (value <= 30) {
    return {
      key: "local",
      label: "EPS local",
      description: "La EPS de referencia se encuentra cerca del área analizada.",
    };
  }
  if (value <= 60) {
    return {
      key: "externa",
      label: "EPS externa",
      description: "La EPS puede usarse como referencia operativa, aunque está fuera del área.",
    };
  }
  if (value <= 120) {
    return {
      key: "lejana",
      label: "EPS lejana",
      description: "La EPS está lejos y requiere validación operativa.",
    };
  }
  return {
    key: "no_viable",
    label: "EPS no viable",
    description: "La EPS está demasiado lejos para considerarse un origen operativo directo.",
  };
}

export function epsRequiresValidation(status) {
  return status?.key === "lejana" || status?.key === "no_viable";
}
