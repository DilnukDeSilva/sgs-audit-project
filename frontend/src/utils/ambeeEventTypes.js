/**
 * Ambee natural disaster event_type codes → display names
 * (per Ambee / product docs: TN, EQ, TC, …)
 */
const LABELS = {
  TN: 'Tsunamis',
  EQ: 'Earthquake',
  TC: 'Tropical Cyclones',
  WF: 'Wildfires',
  FL: 'Floods',
  ET: 'Extreme Temperature',
  DR: 'Droughts',
  SW: 'Severe storms',
  SI: 'Sea Ice',
  VO: 'Volcano',
  LS: 'Landslides',
  MISC: 'Miscellaneous',
}

/**
 * @param {string | null | undefined} code
 * @returns {string} Human-readable type, or original code if unknown, or "—"
 */
export function ambeeEventTypeLabel(code) {
  if (code == null || String(code).trim() === '') return '—'
  const raw = String(code).trim()
  const key = raw.toUpperCase()
  return LABELS[key] ?? raw
}
