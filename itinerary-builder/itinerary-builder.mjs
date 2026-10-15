#!/usr/bin/env node
/**
 * itinerary-builder.mjs: one agent, four commands.
 *
 *   node itinerary-builder.mjs compile              what the profile settles, and the venues it allows
 *   node itinerary-builder.mjs check <draft.json>   the rule and profile checks on any draft (a golden case or a raw itinerary)
 *   node itinerary-builder.mjs draft                the agent: draft, check, revise, finalize (needs a credential)
 *   node itinerary-builder.mjs eval                 the checker against its golden set, the scorecard, the dispositions
 *
 * Options: --brief <file> --profile <file> --model <id> --max-turns <n> --quiet
 * Defaults: brief.json and profile.json in this folder, claude-opus-5, 30 turns.
 *
 * The agent, in five marks:
 *   trigger  a brief arrives (a file here; the intake form in production)
 *   tools    reads the brief, the Trip DNA profile, the venue catalog, the corpus, venue hours and
 *            ticketing windows; one write, draft_itinerary, which runs the checks and returns findings
 *   loop     draft, read findings, fix what it can, resubmit, finalize; capped
 *   state    the profile is state across trips; the draft history is state within a run; runs are logged
 *   policy   the draft is a proposal to the advisor, never client-facing; what the profile cannot settle
 *            goes up as a question; nothing is booked
 */
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadRules, loadCorpus, loadItinerary, shortDate } from "./lib/lookups.mjs";
import { runChecks } from "./lib/checks.mjs";
import { loadBrief, loadProfile, loadVenues, compileConstraints, profileChecks, shortlist, BUILDER_ROOT } from "./lib/dna.mjs";
import { makeAssemblyTools } from "./lib/tools.mjs";
import { loadCases, evalChecker, scoreDraft, dispositionReport } from "./lib/evals.mjs";

const args = process.argv.slice(2);
const command = args.find((a) => !a.startsWith("--")) ?? "help";
const flag = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const quiet = args.includes("--quiet");
const say = (s) => { if (!quiet) console.log(s); };
const OUT = join(BUILDER_ROOT, "out");
mkdirSync(OUT, { recursive: true });

const brief = loadBrief(flag("--brief", join(BUILDER_ROOT, "brief.json")));
const profile = loadProfile(flag("--profile", join(BUILDER_ROOT, "profile.json")));
const venues = loadVenues();
const rules = loadRules();
const corpus = loadCorpus();
const compiled = compileConstraints(profile, brief);
const ctx = { brief, profile, compiled, venues, rules, corpus };

switch (command) {
  case "compile": compile(); break;
  case "check": check(); break;
  case "draft": await draft(); break;
  case "eval": evaluate(); break;
  default: help();
}

/* ---------------------------------------------------------------- compile */
function compile() {
  console.log(`== itinerary-builder compile ==`);
  console.log(`client ${profile.client_id} (synthetic) · ${brief.destination_ids.join(" and ")} · ${shortDate(brief.dates.start)} to ${shortDate(brief.dates.end)} · dates ${brief.dates.flexible ? "flexible" : "fixed"}`);
  console.log(`\nWhat the profile settles: ${compiled.constraints.length} constraints · earliest start ${compiled.earliest_start} · youngest ${compiled.youngest}`);
  for (const sig of ["explicit", "conversational", "behavioral"]) {
    const rows = compiled.constraints.filter((c) => c.signal === sig);
    if (!rows.length) continue;
    console.log(`\n  ${sig.toUpperCase()}`);
    for (const c of rows) console.log(`    ${c.text}\n      from: ${c.source}`);
  }
  const rows = shortlist(compiled, venues);
  console.log(`\nVenues the profile allows`);
  for (const dest of brief.destination_ids) {
    const keep = rows.filter((r) => r.destination === dest && r.keep), drop = rows.filter((r) => r.destination === dest && !r.keep);
    console.log(`  ${dest}: ${keep.length} allowed, ${drop.length} dropped`);
    for (const r of keep) console.log(`    ${r.id.padEnd(26)} kid ${r.kid_appeal}  ${r.best_time.padEnd(15)} ${r.tags.join(", ")}`);
    for (const r of drop) console.log(`    dropped ${r.id}: ${r.dropped_because.join("; ")}`);
  }
  persist("compile", { compiled, shortlist: rows });
}

