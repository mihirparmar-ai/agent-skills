---
name: youtube-transcript-fetch
description: Use this skill whenever a YouTube URL appears in research input or the user asks to fetch, transcribe, ingest, or get a transcript from a YouTube video. Triggers on phrases like "transcribe this YouTube video", "get the transcript for [URL]", "ingest this video", "fetch the transcript", "what does this video say", or implicitly when youtube.com/watch URLs, youtu.be URLs, or YouTube Shorts URLs appear in research-triage flow. Auto-fetches transcripts via UseTranscribe.io's free API (cached endpoint when available, SSE-streamed fresh transcription when not). Handles up to 90-min videos. Don't use for non-YouTube video sources (Vimeo, Twitter video, podcast platforms - fall back to manual paste), videos > 90 min (API limit; manual paste), or when the user has already pasted the transcript content directly.
---

# YouTube Transcript Fetch

Turns any YouTube URL into a clean markdown transcript the agent can ingest, using a free public transcription API with a cache-first strategy. It exists because video became a primary research input and manual transcript copy-paste was the bottleneck in the research-triage pipeline. The interesting part is the operational discipline around the fetch: check the cache before the expensive call, follow an explicit error taxonomy, and route every transcript to a permanent file instead of leaving it in chat context.

## When this skill fires

Auto-fire conditions:
1. A YouTube URL appears in user input as part of a research-triage flow (e.g., "Research: [URL]")
2. User explicitly asks: "transcribe this video," "get the transcript," "ingest this YouTube," "fetch [URL]," "what does this video say"
3. YouTube URL appears anywhere AND the conversation context is research / ingestion / learning

Don't fire when:
- User has already pasted the transcript content
- URL is non-YouTube (Vimeo, Twitter, podcast)
- Video is clearly > 90 min (API limit; ask user to paste relevant section)
- User explicitly says "don't transcribe, I'll watch"

## What the skill does (core workflow)

1. **Extract video ID** from any YouTube URL format (watch, youtu.be, shorts, embed)
2. **Check UseTranscribe cache** via `GET /api/check?platform=youtube&id={video_id}` (1 second)
3. **If cached:** fetch via `GET /yt/{video_id}?format=json` - instant
4. **If not cached:** initiate fresh transcription via `GET /transcribe?url={URL}&summarize=1` - SSE stream, ~1 min per 15 min of video
5. **Return formatted transcript** to Claude (markdown with header + summary + segments)
6. **Continue research-triage** workflow with the transcript content

## How to invoke (Bash call pattern)

```bash
python3 ~/.claude/skills/youtube-transcript-fetch/bin/fetch_transcript.py <URL_OR_ID>
```

Options:
- `--json` - raw API JSON (for programmatic use / debugging)
- `--no-summary` - skip the summary section in output
- `--no-timestamps` - skip the [M:SS] timestamps before each segment (cleaner for AI ingestion)
- `--cache-only` - only fetch if already cached; do NOT initiate fresh transcription (fast path)

Output goes to stdout. Progress messages to stderr. Exit code 0 on success.

Recommended default invocation for research triage:

```bash
python3 ~/.claude/skills/youtube-transcript-fetch/bin/fetch_transcript.py "https://www.youtube.com/watch?v=VIDEO_ID" --no-timestamps
```

## Routing the transcript (which workstream)

After fetching, route the transcript content into the right research-batch file based on the topic of the video and the workstream the user flagged. Example routing scheme (adapt the paths to your own vault layout):

| Workstream signal | Batch file location (example) |
|---|---|
| Career / job-search content | `~/notes/career/research-batches/YYYY-MM-DD-<topic>.md` |
| AI / PM / general builder content (cross-workstream) | `~/notes/ai/research-batches/YYYY-MM-DD-<topic>.md` |
| Business-specific content (industry intel, peer content) | `~/notes/business/raw/clipped-articles/YYYY-MM-DD-<topic>.md` |

Default if workstream unclear: ask the user.

In the batch file always include:
- Source video URL, title, channel, duration (from transcript metadata header)
- Deep extraction (key insights, quotable lines, action items)
- Routing of durable insights to appropriate memory files
- New action items added to your action-items file (e.g., `ACTION_ITEMS.md`) per priority criteria

## Error handling

