# Itinerary builder

One agent that drafts a family's trip from what the house knows about them, checks its own draft against house rules and the family's profile, and hands the advisor a proposal with the reasoning and the questions it could not settle. It never books, never sends, and never writes to a client. This is a sanitized copy of the production files behind [En Route Luxe](https://www.enrouteluxe.com); the family, the quotes and the past trips are invented, the venues and rules are real.

## Run it in a minute

```bash
npm install
node itinerary-builder.mjs compile                              # what the profile settles, and the venues it allows
node itinerary-builder.mjs check golden/cases/faulty-japan.json # the rule and profile checks on any draft
node itinerary-builder.mjs eval                                 # the checker against its golden set, the scorecard, the dispositions
ANTHROPIC_API_KEY=... node itinerary-builder.mjs draft          # the agent loop: draft, check, revise, finalize
```

The first three need no credential and run in about a second each. `eval` today reports 100% recall and 100% precision on 23 expected findings across three golden cases, and a scorecard pass on the advisor-approved reference draft.

## What is in here

| Piece | File | What it is |
|---|---|---|
| The agent card | `AGENT.md` | Trigger, tools, loop, state, policy; what it escalates; how it is measured; the 60-second narration |
| The profile | `profile.json` | A Trip DNA file. Three signal classes (explicit, conversational, behavioral), every field with a source and a date |
| The brief | `brief.json` | The request as it arrives: destinations, dates, party, budget band, a few sentences in the family's words |
| The rules | `rules/` | Hours, ticketing windows, transfer buffers, jet-lag pacing, wet-month contingency. Every venue entry has a `source` and a `checked_on` date; a venue not in the file is unverified, never assumed open |
| The venue catalog and corpus | `venues.json`, `corpus/destinations.json` | What the agent may pick from; it cannot invent a venue |
| The checks | `lib/checks.mjs`, `lib/dna.mjs` | Seven rule checks plus the profile checks, deterministic, each finding with evidence and the rule that fired |
| The tools | `lib/tools.mjs` | Six reads and one write; the write runs every check on the draft and returns the findings |
| The evals | `lib/evals.mjs`, `golden/` | A golden set with expected findings, recall and precision per case, a scorecard for any draft, and the dispositions loop |
| The skill | `SKILL.md` | The Claude Code wrapper that runs the four commands in a session |
| The one-pager | `ONE_PAGER.html` | The talk-through of what an agent is and why this is one |

## The idea

A chat is a model answering a question; the human is the loop, the memory, the tool-caller and the verifier. An agent is a model inside a loop with tools, state and a stopping policy. The product work is the stopping policy: what the agent may do alone, what it drafts for review, and what it raises as a question with the evidence attached. Here the write list has one entry, and it is a findings list.

Two layers, measured two ways. The checker is deterministic, so it gets a golden set and a recall and precision number. The drafting is judgment, so a draft gets a scorecard against an advisor-approved reference: hard constraints, must-have coverage, profile violations, escalation coverage, rationale traceability, reference overlap. Every finding the advisor accepts, rejects or fixes goes to `out/dispositions.jsonl`, and a rejected finding becomes a candidate golden case with the rule narrowed.

## What it is not

Not wired to the website. Not live rules (hours and windows are cached with a checked-on date). Not client data. Not a booking agent.

Part of [agent-skills](../README.md). The thinking behind it is in [The editor layer](https://www.mihirparmar.ai/writing/editor-layer).
