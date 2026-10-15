/**
 * evals.mjs: how the builder is measured.
 *
 * Two layers, because the builder has two layers.
 *   1. The checker is deterministic, so it gets a golden set: cases with the
 *      findings a human expects. Recall (did it catch every planted fault)
 *      and precision (did it flag anything a human would not) per class.
 *   2. The drafting is judgment, so a draft gets a scorecard: hard constraints,
 *      must-have coverage, profile violations, escalation coverage, rationale
 *      traceability, and overlap with an advisor-approved reference.
 * Plus the loop: the advisor's dispositions on findings, read from
 * out/dispositions.jsonl, become per-class precision over time, and any
 * rejected finding is a candidate golden case.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { runChecks } from "./checks.mjs";
import { profileChecks } from "./dna.mjs";

export function loadCases(dir) {
  return readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => ({ file: f, ...JSON.parse(readFileSync(join(dir, f), "utf8")) }));
}

/** Layer 1: the checker against its golden set. */
export function evalChecker(cases, { rules, corpus, compiled, venues }) {
  const results = [];
  for (const c of cases) {
    const found = [...runChecks(c.itinerary, rules, corpus), ...profileChecks(c.itinerary, compiled, venues)];
    const expected = c.expected_findings ?? [];
    const matched = new Set();
    const misses = [];
    for (const e of expected) {
      const hit = found.find((f, i) => !matched.has(i) && f.class === e.class && String(f.item + " " + f.evidence).toLowerCase().includes(e.item_contains.toLowerCase()));
      if (hit) matched.add(found.indexOf(hit)); else misses.push(e);
    }
    const unexpected = found.filter((f, i) => !matched.has(i));
    results.push({ case_id: c.case_id, purpose: c.purpose, expected: expected.length, found: found.length, hits: matched.size, misses, unexpected: unexpected.map((f) => ({ class: f.class, item: f.item })), recall: expected.length ? matched.size / expected.length : 1, precision: found.length ? matched.size / found.length : 1 });
  }
  return results;
}

/** Layer 2: a draft plus its finalize payload, scored. */
export function scoreDraft({ draft, findings, final }, { compiled, reference, expectedQuestions = [] }) {
  const fixable = (findings ?? []).filter((f) => f.class !== "timing");
  const musts = compiled.constraints.filter((c) => c.kind === "must_have");
  const mustMissing = (findings ?? []).filter((f) => f.class === "profile" && /^Must-have/.test(f.rule)).length;
  const profileViolations = (findings ?? []).filter((f) => f.class === "profile" && !/^Must-have/.test(f.rule)).length;
  const questions = final?.questions_for_advisor ?? [];
  const escHits = expectedQuestions.filter((rx) => questions.some((q) => new RegExp(rx, "i").test(q)));
  const rationales = final?.rationale_by_day ?? [];
  const signalRx = /intake|onboarding|call|quote|said|May 20|Jun 2|Jun 11|Italy|Costa Rica|past trip|last trip|skipped|raved/i;
  const traced = rationales.filter((r) => signalRx.test(r.rationale)).length;
  const ids = (d) => new Set((d?.days ?? []).flatMap((day) => day.items.map((i) => i.venue_id).filter(Boolean)));
  const a = ids(draft), b = ids(reference);
  const inter = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return {
    hard_constraints: { pass: fixable.length === 0, open_fixable: fixable.length, detail: fixable.map((f) => `${f.class}: ${f.item}`) },
    must_have_coverage: { covered: musts.length - mustMissing, of: musts.length },
    profile_violations: profileViolations,
    escalation_coverage: { hit: escHits.length, of: expectedQuestions.length, questions },
    rationale_traceability: { traced, of: draft?.days?.length ?? 0 },
    reference_overlap: { jaccard: union ? Number((inter / union).toFixed(2)) : null, shared: inter, union },
    drafts_to_finalize: final ? (draft?.drafts ?? null) : null,
  };
}

/** The loop: dispositions the advisor recorded on findings. */
export function dispositionReport(path) {
  if (!existsSync(path)) return null;
  const rows = readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const byClass = {};
  for (const r of rows) {
    const c = (byClass[r.class] ??= { total: 0, accepted: 0, fixed: 0, rejected: 0 });
    c.total += 1; c[r.disposition] = (c[r.disposition] ?? 0) + 1;
  }
  return Object.entries(byClass).map(([cls, c]) => ({ class: cls, ...c, precision: c.total ? Number(((c.accepted + c.fixed) / c.total).toFixed(2)) : null }));
}
