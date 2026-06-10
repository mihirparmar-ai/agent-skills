#!/usr/bin/env python3
"""
wiki_lint.py - deterministic integrity + ingest-backlog audit for a Karpathy-style
markdown wiki (raw/ -> AI-maintained wiki/ + CLAUDE.md schema).

This is the MECHANICAL pass only. The `wiki-lint` skill layers Claude's judgment on
top of this output (summary quality, missing entity/concept pages, which raw backlog
items to ingest next, stale facts). Pattern borrowed from macStories / John Voorhees:
a reliable deterministic script + a generative layer for what code can't judge.

Usage:
  python3 wiki_lint.py [--wiki PATH] [--raw PATH] [--required-fm type,tags,created,status]

Defaults to ./wiki and ./raw in the current directory. Prints a grouped report.
Always exits 0 (report, not a gate).
"""
import argparse, re, sys
from pathlib import Path

DEFAULT_WIKI = Path("wiki")
DEFAULT_RAW = Path("raw")
WIKILINK_RE = re.compile(r"\[\[([^\]]+)\]\]")
SOURCE_HINT_RE = re.compile(r"(raw/|https?://|[Ss]ource:|\]\(http)")
RAW_EXTS = (".md", ".txt", ".pdf", ".srt")
CODE_FENCE_RE = re.compile(r"```.*?```", re.DOTALL)
INLINE_CODE_RE = re.compile(r"`[^`]*`")


def strip_code(text):
    """Remove fenced + inline code so example links like `[[page-name]]` in prose aren't linted as real links."""
    return INLINE_CODE_RE.sub(" ", CODE_FENCE_RE.sub(" ", text))


def read(p):
    try:
        return p.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return ""


def has_frontmatter(text):
    return text.lstrip().startswith("---")


def frontmatter_keys(text):
    t = text.lstrip()
    if not t.startswith("---"):
        return set()
    end = t.find("\n---", 3)
    if end == -1:
        return set()
    return {ln.split(":")[0].strip() for ln in t[3:end].splitlines() if ":" in ln}


def variants(name):
    s = name.lower().strip()
    return {s, s.replace("-", " "), s.replace("_", " "), s.replace(" ", "-")} - {""}


def is_struct(p):
    return p.stem.lower() in ("_index", "index", "_log", "log", "claude")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--wiki", default=str(DEFAULT_WIKI))
    ap.add_argument("--raw", default=str(DEFAULT_RAW))
    ap.add_argument("--required-fm", default="type,tags,created,status")
    args = ap.parse_args()
    wiki, raw = Path(args.wiki), Path(args.raw)
    required_fm = [k.strip() for k in args.required_fm.split(",") if k.strip()]

    if not wiki.is_dir():
        print(f"ERROR: wiki dir not found: {wiki}")
        return 0

    md_files = sorted(wiki.rglob("*.md"))
    content_pages = [p for p in md_files if not is_struct(p)]
    texts = {p: read(p) for p in md_files}
    content_text = "\n".join(texts[p] for p in content_pages).lower()

    # resolvable page keys (stem variants) for link checking
    page_keys = set()
    for p in md_files:
        page_keys |= variants(p.stem)

    issues = {}

    # 1. index present + non-empty + lists every content page
    idx = next((p for p in md_files if p.stem.lower() in ("_index", "index")), None)
    idx_problems = []
    if idx is None:
        idx_problems.append("no _index.md found")
    elif not texts[idx].strip():
        idx_problems.append("_index.md is EMPTY (no page listing)")
    else:
        body = texts[idx].lower()
        listed = set()
        for v in WIKILINK_RE.findall(strip_code(texts[idx])):
            listed |= variants(v)
        for p in content_pages:
            if not (variants(p.stem) & listed) and p.stem.lower() not in body:
                idx_problems.append(f"not listed in index: {p.relative_to(wiki)}")
    issues["Index"] = idx_problems

    # 2. frontmatter present + required keys
    fm = []
    for p in content_pages:
        if not has_frontmatter(texts[p]):
            fm.append(f"missing frontmatter: {p.relative_to(wiki)}")
        else:
            miss = [k for k in required_fm if k not in frontmatter_keys(texts[p])]
            if miss:
                fm.append(f"missing fm keys [{','.join(miss)}]: {p.relative_to(wiki)}")
    issues["Frontmatter"] = fm

    # 3. broken wikilinks
    broken = []
    for p in md_files:
        for tgt in WIKILINK_RE.findall(strip_code(texts[p])):
            t = tgt.split("|")[0].split("#")[0].strip().lower()
            if not (variants(t) & page_keys):
                broken.append(f"[[{tgt}]] in {p.relative_to(wiki)}")
    issues["Broken wikilinks"] = broken

    # 4. orphan content pages (no inbound [[link]] from anywhere)
    linked = set()
    for t in texts.values():
        for tgt in WIKILINK_RE.findall(strip_code(t)):
            linked |= variants(tgt.split("|")[0].split("#")[0].strip())
    orphans = [
        f"orphan (no inbound [[link]]): {p.relative_to(wiki)}"
        for p in content_pages
        if not (variants(p.stem) & linked)
    ]
    issues["Orphans"] = orphans

    # 5. source citations (Aakash principle: every page cites sources)
    nocite = [
        f"no source citation: {p.relative_to(wiki)}"
        for p in content_pages
        if not SOURCE_HINT_RE.search(texts[p])
    ]
    issues["Missing source citations"] = nocite

    # 6. ingest backlog: raw files not referenced by any wiki CONTENT page
    raw_files, backlog = [], []
    if raw.is_dir():
        raw_files = [p for p in raw.rglob("*") if p.is_file() and p.suffix.lower() in RAW_EXTS]
        for p in raw_files:
            keys = variants(p.stem) | {str(p.relative_to(raw)).lower()}
            if not any(k in content_text for k in keys):
                backlog.append(f"not yet compiled into wiki: {p.relative_to(raw)}")
    issues["Ingest backlog (raw not in wiki)"] = backlog

    # 7. log freshness (informational)
    log = next((p for p in md_files if p.stem.lower() in ("_log", "log")), None)
    if log is None:
        log_note = ["no _log.md found"]
    else:
        dates = re.findall(r"##\s*(\d{4}-\d{2}-\d{2})", texts[log])
        log_note = [f"last log entry: {max(dates) if dates else 'none found'}"]
    issues["Log (info)"] = log_note

    # report
    print("# wiki-lint report")
    print(f"wiki: {wiki}")
    print(f"raw:  {raw}")
    n_content = len(content_pages)
    print(f"pages: {len(md_files)} md ({n_content} content) | raw files: {len(raw_files)}\n")
    total = 0
    for name, items in issues.items():
        info = name.endswith("(info)")
        if not info:
            total += len(items)
        marker = "INFO" if info else ("OK" if not items else str(len(items)))
        print(f"## {name} [{marker}]")
        for it in items:
            print(f"  - {it}")
        if not items:
            print("  (none)")
        print()
    print(f"TOTAL ISSUES: {total}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
