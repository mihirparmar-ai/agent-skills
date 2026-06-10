# How I built the knowledge base: a Karpathy-style LLM wiki in markdown

Andrej Karpathy has described the idea of knowledge bases built for LLMs to read: plain text, heavily linked, compiled from raw sources into distilled pages. This is my working implementation. It runs the research layer of a real business and has survived daily use.

## Why plain markdown in a git repo

Three constraints drove the design:

1. **Provider-agnostic.** The knowledge base is the asset; models are interchangeable. Any model that can read a git repo reads the same substrate. Claude Code writes to it. Other tools read it through their GitHub connectors. Nothing is locked inside a vendor's database.
2. **LLM-legible by default.** Markdown with frontmatter and wiki-links is the format models parse best. No export step, no API, no sync. The repo is the interface.
3. **One writer, many readers.** A single rule prevents knowledge-base rot: one tool owns writes (Claude Code, in session, with the rules loaded), everything else is read-only. Conclusions become files. Chat is ephemeral; the repo is permanent.

I retired a conventional note-taking app for this. The test that killed it: after weeks of dutiful filing, I never once went back to read a note. The replacement model is "I ask, AI finds." Notes exist for the agent to retrieve, not for me to browse.

## The structure

```
repo/
  raw/        source material: transcripts, articles, research dumps
  wiki/       distilled pages: one concept, entity, or decision per file
  outputs/    things produced from the wiki: briefs, posts, analyses
  AGENTS.md   the contract: what agents may read, write, and never touch
  CLAUDE.md   rules loaded into every session: voice, routing, quality bars
```

The flow is a compile loop:

1. **Ingest.** New material lands in `raw/` untouched: a transcript, an article, a research batch. Nothing is summarized at capture time. Raw stays raw.
2. **Compile.** A session distills raw material into `wiki/` pages: short, opinionated, one topic per file, every claim cited back to its raw source.
3. **Link.** Pages reference each other with `[[wiki-links]]`. A link to a page that does not exist yet is not an error; it is a marker for what to compile next.
4. **Lint.** A deterministic script audits the whole thing. The integrity rules are code, not vibes.

## Each wiki page carries frontmatter

```markdown
---
title: <topic>
type: concept | entity | decision | source
created: YYYY-MM-DD
sources: [raw/2026-05-12-interview.md]
---

Short, dense summary. Claims cite sources. Links to [[related-pages]].
```

The frontmatter is what makes the wiki queryable by script as well as by model. Type, date, and source coverage are checkable facts, not conventions.

## The linter is the load-bearing wall

The wiki stays healthy because a plain Python script (`wiki-lint`, included in this repo) enforces integrity on demand:

- broken `[[links]]` (target page missing)
- orphan pages (no inbound links: knowledge that fell off the graph)
- pages missing source citations (claims with no receipts)
- the ingest backlog (raw files not yet compiled into the wiki)
- index drift (pages missing from the index, or indexed pages that no longer exist)

The agent layers judgment on top of the report: which orphans matter, what to compile next, whether a summary is still accurate. But the facts come from code. This split, deterministic checks plus generative judgment, is the same pattern as everything else in the stack. Prompting a model to "check for broken links" is strictly worse than running a script that cannot hallucinate the answer.

The linter proposes fixes as a batched punch list and applies them after one confirmation. It never silently rewrites content. The human stays the editor.

## The contract: AGENTS.md

Every repo in the system carries an `AGENTS.md` file that tells any agent, from any provider, how to behave in that repo: what is canonical, what is generated, where new material goes, and what must never be modified. Agents change; the contract travels with the data.

## What this buys

- **Sessions start calibrated.** The rules, the voice, and the domain knowledge load from files. No re-explaining context.
- **Knowledge compounds.** Every research session leaves the wiki slightly better: a new page, a fixed link, a compiled backlog item.
- **The backlog is honest.** "What have I captured but not yet learned from?" is a lint check, not a feeling.
- **It survives tool churn.** If the agent tooling changes next year, the asset is still a folder of markdown.

## Author

**Mihir Parmar** · Principal Product Manager and AI Product Builder · Founder, En Route Luxe
[LinkedIn](https://www.linkedin.com/in/mihir-r-parmar) · [mihirparmar.ai](https://mihirparmar.ai)
