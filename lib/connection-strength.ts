/**
 * Derives connection strength (1–5) from interaction frequency and recency.
 * Higher values mean a warmer / more active relationship in the recent window.
 */

const MS_PER_DAY = 86400 * 1000;

function parseDay(isoDate: string): number {
  return new Date(`${isoDate.trim().slice(0, 10)}T12:00:00`).getTime();
}

/** Days from `older` to `newer` (both YYYY-MM-DD). */
export function daysBetweenIso(older: string, newer: string): number {
  return Math.floor((parseDay(newer) - parseDay(older)) / MS_PER_DAY);
}

function countInteractionsInRollingWindow(interactionDates: string[], windowDays: number, todayIso: string): number {
  let n = 0;
  for (const d of interactionDates) {
    const delta = daysBetweenIso(d, todayIso);
    if (delta >= 0 && delta <= windowDays) n++;
  }
  return n;
}

/**
 * @param interactionDates — ISO date strings (YYYY-MM-DD) for this contact, any order
 * @param lastContactDate — fallback when interaction list is empty (legacy rows)
 * @param now — injectable for tests
 */
export function computeConnectionStrength(
  interactionDates: string[],
  lastContactDate: string,
  now: Date = new Date(),
): 1 | 2 | 3 | 4 | 5 {
  const todayIso = now.toISOString().slice(0, 10);
  const dates = interactionDates.map((d) => d.trim().slice(0, 10)).filter(Boolean);

  const sorted = [...dates].sort();
  const lastFromInteractions = sorted.length > 0 ? sorted[sorted.length - 1]! : null;
  const lastTouch = lastFromInteractions ?? lastContactDate.trim().slice(0, 10);
  if (!lastTouch) return 2;

  const daysSinceLast = daysBetweenIso(lastTouch, todayIso);

  if (dates.length === 0) {
    if (daysSinceLast < 0) return 2;
    if (daysSinceLast <= 45) return 2;
    if (daysSinceLast <= 120) return 2;
    return 1;
  }

  const n30 = countInteractionsInRollingWindow(dates, 30, todayIso);
  const n90 = countInteractionsInRollingWindow(dates, 90, todayIso);
  const n180 = countInteractionsInRollingWindow(dates, 180, todayIso);

  let tier: 1 | 2 | 3 | 4 | 5;
  if (n30 >= 6 || n90 >= 12) tier = 5;
  else if (n30 >= 3 || n90 >= 6) tier = 4;
  else if (n30 >= 2 || n90 >= 4) tier = 3;
  else if (n30 >= 1 || n90 >= 2) tier = 2;
  else if (n180 >= 1) tier = 2;
  else tier = 1;

  if (daysSinceLast > 180) tier = Math.min(tier, 1) as 1 | 2 | 3 | 4 | 5;
  else if (daysSinceLast > 90) tier = Math.min(tier, 2) as 1 | 2 | 3 | 4 | 5;
  else if (daysSinceLast > 45) tier = Math.min(tier, 3) as 1 | 2 | 3 | 4 | 5;

  return tier;
}
