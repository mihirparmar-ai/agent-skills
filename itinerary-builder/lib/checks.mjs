/**
 * checks.mjs: the deterministic critic (script mode).
 *
 * Seven rule-based checks, run in a fixed order over every day. No model, no
 * network, no judgment. It cannot miss a rule it has and it cannot find a
 * problem it has no rule for. That is the contrast the demo is built to show.
 */
import {
  weekdayOf, monthAbbr, shortDate, minutesBetween,
  lookupDestination, lookupVenue, bufferRule, jetlagContext, wetMonths,
} from "./lookups.mjs";

const NON_SCHEDULED = new Set(["flight", "transfer", "rail", "ferry"]);
const uniq = (xs) => [...new Set(xs)];

export function runChecks(it, rules, corpus, { onStep = () => {} } = {}) {
  const findings = [];
  const add = (f) => {
    const id = `S-${String(findings.length + 1).padStart(3, "0")}`;
    findings.push({ id, basis: "rule", ...f });
    onStep(`  finding ${id} ${f.class}: ${f.item}`);
  };
  const kids = it.trip.party.kids_ages ?? [];
  const youngest = kids.length ? Math.min(...kids) : null;

  /* 1. timing: the month against the corpus avoid list, per destination */
  onStep("check timing (month vs corpus avoid months)");
  for (const dest of uniq(it.days.map((d) => d.destination))) {
    const c = lookupDestination(corpus, dest);
    if (!c) { onStep(`  ${dest}: not in corpus snapshot, skipped`); continue; }
    const days = it.days.filter((d) => d.destination === dest);
    for (const m of uniq(days.map((d) => monthAbbr(d.date)))) {
      if (c.avoid_months_arr.includes(m)) {
        add({
          class: "timing", day: days[0].date, item: `${dest}, ${m}`,
          evidence: `${days.length} day(s) in ${dest} fall in ${m}. The corpus lists ${m} under avoid months (${c.avoid_months_arr.join(", ")}); best months are ${c.best_months_arr.join(", ")}.`,
          rule: "destination avoid months", source: `corpus ${c.destination_id} avoid_months_arr. Timing truth: ${c.timing_truths}`,
        });
      }
    }
    if (youngest !== null && !c.group_fit_arr.includes("FAM")) {
      add({ class: "group_fit", day: days[0].date, item: dest, evidence: `Kids in the party (${kids.join(", ")}) and the corpus does not list ${dest} as family-fit (${c.group_fit_arr.join(", ")}).`, rule: "destination group fit", source: `corpus ${c.destination_id} group_fit_arr` });
    }
  }

  const jl = jetlagContext(rules, it, corpus);
  onStep(`jet-lag context: shift ${jl.shift_hours}h, rules ${jl.applies ? "apply" : "do not apply"}`);

  it.days.forEach((day, idx) => {
    const wd = weekdayOf(day.date);
    const m = monthAbbr(day.date);
    onStep(`day ${idx + 1} ${shortDate(day.date)} (${wd}) ${day.destination}: ${day.items.length} items`);
    const scheduled = day.items.filter((i) => !NON_SCHEDULED.has(i.kind));

    day.items.forEach((item, k) => {
      /* 2. closure and hours, 3. group fit by age */
      if (item.venue_id) {
        const v = lookupVenue(rules, item.venue_id);
        if (v.known && v.hours) {
          const h = v.hours;
          const src = `${h.source}, checked ${h.checked_on}`;
          if (h.closed_on?.includes(wd)) {
            add({ class: "closure", day: day.date, item: item.venue, evidence: `${shortDate(day.date)} is a ${wd}. ${h.name} is closed on ${h.closed_on.join(" and ")}. ${h.note ?? ""}`.trim(), rule: "weekly closure", source: src });
          } else if (h.open && item.time < h.open) {
            add({ class: "closure", day: day.date, item: item.venue, evidence: `Scheduled ${item.time}; ${h.name} opens ${h.open}.`, rule: "opening hours", source: src });
          } else if (h.last_entry && item.time > h.last_entry) {
            add({ class: "closure", day: day.date, item: item.venue, evidence: `Scheduled ${item.time}; last entry at ${h.name} is ${h.last_entry}.`, rule: "last entry", source: src });
          }
          if (h.min_age && youngest !== null && youngest < h.min_age && item.party !== "adults") {
            add({ class: "group_fit", day: day.date, item: item.venue, evidence: `Youngest traveler is ${youngest}; ${h.name} admits ${h.min_age}+. ${h.note ?? ""}`.trim(), rule: "venue minimum age", source: src });
          }
        }
        /* 4. ticketing windows */
        if (v.known && v.ticketing && v.ticketing.advance_days > 0) {
          const t = v.ticketing;
          const plan = item.ticket ?? "none";
          if (["on_arrival", "walk_up", "none"].includes(plan)) {
            add({ class: "ticketing", day: day.date, item: item.venue, evidence: plan === "none" ? `No ticket plan recorded. ${t.note}` : `Plan says "${plan}". ${t.note}`, rule: `secure ${t.advance_days} days ahead`, source: `${t.source}, checked ${t.checked_on}` });
          }
        }
      }
      /* 5. transfer buffers between consecutive legs */
      const prev = day.items[k - 1];
      if (prev?.arrive && prev.mode && item.mode && ["flight", "rail", "ferry"].includes(item.kind)) {
        const { pair: pairKey, rule } = bufferRule(rules, prev.mode, item.mode);
        const pair = pairKey.replace("->", " to ");
        if (rule) {
          const avail = minutesBetween(prev.arrive, item.time);
          if (avail < rule.min_minutes) {
            add({ class: "buffer", day: day.date, item: `${prev.venue} then ${item.venue}`, evidence: `${prev.arrive} arrival to ${item.time} departure is ${avail} minutes; the house minimum for ${pair} is ${rule.min_minutes}. ${rule.note}`, rule: `buffer ${pair}`, source: "rules/buffers.json" });
          }
        }
      }
    });

    /* 6. jet-lag pacing on the protected days, counted from the arrival date (not the first day in the file) */
    const daysSinceArrival = Math.round((new Date(`${day.date}T12:00:00`) - new Date(`${it.trip.arrival.date}T12:00:00`)) / 86400000);
    if (jl.applies && daysSinceArrival >= 0 && daysSinceArrival < rules.jetlag.protected_days) {
      for (const i of scheduled) {
        if (i.time < rules.jetlag.earliest_start) {
          add({ class: "jetlag", day: day.date, item: i.venue, evidence: `Day ${daysSinceArrival + 1} after a ${jl.shift_hours}-hour shift starts at ${i.time}; the house floor for the first ${rules.jetlag.protected_days} days is ${rules.jetlag.earliest_start}. ${rules.jetlag.note}`, rule: "jet-lag pacing", source: "rules/jetlag.json" });
        }
      }
      if (daysSinceArrival === 0 && scheduled.length > rules.jetlag.max_items_arrival_day) {
        add({ class: "jetlag", day: day.date, item: `${scheduled.length} scheduled items on arrival day`, evidence: `Arrival day carries ${scheduled.length} scheduled items; the house limit is ${rules.jetlag.max_items_arrival_day}.`, rule: "arrival-day load", source: "rules/jetlag.json" });
      }
    }

    /* 7. contingency: outdoor-heavy day in a wet month with no fallback */
    const outdoor = day.items.filter((i) => i.outdoor).length;
    const wet = wetMonths(rules, day.destination);
    if (outdoor >= rules.contingency.min_outdoor_items && wet.months.includes(m) && !day.fallback) {
      add({ class: "contingency", day: day.date, item: `${outdoor} outdoor items, no fallback`, evidence: `${m} is a wet month for ${day.destination} (${wet.note}) and the day has ${outdoor} outdoor items with no named fallback.`, rule: "wet-month fallback", source: "rules/contingency.json" });
    }
  });

  return findings;
}