/* ------------------------------------------------------------------ check */
function check() {
  const path = args.filter((a) => !a.startsWith("--") && a !== "check").find((a, i, arr) => !["--brief", "--profile", "--model", "--max-turns"].includes(args[args.indexOf(a) - 1]));
  if (!path) { console.error("usage: check <draft.json>"); process.exit(2); }
  const raw = JSON.parse(readFileSync(resolve(path), "utf8"));
  const it = raw.itinerary ?? raw;
  console.log(`== itinerary-builder check ==`);
  console.log(`${raw.case_id ? `golden case ${raw.case_id}: ${raw.purpose}` : it.trip?.name ?? path}`);
  const findings = [...runChecks(it, rules, corpus, { onStep: say }), ...profileChecks(it, compiled, venues)];
  printFindings(findings);
  persist("check", { path, findings });
  process.exit(findings.filter((f) => f.class !== "timing").length ? 1 : 0);
}

function printFindings(list) {
  console.log(`\nFindings (${list.length})`);
  const byClass = {}; for (const f of list) byClass[f.class] = (byClass[f.class] ?? 0) + 1;
  console.log(Object.entries(byClass).map(([k, v]) => `${k} ${v}`).join(" · ") || "none");
  for (const f of list) {
    console.log(`\n${f.id}  ${f.class.toUpperCase()}  ${shortDate(f.day)}  ${f.item}`);
    console.log(`  evidence: ${f.evidence}`);
    console.log(`  rule: ${f.rule}`);
    console.log(`  source: ${f.source}`);
  }
  console.log(`\nexit code: ${list.filter((f) => f.class !== "timing").length ? 1 : 0} (1 means fixable findings exist; nothing was edited)`);
}

