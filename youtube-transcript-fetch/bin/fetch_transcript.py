#!/usr/bin/env python3
"""
fetch_transcript.py - Fetch YouTube transcripts via UseTranscribe.io API.

Uses only Python stdlib (no httpx/requests dependency) for max portability.

Usage:
  python fetch_transcript.py <url_or_video_id>
  python fetch_transcript.py <url_or_video_id> --json
  python fetch_transcript.py <url_or_video_id> --no-summary
  python fetch_transcript.py <url_or_video_id> --no-timestamps
  python fetch_transcript.py <url_or_video_id> --cache-only

Outputs:
  - Formatted transcript to stdout (default)
  - Progress messages to stderr
  - Exit code 0 on success, non-zero on error

Sister to: youtube-transcript-fetch SKILL.md (in parent directory)
"""

import sys
import json
import re
import argparse
import urllib.request
import urllib.parse
import urllib.error

BASE = "https://www.usetranscribe.io"
USER_AGENT = "youtube-transcript-fetch-skill/1.0 (Claude Code; for personal research triage)"


def extract_video_id(input_str: str) -> str:
    """Extract YouTube video ID from URL or return as-is if already an 11-char ID."""
    patterns = [
        r'youtube\.com/watch\?v=([A-Za-z0-9_-]{11})',
        r'youtu\.be/([A-Za-z0-9_-]{11})',
        r'youtube\.com/embed/([A-Za-z0-9_-]{11})',
        r'youtube\.com/v/([A-Za-z0-9_-]{11})',
        r'youtube\.com/shorts/([A-Za-z0-9_-]{11})',
    ]
    for pattern in patterns:
        m = re.search(pattern, input_str)
        if m:
            return m.group(1)
    if re.fullmatch(r'[A-Za-z0-9_-]{11}', input_str):
        return input_str
    raise ValueError(f"Could not extract YouTube video ID from: {input_str}")


def http_get(url: str, timeout: int = 30, stream: bool = False):
    """GET request with consistent User-Agent and error handling."""
    req = urllib.request.Request(url, headers={
        'User-Agent': USER_AGENT,
        'Accept': 'text/event-stream' if stream else 'application/json',
    })
    return urllib.request.urlopen(req, timeout=timeout)


def check_cache(video_id: str) -> bool:
    """Returns True if UseTranscribe already has this video cached."""
    url = f"{BASE}/api/check?platform=youtube&id={video_id}"
    with http_get(url, timeout=10) as resp:
        data = json.loads(resp.read().decode('utf-8'))
        return data.get('cached', False)


def fetch_cached(video_id: str) -> dict:
    """Fetch the cached transcript JSON for a video."""
    url = f"{BASE}/yt/{video_id}?format=json"
    with http_get(url, timeout=30) as resp:
        return json.loads(resp.read().decode('utf-8'))


def transcribe_fresh(youtube_url: str) -> dict:
    """
    Initiate fresh transcription via SSE stream. Returns the 'done' event payload.
    Blocks until transcription completes (~1 min per 15 min of source audio).
    """
    params = urllib.parse.urlencode({'url': youtube_url, 'summarize': '1'})
    url = f"{BASE}/transcribe?{params}"

    print("⏳ Initiating fresh transcription (allow ~1 min per 15 min of video)...", file=sys.stderr)

    last_event = None
    current_data_lines = []
    progress_count = 0

    with http_get(url, timeout=900, stream=True) as resp:
        for raw_line in resp:
            line = raw_line.decode('utf-8', errors='replace').rstrip('\r\n')

            if line.startswith('event:'):
                # Flush any accumulated data from previous event
                if last_event and current_data_lines:
                    data_str = '\n'.join(current_data_lines)
                    try:
                        payload = json.loads(data_str)
                    except json.JSONDecodeError:
                        payload = data_str

                    if last_event == 'done':
                        return payload
                    elif last_event == 'error':
                        err_code = payload.get('code', 'unknown') if isinstance(payload, dict) else 'unknown'
                        err_msg = payload.get('message', str(payload)) if isinstance(payload, dict) else str(payload)
                        raise RuntimeError(f"Transcription error [{err_code}]: {err_msg}")
                    elif last_event == 'progress':
                        progress_count += 1
                        msg = payload.get('message', '') if isinstance(payload, dict) else str(payload)
                        if msg:
                            print(f"  → {msg}", file=sys.stderr)
                        elif progress_count % 10 == 0:
                            print(f"  → still working... ({progress_count} progress events)", file=sys.stderr)

                last_event = line[len('event:'):].strip()
                current_data_lines = []
            elif line.startswith('data:'):
                current_data_lines.append(line[len('data:'):].lstrip())
            elif line == '':
                # Empty line marks end of event block per SSE spec - handled on next event
                pass

    # Handle case where stream ended on a final event without trailing event marker
    if last_event == 'done' and current_data_lines:
        try:
            return json.loads('\n'.join(current_data_lines))
        except json.JSONDecodeError:
            pass

    raise RuntimeError("SSE stream ended without a 'done' event")


