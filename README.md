# agent-skills

The AI operating stack behind [En Route Luxe](https://www.enrouteluxe.com), a luxury travel advisory I founded and run ($500K+ in annual bookings, grown entirely through repeat bookings and referrals). The business runs on a "virtual team" of Claude Code agents, custom skills, and a markdown knowledge base that I build and ship daily. This repo shares the architecture, two of the utilities in full, and the design of the knowledge base.

Also here: [How I built the knowledge base](knowledge-base.md). A Karpathy-style LLM wiki in plain markdown: raw sources in, distilled linked pages out, integrity enforced by a deterministic linter.

## The idea: the editor layer

Agents draft. The human reviews. Every skill in the stack follows the same pattern I shipped at enterprise scale (LLM document intelligence at Zillow: ~85% to 98%+ accuracy with human-in-the-loop review, 1M+ documents a year):

1. **Deterministic checks where possible.** If a rule can be a script, it is a script. Models handle judgment, not arithmetic.
2. **Guardrails before output.** Closure checks, transfer buffers, ticketing rules, and contingency paths for itineraries; receipt tests and AI-tell scans for content.
3. **Skills as packaged judgment.** Each skill encodes one job's trigger conditions, workflow, quality bars, and anti-patterns, so every future session starts calibrated.
4. **Knowing what NOT to automate.** Supplier selection, disruption response, taste: judgment stays human. That discipline is the product.

## The skills library

| Skill | Category / project | What it does |
|---|---|---|
| [`youtube-transcript-fetch`](youtube-transcript-fetch/) | Research · Personal OS | Turns any YouTube URL into a clean markdown transcript via a cache-first API strategy, routed into the research pipeline |
| [`wiki-lint`](wiki-lint/) | Knowledge base · Personal OS | Audits the markdown wiki with a deterministic Python script (broken links, orphans, missing citations, ingest backlog), then layers agent judgment on what to fix next |
| Research ingest pipeline | Research · Personal OS | Triages batches of links against the business roadmap, routes learnings into the right knowledge base, and executes the resulting changes in-session |
| Meeting sync | Operations · Personal OS | Pulls call transcripts, extracts action items, decisions, and people facts, and routes each to its home in the knowledge base |
| LinkedIn post editor | Content engine · Career + ERL | Full editorial pipeline: multiple hooks, codified voice gates, a Receipt Test (no claim ships without a verifiable artifact), AI-tell scans, and iteration caps. The agent drafts; the human picks survivors |
| X post editor | Content engine · Career + ERL | The same editorial discipline adapted to X mechanics: 280-character constraints, thread structure, source-reply patterns |
| Itinerary assembly + QA | Travel operations · En Route Luxe | Builds and stress-tests itineraries with automated guardrails: closure checks, transfer buffers, ticketing rules, timing constraints, contingency paths |
| Flight search MCP server | Travel data · En Route Luxe | Custom MCP server for flight search and date-grid pricing, callable by any agent in the stack |
| Destination intelligence | Travel data · En Route Luxe | Structured dataset of 190+ destinations (seasonality, fit signals, logistics) powering client research and the featured journeys on enrouteluxe.com |
| Deal finder + market screener | Analytics · Personal investing | Scours listing sites, scores candidates against a defined buybox, and outputs a ranked shortlist with reasons |
| Underwriting models (buy-hold and value-add) | Analytics · Personal investing | Conservative cash-flow and after-repair-value underwriting with walk-away math and sensitivity tables |
| Market ranking engine | Analytics · Personal investing | Scores 100+ markets on revenue, appreciation, regulation, and supply signals; includes 5-year return modeling |

The two linked skills ship in full as sanitized copies of real production files. The rest are described here and run privately: the voice machinery and travel operations are the business, and the analytics tooling is personal. Knowing what not to open-source is the same discipline as knowing what not to automate.

## Why publish this

I write publicly about AI-native product work, including the rule that matters most: the most valuable product decisions are about what NOT to automate. This repo is part of the receipts behind that writing. More at [mihirparmar.ai](https://mihirparmar.ai).

## Author

**Mihir Parmar**
Principal Product Manager and AI Product Builder · Founder, En Route Luxe

- LinkedIn: [www.linkedin.com/in/mihir-r-parmar](https://www.linkedin.com/in/mihir-r-parmar)
- Site: [mihirparmar.ai](https://mihirparmar.ai)