/* ------------------------------------------------------------------ draft */
async function draft() {
  const model = flag("--model", "claude-opus-5");
  const maxTurns = Number(flag("--max-turns", 30));
  console.log(`== itinerary-builder draft (agent) ==`);
  console.log(`client ${profile.client_id} (synthetic) · ${brief.destination_ids.join(" and ")} · model ${model}`);
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic();
    const tools = makeAssemblyTools(ctx);
    const system = [
      "You are the itinerary builder for a luxury travel advisory. A returning client has sent a brief. You design a day-by-day draft from what the house knows about them, check it against the house rules and their own profile, and hand the advisor a proposal with the reasoning. The draft is never client-facing and nothing is booked.",
      "",
      "Method:",
      "1. get_brief, then get_profile. Read the quotes and the past trips, not just the intake. The compiled constraints say what the profile settles; the quotes say why.",
      "2. lookup_destination for each destination: timing truths, pitfalls, and highlights place things at the right time of day.",
      "3. list_venues for each destination and lookup_venue for anything with a ticket or a closure risk. Use only catalog venue_ids for activities and meals.",
      "4. draft_itinerary with a complete draft. Read the findings. Fix what can be fixed and resubmit. Do not fix the month: the brief fixes the dates, so a timing finding becomes a question for the advisor with what you did to mitigate it. A must-have that collides with a venue rule is also a question, not a silent omission; you may mark a dinner party: adults if the advisor would arrange a sitter, and say so.",
      "5. finalize: one line per day naming the profile signal behind its shape (a quote, a past trip, an intake field), the open findings, and the advisor's questions.",
      "House rules: nothing before the profile floor; the arrival day holds at most two things; one hands-on thing most afternoons; tickets with an advance window are to_book, never on_arrival; every outdoor-heavy day in a wet month gets a named fallback. Do not write prose outside tool calls.",
    ].join("\n");
    const messages = [{ role: "user", content: `Brief received for ${profile.client_id}. Start with get_brief.` }];
    let turn = 0;
    while (turn < maxTurns && !tools.isFinished()) {
      turn += 1;
      const response = await client.messages.create({ model, max_tokens: 16000, thinking: { type: "adaptive", display: "summarized" }, system, tools: tools.definitions, messages });
      if (response.stop_reason === "refusal") { console.error("The model declined; nothing recorded."); break; }
      if (response.stop_reason === "max_tokens") { console.error("Hit max_tokens mid-turn; stopping."); break; }
      for (const b of response.content) {
        if (b.type === "thinking" && b.thinking?.trim()) say(`turn ${turn}  think: ${oneLine(b.thinking, 160)}`);
        if (b.type === "text" && b.text.trim()) say(`turn ${turn}  text: ${oneLine(b.text, 160)}`);
      }
      const calls = response.content.filter((b) => b.type === "tool_use");
      if (response.stop_reason !== "tool_use" || !calls.length) { say(`turn ${turn}  model ended the turn without calling finalize`); break; }
      messages.push({ role: "assistant", content: response.content });
      const results = [];
      for (const call of calls) {
        say(`turn ${turn}  call ${call.name} ${oneLine(JSON.stringify(call.input), 140)}`);
        const result = tools.run(call.name, call.input);
        say(`         result ${oneLine(JSON.stringify(result), 160)}`);
        results.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(result) });
      }
      messages.push({ role: "user", content: results });
    }
    say(`turns used: ${turn}`);
    const result = tools.result();
    printProposal(result);
    persist("draft", { model, ...result });
    process.exit(result.final ? 0 : 1);
  } catch (err) {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    if (err instanceof Anthropic.AuthenticationError || /api key|ANTHROPIC_API_KEY|auth/i.test(String(err?.message))) console.error("\nThe draft command needs a credential: export ANTHROPIC_API_KEY, then run it again. compile, check, and eval need none.");
    else if (err instanceof Anthropic.APIError) console.error(`\nAPI error ${err.status}: ${err.message}`);
    else console.error(`\nDraft failed: ${err?.message ?? err}`);
    process.exit(2);
  }
}

function printProposal({ draft, findings, drafts, final }) {
  console.log(`\nProposal (draft ${drafts})`);
  if (!draft) { console.log("no draft"); return; }
  for (const d of draft.days) {
    console.log(`\n${shortDate(d.date)} ${d.destination}${d.fallback ? `  (fallback: ${d.fallback})` : ""}`);
    for (const i of d.items) console.log(`  ${i.time}  ${i.venue}${i.ticket ? ` [${i.ticket}]` : ""}${i.party ? ` (${i.party})` : ""}`);
    const r = final?.rationale_by_day?.find((x) => x.date === d.date);
    if (r) console.log(`  why: ${r.rationale}`);
  }
  console.log(`\nfindings on the final draft: ${(findings ?? []).length}`);
  for (const f of findings ?? []) console.log(`  ${f.id} ${f.class}: ${f.item}`);
  if (final) { console.log(`\nquestions for the advisor:`); for (const q of final.questions_for_advisor) console.log(`  - ${q}`); }
  console.log(`\nexit code: ${final ? 0 : 1} (a proposal for the advisor; nothing booked, nothing sent)`);
}

