# The itinerary builder: agent card

One agent. It drafts a trip from what the house knows about a client, checks its own draft against the house rules and the client's profile, and hands the advisor a proposal with the reasoning and the questions it could not settle. It never books, never sends, and never writes to a client.

Everything here runs on synthetic data: an invented family, invented past trips, real public venues, and three public rows from the destination corpus. Built September 2026; published here as a sanitized copy of the production files.

## What an agent is, and why this is one

A chat is a model answering a question; the human is the loop, the memory, the tool-caller, and the verifier. An agent is a model inside a loop with tools, state, and a stopping policy: it observes, decides the next action, acts through a tool, checks the result, and continues, finishes, or escalates. The product work is the stopping policy.

| Mark | The itinerary builder |
|---|---|
| **Trigger** | A brief arrives. A file here; the intake form on the site in production. |
| **Tools** | Reads the brief, the Trip DNA profile, the venue catalog, the destination corpus, venue hours and ticketing windows. One write: `draft_itinerary`, which runs every check on the draft and returns the findings. |
| **Loop** | Read brief and profile. Look up destinations and venues. Draft. Read findings. Fix what can be fixed. Resubmit. Finalize. Capped at 30 turns. |
| **State** | The profile is state across trips: what the client said on calls and did on past trips shapes this draft. The draft history is state within a run. Every run is logged. |
| **Policy** | The draft is a proposal to the advisor, never client-facing. What the profile cannot settle goes up as a question with the evidence. Nothing is booked. |

## The tools

| Tool | Reads | Writes | Deterministic | Guards against |
|---|---|---|---|---|
| `get_brief` | `brief.json` | nothing | yes | designing for the wrong dates, party, or budget |
| `get_profile` | `profile.json` plus the compiled constraints | nothing | yes | designing from the intake form alone |
| `lookup_destination` | `corpus/destinations.json` | nothing | yes | the wrong month, a signature moment at the wrong hour, a known pitfall |
| `list_venues` | `venues.json` | nothing | yes | inventing a venue; every item must be a catalog id |
| `lookup_venue` | `rules/hours.json`, `rules/ticketing.json` | nothing | yes | a closed day, a missed ticket window, an age floor |
| `draft_itinerary` | the draft it is handed | the findings list | yes | everything above, on the agent's own work, before the advisor sees it |
| `finalize` | the current draft | the proposal, rationale, questions | no (the model composes) | a draft with no reasoning attached |

No tool edits a draft in place, books anything, or contacts anyone. The write list is the risk list, and it has one entry.

## What the house knows, as data

`profile.json` is a Trip DNA file. Three signal classes, every field with a source:

| Signal | Holds | Becomes |
|---|---|---|
| Explicit | intake form and onboarding call | a no-beef venue-tag exclusion, a one-theme-park cap, three must-have checks, an age floor from the youngest child |
| Conversational | dated quotes from calls and messages | a 09:30 floor on every start (Parent B, May 20), a two-temple daily cap (Parent A, May 20), a private-driver day, a conveyor-sushi preference |
| Behavioral | past trips: booked, raved about, skipped, the lesson | nothing before 09:00 (a cancelled 05:30 walk in Costa Rica), one hands-on thing an afternoon (the pasta class in Italy), one anchor a morning (the museum they left after 40 minutes) |

`compile` prints the compiled constraints with their sources. That output is the personalization receipt: the signal, the rule it became, and where it applies.

## The rules, with provenance

`rules/hours.json`, `ticketing.json`, `buffers.json`, `jetlag.json`, `contingency.json`. Every venue entry carries a `source` and a `checked_on` date. A venue not in the file is unknown, and unknown means unverified, never assumed open. The buffers and jet-lag floors are house rules and say so. This is the answer to "how does the agent know when the underlying data is uncertain": it does not guess; the file says when it was last checked, and the checker skips what it does not know.

Seven rule checks: timing against the corpus avoid months, group fit by age, closures and hours, ticketing windows, transfer buffers, jet-lag pacing on the days after arrival, and wet-month contingency. Plus the profile checks: the start floor, the anchor cap, tag exclusions, per-trip caps, must-have coverage.

## What it escalates rather than solves

Two collisions are built into the demo brief on purpose. July is an avoid month for both cities and the dates are school holidays, so the agent cannot fix the month; it mitigates (indoor afternoons) and asks. The kaiseki dinner the parents asked for seats no one under ten and the youngest is eight; the agent may propose it as adults-only with a sitter and must say so. The advisor's resolution is expressible in the data (`party: "adults"` on the item), which is how the reference draft passes.

## How it is measured

