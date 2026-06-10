---
name: wiki-lint
description: Use whenever the user wants to audit, lint, health-check, or assess the integrity of a Karpathy-style markdown wiki (any `wiki/` + `raw/` + CLAUDE.md vault). Triggers on "lint the wiki", "audit the wiki", "check my wiki", "is my wiki healthy", "what's in my ingest backlog", "what haven't I compiled yet", "check for broken links / orphans", "wiki integrity", or before/after a wiki work session. Runs the deterministic `wiki_lint.py` script (frontmatter, broken `[[links]]`, orphans, source citations, ingest backlog, index/log) and layers Claude's judgment (summary quality, missing entity/concept pages, what to ingest next). Proposes fixes; never silently rewrites content. Don't use for drafting wiki content (that's the ingest/compile flow) or for non-wiki markdown.
---

# Wiki Lint

Audits the health of a Karpathy-style second brain: a `raw/` source dump that gets compiled into an AI-maintained `wiki/` with a `CLAUDE.md` schema. A deterministic Python script handles the mechanical checks (broken links, orphan pages, missing citations, ingest backlog); the agent layers judgment on top (what to compile next, which pages are thin). It exists because a knowledge pipeline with ingest but no audit step silently rots.

**Architecture (macStories / John Voorhees pattern):** a reliable *deterministic* script does the mechanical checks; you layer *generative* judgment on top for what code can't assess. Don't re-implement the mechanical checks in prose - run the script.

## When this fires

- The user asks to lint / audit / health-check the wiki, or asks "what's in my ingest backlog."
- Naturally at the start or end of a wiki work session (audit → fix → ingest).

## When NOT to use

- Drafting or compiling new wiki content → that's the ingest/compile flow (a separate link-ingestion skill, not included in this repo).
- Non-wiki markdown, or a one-off "is this one file ok" → just look at it.

## How it works - two passes

### Pass 1 - Deterministic (run the script)
```
python3 scripts/wiki_lint.py --wiki <path-to-wiki> --raw <path-to-raw>
```
The script lives in this skill's `scripts/` directory. Flags: `--wiki PATH`, `--raw PATH`, `--required-fm type,tags,created,status`. It reports seven groups: **Index** (present + non-empty + lists every content page), **Frontmatter** (required keys per the wiki's frontmatter discipline), **Broken wikilinks**, **Orphans** (no inbound `[[link]]`), **Missing source citations** (every page cites sources), **Ingest backlog** (raw files not yet compiled into a wiki content page), **Log** (freshness). Always exits 0 - it's a report.

### Pass 2 - Judgment (you add this)
Read the script output, then add what code can't judge:
- **Ingest backlog → prioritize.** Don't just list it - recommend the 1-3 highest-value raw items to compile next, by relevance (active work > evergreen research > stale). Flag anything clearly low-value to skip.
- **Summary / page quality.** Open flagged pages; assess whether summaries are thin, whether entity/concept pages are missing, whether cross-references (`[[links]]`) should exist but don't.
- **Stale facts.** Note pages whose `created`/content looks outdated vs. newer raw sources.

## Turn findings into a punch list

| Finding | Fix class | Action |
|---|---|---|
| Empty/stale `_index.md`; pages not listed | **Auto-fixable (confirm first)** | Propose the index entries; write on the user's OK. |
| Missing frontmatter / keys | **Auto-fixable (confirm first)** | Propose `type/tags/created/status` values from the page; write on OK. |
| Broken `[[wikilink]]` | **Auto-fixable (confirm first)** | Repoint to the right page, or create the missing stub, or remove - propose which. |
| Orphan page | **Judgment** | Suggest where to link it from (usually the index or a concept page). |
| Missing source citation | **Auto-fixable (confirm first)** | Find the real source (check `_log.md` + `raw/`) and propose a `Source:` line - don't fabricate one. |
| Ingest backlog item | **Surface / route** | Recommend next-to-compile; the actual compile is a separate step. Never bulk-auto-ingest. |
| Thin summary / missing entity page | **Surface** | Propose the page/edit; the user's call. |

## Guardrails

- **Propose, don't silently rewrite.** This skill audits and fixes *mechanical* issues on confirmation. It does not rewrite wiki *content/prose* on its own - that's the user's (or the compile flow's) judgment.
- **Never fabricate a source citation.** If you can't find the real source in `_log.md`/`raw/`, flag it as "source unknown - user to confirm," don't invent one.
- **Respect conventions:** `[[wikilinks]]`, frontmatter keys (`type/tags/created/status`), append-only `_log.md` (`## YYYY-MM-DD - title`).
- **Batch fixes; one confirmation.** Group the auto-fixable items and confirm once, don't drip per-file. Decisive recommendations beat option menus.
- **Log it.** After applying fixes, append one entry to `wiki/_log.md`.
- **Don't over-build.** At small wiki sizes most groups will be "OK"; the backlog + frontmatter are the live signals. Don't manufacture work.

## Output format

```
Wiki lint - <wiki path>, <N> pages, <M> raw files

Deterministic (script): <TOTAL> issues
  Index: …  Frontmatter: …  Broken links: …  Orphans: …  Citations: …  Backlog: <N>

Judgment:
  - Compile next (ranked): 1) <raw item> - why  2) … 
  - Quality/structure: <missing entity pages, thin summaries, …>

Fix now (auto, on your OK): <grouped list>
Surface (your call): <list>
```

## Related

- **Ingest workflow** - a separate skill (not included in this repo) compiles URL sources into `raw/`; wiki-lint audits the back of that pipeline.
- **Method sources:** the Karpathy "append-and-review / second brain" pattern, Aakash Gupta's every-page-cites-sources principle, and the macStories deterministic-script-plus-judgment pattern.
- **Script:** `scripts/wiki_lint.py` (in this skill directory).
