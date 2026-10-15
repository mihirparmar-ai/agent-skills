/**
 * lookups.mjs: the read-only data layer shared by both modes of the critic.
 *
 * Everything the checker "knows" comes from files in this folder: the itinerary,
 * five rules files, and a corpus snapshot. Nothing here calls the network and
 * nothing here writes. The script mode (checks.mjs) and the agent mode
 * (tools.mjs) both sit on these functions, which is the point of the demo: the
 * same verifiable facts, reached two different ways.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const QA_ROOT = resolve(here, "..");

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

export function loadRules() {
  const r = (f) => readJson(join(QA_ROOT, "rules", f));
  return {
    hours: r("hours.json"),
    ticketing: r("ticketing.json"),
    buffers: r("buffers.json"),
    jetlag: r("jetlag.json"),
    contingency: r("contingency.json"),
  };
}

export function loadCorpus() {
  return readJson(join(QA_ROOT, "corpus", "destinations.json")).destinations;
}

export function loadItinerary(path) {
  const it = readJson(resolve(path));
  if (!it.trip || !Array.isArray(it.days)) throw new Error(`Not an itinerary file: ${path}`);
  return it;
}

/* ---- calendar helpers (deterministic, so the model never does date math) ---- */

const noon = (dateISO) => new Date(`${dateISO}T12:00:00`);
export const weekdayOf = (dateISO) => noon(dateISO).toLocaleDateString("en-US", { weekday: "long" });
export const monthAbbr = (dateISO) => noon(dateISO).toLocaleDateString("en-US", { month: "short" });
export const shortDate = (dateISO) => noon(dateISO).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function minutesBetween(hhmmFrom, hhmmTo) {
  const [h1, m1] = hhmmFrom.split(":").map(Number);
  const [h2, m2] = hhmmTo.split(":").map(Number);
  return h2 * 60 + m2 - (h1 * 60 + m1);
}

/** UTC offset in hours for a zone on a date, e.g. Asia/Tokyo in July = 9, Los Angeles = -7. */
export function offsetHours(timeZone, dateISO) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(new Date(`${dateISO}T12:00:00Z`));
  const label = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /GMT([+-])(\d{1,2})(?::?(\d{2}))?/.exec(label);
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) + Number(m[3] ?? 0) / 60);
}

/* ---- lookups ---- */

export function lookupDestination(corpus, name) {
  return corpus.find((d) => d.destination_name.toLowerCase() === String(name).toLowerCase()) ?? null;
}

export function lookupVenue(rules, venueId) {
  const hours = rules.hours.venues[venueId] ?? null;
  const ticketing = rules.ticketing.venues[venueId] ?? null;
  if (!hours && !ticketing) return { venue_id: venueId, known: false, note: "Not in the rules files. Unknown means unverified: do not assume it is open, and do not flag a closure without a source." };
  return { venue_id: venueId, known: true, hours, ticketing };
}

export function bufferRule(rules, fromMode, toMode) {
  const key = `${fromMode}->${toMode}`;
  return { pair: key, rule: rules.buffers.pairs[key] ?? null };
}

export function jetlagContext(rules, it, corpus) {
  const destTz = lookupDestination(corpus, it.days[0]?.destination)?.timezone_iana ?? "Asia/Tokyo";
  const shift = offsetHours(destTz, it.trip.arrival.date) - offsetHours(it.trip.home_timezone, it.trip.arrival.date);
  return { home_timezone: it.trip.home_timezone, destination_timezone: destTz, shift_hours: shift, applies: Math.abs(shift) >= rules.jetlag.min_shift_hours, rules: rules.jetlag };
}

export function wetMonths(rules, destination) {
  return rules.contingency.wet_months[destination] ?? { months: [], note: "No wet-month data for this destination." };
}