Two layers, because the agent has two layers.

**The checker is deterministic, so it gets a golden set.** `golden/cases/` holds drafts with the findings a human expects. `eval` reports recall (every expected finding caught) and precision (nothing flagged that a human would not) per case and overall. Three cases today: every rule class planted once; profile faults only; an advisor-approved reference where only the fixed month remains. Current result: 100% recall, 100% precision on 23 expected findings. Building the set found one checker bug (the arrival-day load rule keyed off the first day in the file, not the arrival date) and two gaps in the human expectations. That is what the set is for.

**The drafting is judgment, so a draft gets a scorecard.**

| Metric | Meaning | Reference draft |
|---|---|---|
| hard constraints | zero fixable findings on the final draft | pass |
| must-have coverage | intake must-haves present | 3 of 3 |
| profile violations | start floor, anchor cap, exclusions | 0 |
| escalation coverage | the expected advisor questions raised | 2 of 2 |
| rationale traceability | days whose rationale names a client signal | 4 of 5 (the fifth cites a house rule, not the client) |
| reference overlap | venues shared with the advisor-approved draft | 1.0 |

The same scorecard runs on the agent's latest draft the moment one exists.

**The loop.** The advisor's disposition on each finding (accepted, rejected, fixed) goes to `out/dispositions.jsonl`. `eval` turns that into per-class precision over time. A rejected finding becomes a candidate golden case with that finding removed and the rule narrowed; a miss the advisor catches becomes a case with the miss added. The mechanism exists; the data in it is zero as of today, and that is the honest sentence.

## Commands

```bash
npm install
node itinerary-builder.mjs compile
node itinerary-builder.mjs check golden/cases/faulty-japan.json
node itinerary-builder.mjs eval
node itinerary-builder.mjs draft        # needs ANTHROPIC_API_KEY in the shell
```

The first three need no credentials and run in about a second each. `draft` prints the trace (a thinking summary per turn, each tool call, each result), then the proposal day by day with one line of rationale per day, the findings left open, and the advisor's questions. Verified without a model: the compile output, the checker on all three golden cases, the scorecard on the reference, and the draft-check-revise mechanics through the tool layer (the faulty draft returns 11 fixable findings; the reference returns none). A live model run needs a credential; `draft` writes its trace and proposal to `out/`.

## The 60-second narration

"A returning family sends a brief. Trigger. The agent reads the profile: not just the intake form, but what they said on calls, dated, and what they actually did on the last two trips. In Italy they walked out of the second museum. In Costa Rica they cancelled the 05:30 walk. Those become rules: nothing before 09:30, two temples a day at most, one hands-on thing every afternoon. Tools. It drafts five days from a venue catalog and submits the draft to one tool that runs every check: closures, ticket windows, buffers, jet lag, and the client's own rules. Loop: it reads the findings, fixes what it can, resubmits. Policy: what it cannot fix, it raises. July is an avoid month and the dates are school holidays, so that is my call. The kaiseki the parents want does not seat an eight-year-old, so that is my call too. It hands me a proposal with one line per day naming the signal behind it. I edit. Nothing is booked and nothing reaches the client until I say so.

How does it learn? The checker has a golden set and reports recall and precision. The draft gets a scorecard against an advisor-approved reference. And every finding I accept, reject, or fix is logged, so precision per check can move over time and a rejected finding becomes a new case. The mechanism is built; the data is one trip old."

## What it is not

- Not wired to the website. The Second Opinion form is the eventual entry point; a separate change.
- Not live rules. Hours and ticket windows are cached with a source and a checked-on date.
- Not client data. The family, the quotes, and the past trips are invented.
- Not a booking agent. The write list has one entry and it is a findings list.

## Files

```
brief.json                   the request
profile.json                 the Trip DNA (explicit, conversational, behavioral)
venues.json                  the venue catalog; ids shared with rules/
rules/                       hours, ticketing, buffers, jetlag, contingency; source + checked_on per entry
corpus/destinations.json     three public corpus rows, snapshot
golden/cases/                faulty-japan, profile-violations, reference-japan; README explains the loop
lib/lookups.mjs              the read-only data layer
lib/checks.mjs               the seven rule checks
lib/dna.mjs                  profile compiler, profile checks, shortlist
lib/tools.mjs                the agent's tools; draft_itinerary runs the checks
lib/evals.mjs                golden-set runner, scorecard, dispositions report
out/                         runs (ignored by git)
itinerary-builder.mjs        compile | check | draft | eval
SKILL.md                     the Claude Code skill wrapper
ONE_PAGER.html               the one-page talk-through
```
