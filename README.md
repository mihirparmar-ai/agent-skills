# agent-skills

The AI operating stack behind [En Route Luxe](https://www.enrouteluxe.com), a luxury travel advisory I founded and run ($500K+ in annual bookings, grown entirely through repeat bookings and referrals). The business runs on a "virtual team" of Claude Code agents and custom skills that I build and ship daily. This repo shares the architecture and two of the utilities; the business machinery stays private.

## The idea: the editor layer

Agents draft. The human reviews. Every skill in the stack follows the same pattern I shipped at enterprise scale (LLM document intelligence at Zillow: ~85% to 98%+ accuracy with human-in-the-loop review, 1M+ documents a year):

1. **Deterministic checks where possible.** If a rule can be a script, it is a script. Models handle judgment, not arithmetic.
2. **Guardrails before output.** Closure checks, transfer buffers, ticketing rules, and contingency paths for itineraries; receipt tests and AI-tell scans for content.
3. **Skills as packaged judgment.** Each skill encodes one job's trigger conditions, workflow, quality bars, and anti-patterns, so every future session starts calibrated.
4. **Knowing what NOT to automate.** Supplier selection, disruption response, taste: judgment stays human. That discipline is the product.

## What runs in production

| Skill | What it does | In this repo? |
|---|---|---|
| [`youtube-transcript-fetch`](youtube-transcript-fetch/) | Turns any YouTube URL into a clean markdown transcript via a cache-first API strategy, routed into the research pipeline | Yes, full code |
| [`wiki-lint`](wiki-lint/) | Audits a Karpathy-style markdown knowledge wiki with a deterministic Python script (broken links, orphans, missing citations, ingest backlog), then layers agent judgment on what to fix next | Yes, full code |
| Post editors (LinkedIn / X) | Editorial pipelines with codified voice gates: a Receipt Test (no claim ships without a verifiable artifact), AI-tell scans (em-dashes, arrows, hedge words, banned vocabulary), and iteration caps. The agent drafts; the human picks survivors | Described only: the voice machinery is the business |
| Research ingest pipeline | Triages link batches against the business roadmap, routes learnings into the knowledge base, executes the resulting changes in-session | Described only |
| Trip operations skills | Itinerary assembly and QA, booking guardrails, destination intelligence | Private: production business logic |

The two utilities here are sanitized copies of real production files in daily use. Private paths, client details, and business data removed; structure, workflows, and quality bars unchanged.

## Why publish this

I write publicly about AI-native product work, including the rule that matters most: the most valuable product decisions are about what NOT to automate. This repo is part of the receipts behind that writing. More at [mihirparmar.ai](https://mihirparmar.ai).

## Author

**Mihir Parmar**
Principal Product Manager and AI Product Builder · Founder, En Route Luxe

- LinkedIn: [www.linkedin.com/in/mihir-r-parmar](https://www.linkedin.com/in/mihir-r-parmar)
- Site: [mihirparmar.ai](https://mihirparmar.ai)