/* ------------------------------------------------------------------- eval */
function evaluate() {
  console.log(`== itinerary-builder eval ==`);
  const cases = loadCases(join(BUILDER_ROOT, "golden", "cases"));

  console.log(`\n1. The checker against its golden set (${cases.length} cases)`);
  const results = evalChecker(cases, ctx);
  let hits = 0, expected = 0, found = 0;
  for (const r of results) {
    hits += r.hits; expected += r.expected; found += r.found;
    console.log(`  ${r.case_id.padEnd(20)} expected ${String(r.expected).padStart(2)}  found ${String(r.found).padStart(2)}  recall ${pct(r.recall)}  precision ${pct(r.precision)}   ${r.purpose}`);
    for (const m of r.misses) console.log(`      MISSED   ${m.class}: ${m.item_contains}`);
    for (const u of r.unexpected) console.log(`      extra    ${u.class}: ${u.item}`);
  }
  console.log(`  overall: recall ${pct(expected ? hits / expected : 1)} · precision ${pct(found ? hits / found : 1)}`);

  console.log(`\n2. Scorecard`);
  const ref = cases.find((c) => c.role === "reference");
  const scoreOf = (label, run) => {
    const s = scoreDraft(run, { compiled, reference: ref?.itinerary, expectedQuestions: ref?.expected_questions ?? [] });
    console.log(`  ${label}`);
    console.log(`    hard constraints      ${s.hard_constraints.pass ? "pass" : `FAIL (${s.hard_constraints.open_fixable} open: ${s.hard_constraints.detail.join("; ")})`}`);
    console.log(`    must-have coverage    ${s.must_have_coverage.covered} of ${s.must_have_coverage.of}`);
    console.log(`    profile violations    ${s.profile_violations}`);
    console.log(`    escalation coverage   ${s.escalation_coverage.hit} of ${s.escalation_coverage.of}${s.escalation_coverage.questions.length ? "" : " (no questions recorded)"}`);
    console.log(`    rationale traceable   ${s.rationale_traceability.traced} of ${s.rationale_traceability.of} days`);
    console.log(`    reference overlap     ${s.reference_overlap.jaccard === null ? "n/a" : `${s.reference_overlap.jaccard} (${s.reference_overlap.shared} shared venues of ${s.reference_overlap.union})`}`);
    return s;
  };
  if (ref) {
    const refFindings = [...runChecks(ref.itinerary, rules, corpus), ...profileChecks(ref.itinerary, compiled, venues)];
    scoreOf(`reference draft (${ref.case_id}, advisor-approved; should pass)`, { draft: ref.itinerary, findings: refFindings, final: ref.reference_final });
  }
  const latest = join(OUT, "latest-draft.json");
  if (existsSync(latest)) {
    const run = JSON.parse(readFileSync(latest, "utf8"));
    scoreOf(`latest agent draft (${run.run_id}, model ${run.model})`, run);
  } else {
    console.log(`  latest agent draft: none yet. Run "draft" with a credential and this scores it.`);
  }

  console.log(`\n3. The loop: advisor dispositions on findings`);
  const rep = dispositionReport(join(OUT, "dispositions.jsonl"));
  if (!rep) console.log(`  none recorded yet. Append lines to out/dispositions.jsonl as {"run_id","finding_id","class","disposition":"accepted|rejected|fixed","note"}; a rejected finding is a candidate golden case.`);
  else for (const r of rep) console.log(`  ${r.class.padEnd(12)} total ${r.total}  accepted ${r.accepted}  fixed ${r.fixed}  rejected ${r.rejected}  precision ${pct(r.precision)}`);
  persist("eval", { checker: results, dispositions: rep });
}

/* ------------------------------------------------------------------ misc */
function help() {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 22).map((l) => l.replace(/^ \* ?/, "")).join("\n"));
}
function persist(cmd, data) {
  const record = { run_id: new Date().toISOString(), command: cmd, ...data };
  writeFileSync(join(OUT, `latest-${cmd}.json`), JSON.stringify(record, null, 2));
  appendFileSync(join(OUT, "runs.jsonl"), JSON.stringify(record) + "\n");
  say(`\nwrote ./out/latest-${cmd}.json`);
}
function pct(x) { return x === null ? "n/a" : `${Math.round(x * 100)}%`; }
function oneLine(s, n) { const t = String(s).replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; }
