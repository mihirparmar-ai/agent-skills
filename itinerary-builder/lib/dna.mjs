/**
 * dna.mjs: the profile compiler and the profile checks.
 *
 * compileConstraints turns a Trip DNA profile plus a brief into a short list
 * of constraints, each carrying the signal it came from (explicit,
 * conversational, or behavioral) so a choice in the draft can be traced back
 * to something the client said or did. profileChecks then holds a draft
 * against those constraints, deterministically. Both are the personalization
 * receipt: what we know, made into rules, and applied where.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { monthAbbr, shortDate } from "./lookups.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const BUILDER_ROOT = resolve(here, "..");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
export const loadBrief = (p) => readJson(resolve(p));
export const loadProfile = (p) => readJson(resolve(p));
export const loadVenues = () => readJson(join(BUILDER_ROOT, "venues.json")).venues;

const ANCHOR_TAGS = new Set(["temple", "museum"]);

export function compileConstraints(profile, brief) {
  const C = [];
  const add = (c) => C.push(c);
  const kidsAges = profile.household.kids.map((k) => k.age);
  const youngest = Math.min(...kidsAges);

  /* explicit */
  const ex = profile.explicit;
  for (const d of ex.diet?.exclusions ?? []) add({ id: `diet-${d}`, kind: "exclude_tag", tag: d, text: `No venue tagged "${d}". ${ex.diet.note}`, signal: "explicit", source: ex.source });
  for (const a of ex.avoid ?? []) {
    if (/theme park/i.test(a)) add({ id: "one-theme-park", kind: "max_tag_per_trip", tag: "theme-park", max: 1, text: `At most one theme park on the trip.`, signal: "explicit", source: ex.source });
  }
  for (const m of ex.must_haves ?? []) add({ id: `must-${slug(m)}`, kind: "must_have", text: m, signal: "explicit", source: ex.source });
  add({ id: "transport", kind: "note", text: ex.transport, signal: "explicit", source: ex.source });

  /* conversational: quotes become numbers where they can */
  for (const q of profile.conversational?.quotes ?? []) {
    const src = `${q.who}, ${shortDate(q.date)}: "${q.text}"`;
    if (/nine is early|not a 6 a\.m\. family/i.test(q.text)) add({ id: "earliest-start", kind: "earliest_start", time: "09:30", text: "No scheduled start before 09:30, any day.", signal: "conversational", source: src });
    if (/mutiny by the third temple|two is the limit/i.test(q.text)) add({ id: "max-anchors", kind: "max_anchors_per_day", max: 2, text: "At most two temples or museums on any one day.", signal: "conversational", source: src });
    if (/driver day was the best/i.test(q.text)) add({ id: "driver-day", kind: "note", text: "Give the trip one private-driver day; put it where rail fights the family.", signal: "conversational", source: src });
    if (/conveyor sushi was a hit/i.test(q.text)) add({ id: "kid-food", kind: "prefer_tag", tag: "fish", text: "A conveyor-sushi dinner lands with Child 2; food that looks like a game does.", signal: "conversational", source: src });
  }

  /* behavioral: lessons become rules */
  for (const t of profile.behavioral?.past_trips ?? []) {
    if (/before 09:00 gets cancelled/i.test(t.lesson)) add({ id: "no-dawn", kind: "earliest_start", time: "09:00", text: "Nothing before 09:00; they cancel dawn starts the night before.", signal: "behavioral", source: `${t.trip}: skipped ${t.skipped.join("; ")}` });
    if (/one hands-on thing in the afternoon/i.test(t.lesson)) add({ id: "hands-on-daily", kind: "prefer_tag_daily", tag: "hands-on", text: "One hands-on thing most afternoons; that is what they still talk about.", signal: "behavioral", source: `${t.trip}: raved about ${t.raved_about.join("; ")}` });
  }

  /* household */
  add({ id: "youngest", kind: "min_age_floor", age: youngest, text: `Youngest traveler is ${youngest}; no venue with a higher age floor.`, signal: "explicit", source: "household" });

  /* derived: the strictest earliest start wins */
  const starts = C.filter((c) => c.kind === "earliest_start").map((c) => c.time).sort();
  const earliest = starts.length ? starts[starts.length - 1] : "09:00";
  return { client_id: profile.client_id, kids_ages: kidsAges, youngest, earliest_start: earliest, constraints: C };
}

