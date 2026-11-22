export function localTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

export function errorMessage(error, fallback = "Something went wrong.") {
  return error?.message || fallback;
}