def normalize_data(data: dict) -> dict:
    """
    Normalize the two possible response shapes (cached vs fresh) into one.
    Returns dict with: segments, summary, language, metadata.
    """
    if 'transcript' in data and isinstance(data['transcript'], dict):
        # Cached format
        transcript_obj = data['transcript']
        return {
            'segments': transcript_obj.get('segments', []),
            'language': transcript_obj.get('language', 'unknown'),
            'summary': data.get('summary', ''),
            'metadata': data.get('metadata', {}),
        }
    else:
        # Fresh SSE done format
        return {
            'segments': data.get('segments', []),
            'language': data.get('language', 'unknown'),
            'summary': data.get('summary_md', data.get('summary', '')),
            'metadata': data.get('metadata', {}),
        }


def format_output(data: dict, include_summary: bool = True, include_timestamps: bool = True) -> str:
    """Format the transcript data for human/agent reading."""
    normalized = normalize_data(data)
    segments = normalized['segments']
    summary = normalized['summary']
    language = normalized['language']
    metadata = normalized['metadata']

    title = metadata.get('title', 'Unknown title')
    duration = metadata.get('duration_seconds', 0)
    channel = metadata.get('channel_name') or metadata.get('uploader') or ''

    out = []
    out.append(f"# {title}")
    out.append("")
    if channel:
        out.append(f"**Channel:** {channel}")
    out.append(f"**Duration:** {duration // 60} min {duration % 60} sec")
    out.append(f"**Language:** {language}")
    out.append("")

    if include_summary and summary:
        out.append("## Summary")
        out.append("")
        out.append(summary)
        out.append("")
        out.append("---")
        out.append("")

    out.append("## Transcript")
    out.append("")

    for seg in segments:
        start = seg.get('start', 0)
        text = seg.get('text', '').strip()
        if not text:
            continue
        if include_timestamps:
            mins = int(start) // 60
            secs = int(start) % 60
            out.append(f"[{mins}:{secs:02d}] {text}")
        else:
            out.append(text)

    return '\n'.join(out)


def main():
    parser = argparse.ArgumentParser(
        description='Fetch YouTube transcripts via UseTranscribe.io API.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument('input', help='YouTube URL or 11-character video ID')
    parser.add_argument('--json', action='store_true', help='Output raw API JSON (debug / programmatic)')
    parser.add_argument('--no-summary', action='store_true', help='Skip summary section in formatted output')
    parser.add_argument('--no-timestamps', action='store_true', help='Skip [M:SS] timestamps in transcript')
    parser.add_argument('--cache-only', action='store_true', help='Only fetch if already cached; do not initiate fresh transcription')
    args = parser.parse_args()

    try:
        video_id = extract_video_id(args.input)
    except ValueError as e:
        print(f"❌ {e}", file=sys.stderr)
        sys.exit(2)

    print(f"🔍 Checking cache for video {video_id}...", file=sys.stderr)

    try:
        cached = check_cache(video_id)
    except urllib.error.HTTPError as e:
        print(f"❌ Cache check failed: HTTP {e.code} {e.reason}", file=sys.stderr)
        sys.exit(3)
    except urllib.error.URLError as e:
        print(f"❌ Network error during cache check: {e.reason}", file=sys.stderr)
        sys.exit(3)

    if cached:
        print("✅ Cached. Fetching transcript...", file=sys.stderr)
        try:
            data = fetch_cached(video_id)
        except urllib.error.HTTPError as e:
            print(f"❌ Cached fetch failed: HTTP {e.code} {e.reason}", file=sys.stderr)
            sys.exit(4)
    else:
        if args.cache_only:
            print(
                f"❌ Not cached and --cache-only specified.\n"
                f"   To cache, visit: https://www.usetranscribe.io/?url=https://www.youtube.com/watch?v={video_id}\n"
                f"   Then retry without --cache-only.",
                file=sys.stderr,
            )
            sys.exit(5)

        youtube_url = args.input if 'http' in args.input else f"https://www.youtube.com/watch?v={video_id}"

        try:
            data = transcribe_fresh(youtube_url)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                print("❌ Rate limit hit (50/day per IP). Try again tomorrow or paste transcript manually.", file=sys.stderr)
            else:
                print(f"❌ Transcription failed: HTTP {e.code} {e.reason}", file=sys.stderr)
            sys.exit(6)
        except urllib.error.URLError as e:
            print(f"❌ Network error during transcription: {e.reason}", file=sys.stderr)
            sys.exit(6)
        except RuntimeError as e:
            print(f"❌ {e}", file=sys.stderr)
            sys.exit(7)

    if args.json:
        print(json.dumps(data, indent=2))
    else:
        print(format_output(
            data,
            include_summary=not args.no_summary,
            include_timestamps=not args.no_timestamps,
        ))


if __name__ == '__main__':
    main()