/** Deterministic checks of a draft against the compiled constraints. Same finding shape as the critic. */
export function profileChecks(draft, compiled, venues) {
  const F = [];
  const add = (f) => F.push({ id: `P-${String(F.length + 1).padStart(3, "0")}`, class: "profile", basis: "rule", ...f });
  const byId = Object.fromEntries(venues.map((v) => [v.id, v]));
  const cs = compiled.constraints;
  const excluded = cs.filter((c) => c.kind === "exclude_tag");
  const maxAnchors = cs.find((c) => c.kind === "max_anchors_per_day");
  const musts = cs.filter((c) => c.kind === "must_have");
  const tagCaps = cs.filter((c) => c.kind === "max_tag_per_trip");
  const tagCount = {};

  for (const day of draft.days) {
    let anchors = 0;
    for (const item of day.items) {
      const v = item.venue_id ? byId[item.venue_id] : null;
      if (item.time < compiled.earliest_start && !["flight", "transfer", "rail"].includes(item.kind)) {
        const c = cs.find((x) => x.kind === "earliest_start" && x.time === compiled.earliest_start);
        add({ day: day.date, item: item.venue, evidence: `Starts ${item.time}; the profile floor is ${compiled.earliest_start}.`, rule: c.text, source: `${c.signal}: ${c.source}` });
      }
      if (!v) continue;
      for (const ex of excluded) if (v.tags.includes(ex.tag)) add({ day: day.date, item: v.name, evidence: `Venue is tagged "${ex.tag}".`, rule: ex.text, source: `${ex.signal}: ${ex.source}` });
      if (v.tags.some((t) => ANCHOR_TAGS.has(t))) anchors += 1;
      for (const t of v.tags) tagCount[t] = (tagCount[t] ?? 0) + 1;
    }
    if (maxAnchors && anchors > maxAnchors.max) add({ day: day.date, item: `${anchors} temples or museums`, evidence: `${shortDate(day.date)} carries ${anchors}; the limit is ${maxAnchors.max}.`, rule: maxAnchors.text, source: `${maxAnchors.signal}: ${maxAnchors.source}` });
  }
  for (const cap of tagCaps) if ((tagCount[cap.tag] ?? 0) > cap.max) add({ day: draft.days[0].date, item: cap.tag, evidence: `${tagCount[cap.tag]} on the trip; the limit is ${cap.max}.`, rule: cap.text, source: `${cap.signal}: ${cap.source}` });
  for (const m of musts) {
    const hit = draft.days.some((d) => d.items.some((i) => i.venue_id && matchesMust(byId[i.venue_id], m.text)));
    if (!hit) add({ day: draft.days[0].date, item: m.text, evidence: "Not scheduled anywhere in the draft.", rule: `Must-have: ${m.text}`, source: `${m.signal}: ${m.source}` });
  }
  return F;
}

function matchesMust(v, text) {
  if (!v) return false;
  const t = text.toLowerCase();
  if (t.includes("teamlab")) return v.id.startsWith("teamlab");
  if (t.includes("ninja") || t.includes("samurai")) return v.id.includes("ninja");
  if (t.includes("kaiseki")) return v.tags.includes("kaiseki");
  return v.name.toLowerCase().includes(t);
}

/** The venues the profile allows, per destination, with the reason any venue was dropped. */
export function shortlist(compiled, venues) {
  const excluded = compiled.constraints.filter((c) => c.kind === "exclude_tag").map((c) => c.tag);
  const rows = venues.map((v) => {
    const drop = [];
    for (const t of excluded) if (v.tags.includes(t)) drop.push(`tagged ${t}`);
    if (v.tags.includes("adults")) drop.push("adults only");
    if (v.best_time === "dawn") drop.push(`dawn start, floor is ${compiled.earliest_start}`);
    return { id: v.id, name: v.name, destination: v.destination, kid_appeal: v.kid_appeal, best_time: v.best_time, tags: v.tags, keep: drop.length === 0, dropped_because: drop };
  });
  return rows;
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 30);
export { monthAbbr, shortDate };
