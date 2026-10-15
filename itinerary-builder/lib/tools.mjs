/**
 * tools.mjs: the assembly agent's tool surface.
 *
 * Reads: the brief, the Trip DNA profile, the compiled constraints, the venue
 * catalog, the corpus, venue hours and ticketing. Writes: draft_itinerary
 * (which runs the critic and the profile checks on the draft and returns
 * the findings) and finalize. The draft is a proposal to the advisor. It is
 * never client-facing and nothing is booked.
 */
import { runChecks } from "./checks.mjs";
import { lookupDestination, lookupVenue, weekdayOf, monthAbbr } from "./lookups.mjs";
import { profileChecks } from "./dna.mjs";

export function makeAssemblyTools({ brief, profile, compiled, venues, rules, corpus }) {
  let draft = null;
  let lastFindings = null;
  let final = null;
  let drafts = 0;

  const definitions = [
    { name: "get_brief", description: "The client's request: destinations, dates and whether they are flexible, arrival and departure, budget band, and their own words. Call this first.", input_schema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "get_profile", description: "The Trip DNA: household, explicit intake, dated quotes from calls, and past trips with what they raved about and what they skipped. Plus the compiled constraints, each with the signal it came from. Design from this.", input_schema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "list_venues", description: "The venue catalog for a destination: id, area, outdoor, kid_appeal, duration, best_time, tags, whether a ticket is required. Use only these venue_ids in the draft.", input_schema: { type: "object", properties: { destination: { type: "string" } }, required: ["destination"], additionalProperties: false } },
    { name: "lookup_venue", description: "Hours, weekly closures, minimum age, and the advance ticketing window for a venue_id.", input_schema: { type: "object", properties: { venue_id: { type: "string" } }, required: ["venue_id"], additionalProperties: false } },
    { name: "lookup_destination", description: "The corpus row: best and avoid months, timing truths, pitfalls, signature moments, unique insights, highlights.", input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"], additionalProperties: false } },
    { name: "draft_itinerary", description: "Submit a complete draft. It is checked at once against the venue rules (closures, hours, ticketing windows, buffers, jet lag, contingency, timing) and against the client's compiled constraints; the findings come back. Revise and resubmit until only findings you cannot fix remain (for example the month, which the brief fixes). Each item: time HH:MM, kind (activity|meal|transfer|rail|flight), venue (display name), venue_id from the catalog for activities and meals, outdoor, ticket (bought|on_arrival|walk_up|to_book), and for transfers mode and arrive.", input_schema: { type: "object", properties: { days: { type: "array", items: { type: "object", properties: { date: { type: "string" }, destination: { type: "string" }, fallback: { type: ["string", "null"] }, items: { type: "array", items: { type: "object", properties: { time: { type: "string" }, kind: { type: "string" }, venue: { type: "string" }, venue_id: { type: "string" }, outdoor: { type: "boolean" }, ticket: { type: "string" }, mode: { type: "string" }, arrive: { type: "string" }, notes: { type: "string" } }, required: ["time", "kind", "venue"], additionalProperties: false } } }, required: ["date", "destination", "items"], additionalProperties: false } } }, required: ["days"], additionalProperties: false } },
    { name: "finalize", description: "End with the current draft as the proposal. Give one line of rationale per day that names the profile signal behind the day's shape, the open findings you could not fix and why, and the questions for the advisor.", input_schema: { type: "object", properties: { rationale_by_day: { type: "array", items: { type: "object", properties: { date: { type: "string" }, rationale: { type: "string" } }, required: ["date", "rationale"], additionalProperties: false } }, open_findings: { type: "array", items: { type: "string" } }, questions_for_advisor: { type: "array", items: { type: "string" } } }, required: ["rationale_by_day", "open_findings", "questions_for_advisor"], additionalProperties: false } },
  ];

  function toItinerary(days) {
    return {
      trip: { name: `${profile.client_id}, ${brief.destination_ids.join(" and ")}`, synthetic: true, party: { adults: profile.household.adults.length, kids_ages: compiled.kids_ages }, home_timezone: profile.household.home_timezone, arrival: { date: brief.dates.start, time: brief.arrival.time, airport: brief.arrival.airport, from: brief.arrival.from }, departure: { date: brief.dates.end, time: brief.departure.time, airport: brief.departure.airport } },
      days: days.map((d) => ({ date: d.date, destination: d.destination, fallback: d.fallback ?? null, items: d.items.map((i) => ({ ...i, outdoor: i.outdoor ?? false })) })),
    };
  }

  function run(name, input) {
    switch (name) {
      case "get_brief": return brief;
      case "get_profile": return { profile, compiled };
      case "list_venues": return venues.filter((v) => v.destination.toLowerCase() === String(input.destination).toLowerCase());
      case "lookup_venue": return lookupVenue(rules, input.venue_id);
      case "lookup_destination": { const c = lookupDestination(corpus, input.name); return c ? { known: true, ...c } : { known: false }; }
      case "draft_itinerary": {
        drafts += 1;
        draft = toItinerary(input.days);
        const critic = runChecks(draft, rules, corpus);
        const prof = profileChecks(draft, compiled, venues);
        lastFindings = [...critic, ...prof];
        const fixable = lastFindings.filter((f) => f.class !== "timing");
        return { draft_number: drafts, findings: lastFindings.map((f) => ({ id: f.id, class: f.class, day: f.day, item: f.item, evidence: f.evidence, rule: f.rule })), fixable_count: fixable.length, note: fixable.length ? "Revise and resubmit." : "No fixable findings remain. Timing findings, if any, go to the advisor as questions." };
      }
      case "finalize":
        if (!draft) return { error: "No draft submitted yet." };
        final = input;
        return { ok: true };
      default: return { error: `Unknown tool ${name}` };
    }
  }

  return { definitions, run, isFinished: () => final !== null, result: () => ({ draft, findings: lastFindings, drafts, final }), weekdayOf, monthAbbr };
}