| Error | Cause | What to do |
|---|---|---|
| Rate limit (HTTP 429) | Hit daily quota (50 transcribes/day per IP) | Tell the user; fall back to manual paste; revisit tomorrow |
| Too long (`too_long`) | Video > 90 min | Tell the user; ask for manual paste of relevant section or specific timestamps |
| Unsupported URL (`unsupported_url`) | Not a valid YouTube URL | Tell the user; verify URL is YouTube |
| Auth required (`auth_required`) | Video is private or members-only | Tell the user; can't fetch; manual workaround needed |
| Service down (timeout, 5xx) | UseTranscribe is down | Fall back to manual paste; document outage in your action-items file if it happens repeatedly |

Per UseTranscribe docs: "Don't retry on `too_long`, `unsupported_url`, or `auth_required` - these won't change."

## Performance expectations

- **Cached fetch:** < 2 seconds total (cache check + fetch)
- **Fresh transcription:** ~1 minute per 15 minutes of source video (so a 30-min video = ~2 min wait, 90-min video = ~6 min wait)
- **Cache hit rate:** Lower for niche/new videos. Higher for popular content. Don't assume cache.

## Output format (default)

```
# {Video Title}

**Channel:** {Channel Name}
**Duration:** {N} min {N} sec
**Language:** {ISO code}

## Summary

{Auto-generated summary from UseTranscribe}

---

## Transcript

[0:00] First segment text...
[0:05] Second segment text...
[0:12] ...
```

With `--no-timestamps`: same header, transcript lines without `[M:SS]` prefix.

## Related skills

- **`linkedin-post-editor`** - when transcript reveals quotable content worth saving as ammunition for future LinkedIn posts
- **`x-post-editor`** - same for X threads
- **Research-triage workflow** (no formal skill yet) - see your action-items file + workstream-specific research-batch files for the pattern

## Anti-patterns - DO NOT DO

1. **Don't auto-fetch when user has already pasted content.** Wastes time + duplicates work.
2. **Don't trigger fresh transcription for videos > 90 min.** Skill will error; pre-empt by asking user for specific section.
3. **Don't skip the routing step.** Transcript content is useless if it doesn't land in the right research-batch file for the right workstream.
4. **Don't paste the full raw transcript into a chat message if it's > 500 lines.** Summarize for chat; save full transcript to the batch file. The user doesn't need to re-read the whole thing.
5. **Don't retry on `too_long` / `unsupported_url` / `auth_required` errors.** They won't change. Surface the limitation to the user.
6. **Don't use UseTranscribe for sensitive videos.** It's a public service that caches transcripts globally. For private/sensitive content, fall back to manual paste.

## Operating rules

- **Cache check is free; always check first.** Saves 1-6 minutes per cached video.
- **Surface the cache status to the user** - "cached, fetching now" vs "not cached, transcribing fresh (~2 min)" - sets expectation.
- **Long fresh transcriptions: run in background.** Use `run_in_background: true` so the user isn't blocked. Continue with other triage work while it runs.
- **Save the transcript text** to the research-batch file IMMEDIATELY when received. Don't just hold it in chat context - chat history is ephemeral, the batch file is permanent.
- **Document the routing decision in the batch file.** Future readers (the user, future Claude) should be able to see WHY a video landed in workstream X vs Y.

## Upgrade path (when this skill outgrows itself)

Build a proper MCP server IF/WHEN:
- Volume exceeds 10+ YouTube transcripts/day sustained for 2+ weeks
- Multiple Claude clients need transcript access (e.g., ChatGPT + Claude Code)
- UseTranscribe becomes unreliable and we need multi-provider failover

Until then, this skill + Python helper is sufficient.

## When NOT to use this skill

- **Non-YouTube sources** (Vimeo, Twitter video, podcasts) → manual paste of transcript content
- **Videos > 90 min** → ask the user for relevant section or specific timestamps to focus on
- **Private / authenticated videos** → can't fetch; manual workaround needed
- **User has already pasted the content** → don't re-fetch; just process what's given
- **Quick reply to "what's this video about"** without need for full transcript → just describe based on title/context

## Reference

- **UseTranscribe.io:** https://www.usetranscribe.io/
- **API docs:** https://www.usetranscribe.io/AGENTS.md
- **Built by:** Hobby project. No SLA. Free with rate limits (50 transcribes/day per IP).
- **Service health:** If transcripts start failing repeatedly, document it in your action-items file and consider a multi-provider strategy.
