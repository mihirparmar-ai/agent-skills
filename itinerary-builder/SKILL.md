---
name: itinerary-builder
description: Use when the user asks to build, draft, QA, check, or evaluate an itinerary with the ERL itinerary builder, or asks what the profile settles for a client. Triggers on "build the itinerary", "draft from the profile", "compile the profile", "check this draft", "what breaks in this plan", "run the eval", "score the draft", or a path to a draft JSON in this folder's shape. Wraps itinerary-builder.mjs: compile (what the Trip DNA settles and the venues it allows), check (rule and profile checks on any draft, findings with evidence, never edits), draft (the agent loop; needs a credential), eval (golden set recall and precision, the scorecard, advisor dispositions). Synthetic demo data only; never use it to book or send anything.
---

# Itinerary builder

One agent. It drafts from what the house knows about a client, checks its own draft, and hands the advisor a proposal. You never edit a draft in place, never book, never send.

## Commands

```
node itinerary-builder.mjs compile              what the profile settles + the venue shortlist
node itinerary-builder.mjs check <draft.json>   findings on any draft (golden case or raw itinerary)
node itinerary-builder.mjs draft                the agent loop (needs ANTHROPIC_API_KEY)
node itinerary-builder.mjs eval                 golden set + scorecard + dispositions
```

## When asked to check a draft

Run `check`. Present the findings as printed: id, class, day, evidence, rule, source. Then add judgment findings from `corpus/destinations.json` (a signature experience at the wrong hour, a pitfall walked into, a day that zigzags against "group geographically"), each labeled judgment with the corpus field quoted. Do not argue with rule findings; if a rule looks wrong, say so separately.

## When asked to build

If a credential is present, run `draft` and present the proposal, the open findings, and the advisor's questions. If not, say so, run `compile`, and draft by hand from the shortlist and the constraints, then run `check` on your draft and revise until only unfixable findings remain. Finish with one line per day naming the signal behind it.

## When asked how it learns

Run `eval` and read the three sections aloud: the checker against its golden set, the scorecard, and the dispositions. Point at `golden/README.md` for how a rejected finding becomes a case.
