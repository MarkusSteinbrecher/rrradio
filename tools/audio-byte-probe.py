#!/usr/bin/env python3
"""
Byte-level stream probe.

This is a fast deterministic check for "does this URL return bytes that
look like audio or a playable playlist?" It does not prove browser
playback, but it catches the main false negative from fetch-only probes:
servers that do return audio bytes even when headers are odd.

Usage:
  python3 tools/audio-byte-probe.py '<stream-url>'
  python3 tools/audio-byte-probe.py --json '<stream-url>'
  python3 tools/audio-byte-probe.py --resolve-playlist '<playlist-url>'
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Optional


MAX_BYTES_DEFAULT = 256 * 1024
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


@dataclass
class ProbeResult:
    url: str
    final_url: str
    verdict: str
    ok: bool
    reason: str
    status: Optional[int] = None
    content_type: Optional[str] = None
    bytes_read: int = 0
    signature: Optional[str] = None
    elapsed_ms: int = 0
    resolved_from: Optional[str] = None


def make_request(url: str, icy: bool) -> urllib.request.Request:
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "*/*",
    }
    if icy:
        headers["Icy-MetaData"] = "1"
    return urllib.request.Request(url, headers=headers)


def read_prefix(url: str, timeout: float, max_bytes: int, icy: bool) -> tuple[int, str, str, bytes]:
    req = make_request(url, icy)
    with urllib.request.urlopen(req, timeout=timeout) as res:
        status = getattr(res, "status", 200) or 200
        final_url = res.geturl()
        content_type = res.headers.get("content-type") or ""
        chunks: list[bytes] = []
        total = 0
        while total < max_bytes:
            chunk = res.read(min(32768, max_bytes - total))
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
            sig = detect_signature(b"".join(chunks), final_url, content_type)
            if sig not in (None, "unknown"):
                break
        return status, final_url, content_type, b"".join(chunks)


def first_text(data: bytes) -> str:
    return data[:8192].decode("utf-8", errors="ignore").lstrip("\ufeff\r\n\t ")


def detect_signature(data: bytes, url: str, content_type: str) -> Optional[str]:
    if not data:
        return None

    sample = data[:4096]
    text = first_text(data)
    lower_ct = content_type.lower()
    path = urllib.parse.urlparse(url).path.lower()

    if path.endswith(".m3u8") or "mpegurl" in lower_ct:
        return "hls-playlist"
    if text.startswith("#EXTM3U"):
        return "hls-playlist" if "#EXT-X-" in text[:2048] else "m3u-playlist"
    if re.match(r"^\[playlist\]", text, re.I):
        return "pls-playlist"
    if text.startswith("<!doctype html") or text.startswith("<html") or "text/html" in lower_ct:
        return "html"

    if sample.startswith(b"ID3"):
        return "mp3-id3"
    if has_mp3_frame(sample):
        return "mp3-frame"
    if has_adts_frame(sample):
        return "aac-adts"
    if sample.startswith(b"OggS"):
        return "ogg"
    if sample.startswith(b"fLaC"):
        return "flac"
    if sample.startswith(b"RIFF") and sample[8:12] == b"WAVE":
        return "wav"
    if len(sample) >= 12 and sample[4:8] == b"ftyp":
        return "mp4-m4a"
    if sample.startswith(b"FLV"):
        return "flv"
    if lower_ct.startswith("audio/"):
        return "audio-content-type"
    if "application/octet-stream" in lower_ct:
        return "octet-stream-unknown"
    return "unknown"


def has_mp3_frame(data: bytes) -> bool:
    for i in range(0, min(len(data) - 1, 4096)):
        if data[i] == 0xFF and (data[i + 1] & 0xE0) == 0xE0:
            layer = (data[i + 1] >> 1) & 0x03
            if layer != 0:
                return True
    return False


def has_adts_frame(data: bytes) -> bool:
    for i in range(0, min(len(data) - 1, 4096)):
        if data[i] == 0xFF and (data[i + 1] & 0xF6) == 0xF0:
            return True
    return False


def playlist_url(data: bytes, base_url: str) -> Optional[str]:
    text = first_text(data)
    if text.startswith("#EXTM3U"):
        for line in text.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            return urllib.parse.urljoin(base_url, line)
    if re.match(r"^\[playlist\]", text, re.I):
        for line in text.splitlines():
            match = re.match(r"File\d+=(.+)", line.strip(), re.I)
            if match:
                return urllib.parse.urljoin(base_url, match.group(1).strip())
    return None


def classify(url: str, status: int, final_url: str, content_type: str, data: bytes) -> ProbeResult:
    sig = detect_signature(data, final_url, content_type)
    audio_sigs = {
        "mp3-id3",
        "mp3-frame",
        "aac-adts",
        "ogg",
        "flac",
        "wav",
        "mp4-m4a",
        "flv",
        "audio-content-type",
    }
    playlist_sigs = {"hls-playlist", "m3u-playlist", "pls-playlist"}

    if status >= 400:
        return ProbeResult(url, final_url, "http-error", False, f"HTTP {status}", status, content_type, len(data), sig)
    if sig in audio_sigs:
        return ProbeResult(url, final_url, "audio", True, f"received {sig} bytes", status, content_type, len(data), sig)
    if sig in playlist_sigs:
        ok = sig == "hls-playlist"
        verdict = "hls-playlist" if ok else "playlist"
        reason = "received HLS playlist" if ok else f"received {sig}; resolve before browser playback"
        return ProbeResult(url, final_url, verdict, ok, reason, status, content_type, len(data), sig)
    if sig == "html":
        return ProbeResult(url, final_url, "not-audio", False, "received HTML", status, content_type, len(data), sig)
    if sig == "octet-stream-unknown":
        return ProbeResult(url, final_url, "inconclusive", False, "octet-stream without a known audio signature", status, content_type, len(data), sig)
    return ProbeResult(url, final_url, "not-audio", False, f"unknown signature {sig or '<empty>'}", status, content_type, len(data), sig)


def probe(url: str, args: argparse.Namespace, resolved_from: Optional[str] = None) -> ProbeResult:
    started = time.monotonic()
    try:
        status, final_url, content_type, data = read_prefix(url, args.timeout, args.max_bytes, args.icy)
        result = classify(url, status, final_url, content_type, data)
        if args.resolve_playlist and result.verdict == "playlist":
            next_url = playlist_url(data, final_url)
            if next_url:
                return probe(next_url, args, resolved_from=final_url)
        result.resolved_from = resolved_from
        result.elapsed_ms = int((time.monotonic() - started) * 1000)
        return result
    except urllib.error.HTTPError as exc:
        data = exc.read(args.max_bytes)
        content_type = exc.headers.get("content-type") if exc.headers else ""
        result = classify(url, exc.code, exc.geturl(), content_type or "", data)
        result.resolved_from = resolved_from
        result.elapsed_ms = int((time.monotonic() - started) * 1000)
        return result
    except Exception as exc:
        return ProbeResult(
            url=url,
            final_url=url,
            verdict="network-error",
            ok=False,
            reason=str(exc)[:240],
            elapsed_ms=int((time.monotonic() - started) * 1000),
            resolved_from=resolved_from,
        )


def print_text(result: ProbeResult) -> None:
    head = "OK" if result.ok else "FAIL"
    print(f"{head:<5} {result.url}")
    print(f"      {result.verdict}: {result.reason}")
    print(
        f"      status={result.status or '-'} content-type={result.content_type or '-'} "
        f"bytes={result.bytes_read} signature={result.signature or '-'} elapsed={result.elapsed_ms}ms"
    )
    if result.final_url != result.url:
        print(f"      final-url={result.final_url}")
    if result.resolved_from:
        print(f"      resolved-from={result.resolved_from}")


def utc_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def candidate_key(candidate: dict) -> str:
    return f"{candidate.get('stationuuid', '')}\0{candidate.get('streamUrl') or ''}"


def is_unplayable_candidate(candidate: dict) -> bool:
    if candidate.get("matchedCatalogId") or candidate.get("duplicateOf"):
        return False
    verdict = candidate.get("verdict")
    return isinstance(verdict, str) and (
        verdict.startswith("broken") or verdict in ("redirect-downgrade", "needs-playlist")
    )


def result_to_record(candidate: dict, result: ProbeResult, probed_at: str) -> dict:
    return {
        "stationuuid": candidate.get("stationuuid"),
        "sourceId": candidate.get("sourceId") or "radio-browser",
        "name": candidate.get("name"),
        "country": candidate.get("country"),
        "streamUrl": candidate.get("streamUrl"),
        "streamHost": candidate.get("streamHost"),
        "homepage": candidate.get("homepage"),
        "fetchVerdict": candidate.get("verdict"),
        "rbCheckOk": candidate.get("rbCheckOk"),
        "byteVerdict": result.verdict,
        "byteOk": result.ok,
        "reason": result.reason,
        "status": result.status,
        "contentType": result.content_type,
        "bytesRead": result.bytes_read,
        "signature": result.signature,
        "elapsedMs": result.elapsed_ms,
        "finalUrl": result.final_url,
        "resolvedFrom": result.resolved_from,
        "probedAt": probed_at,
    }


def load_existing_records(path: Optional[str]) -> dict[str, dict]:
    if not path:
        return {}
    p = Path(path)
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text())
    except Exception:
        return {}
    records = data.get("results")
    if not isinstance(records, list):
        return {}
    out: dict[str, dict] = {}
    for record in records:
        if not isinstance(record, dict):
            continue
        key = f"{record.get('stationuuid', '')}\0{record.get('streamUrl') or ''}"
        out[key] = record
    return out


def write_batch_report(path: str, *, input_path: str, scope: str, results: list[dict]) -> None:
    by_verdict: dict[str, int] = {}
    ok_count = 0
    for record in results:
        verdict = str(record.get("byteVerdict") or "unknown")
        by_verdict[verdict] = by_verdict.get(verdict, 0) + 1
        if record.get("byteOk") is True:
            ok_count += 1
    report = {
        "generatedAt": utc_now(),
        "input": input_path,
        "scope": scope,
        "count": len(results),
        "okCount": ok_count,
        "byByteVerdict": dict(sorted(by_verdict.items())),
        "results": results,
    }
    Path(path).write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")


def probe_candidate(candidate: dict, args: argparse.Namespace) -> dict:
    probed_at = utc_now()
    stream_url = candidate.get("streamUrl")
    if not isinstance(stream_url, str) or not stream_url:
        result = ProbeResult(
            url="",
            final_url="",
            verdict="missing-url",
            ok=False,
            reason="candidate has no streamUrl",
        )
    else:
        result = probe(stream_url, args)
    return result_to_record(candidate, result, probed_at)


def run_candidates_batch(args: argparse.Namespace) -> int:
    if not args.output:
        raise SystemExit("--output is required with --from-candidates")
    data = json.loads(Path(args.from_candidates).read_text())
    raw_candidates = data.get("candidates")
    if not isinstance(raw_candidates, list):
        raise SystemExit(f"{args.from_candidates} does not contain a candidates array")

    candidates = [c for c in raw_candidates if isinstance(c, dict)]
    scope = "all"
    if args.only_unplayable:
        candidates = [c for c in candidates if is_unplayable_candidate(c)]
        scope = "unplayable"
    if args.limit is not None:
        candidates = candidates[:args.limit]
        scope = f"{scope}:limit-{args.limit}"

    existing = load_existing_records(args.output) if args.resume else {}
    results: list[Optional[dict]] = [None] * len(candidates)
    pending: list[tuple[int, dict]] = []
    for idx, candidate in enumerate(candidates):
        cached = existing.get(candidate_key(candidate))
        if cached:
            results[idx] = cached
        else:
            pending.append((idx, candidate))

    total = len(candidates)
    reused = total - len(pending)
    if reused:
        print(f"Reusing {reused} existing byte probes", file=sys.stderr)
    print(f"Probing {len(pending)} of {total} candidates", file=sys.stderr)

    completed = reused
    if pending:
        max_workers = max(1, args.concurrency)
        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {
                executor.submit(probe_candidate, candidate, args): idx
                for idx, candidate in pending
            }
            for future in concurrent.futures.as_completed(futures):
                idx = futures[future]
                try:
                    record = future.result()
                except Exception as exc:
                    candidate = candidates[idx]
                    record = result_to_record(
                        candidate,
                        ProbeResult(
                            url=str(candidate.get("streamUrl") or ""),
                            final_url=str(candidate.get("streamUrl") or ""),
                            verdict="probe-error",
                            ok=False,
                            reason=str(exc)[:240],
                        ),
                        utc_now(),
                    )
                results[idx] = record
                completed += 1
                if completed == total or completed % args.flush_every == 0:
                    compact = [r for r in results if r is not None]
                    write_batch_report(args.output, input_path=args.from_candidates, scope=scope, results=compact)
                    print(f"{completed}/{total} probed", file=sys.stderr)

    compact = [r for r in results if r is not None]
    write_batch_report(args.output, input_path=args.from_candidates, scope=scope, results=compact)
    print(f"Wrote {args.output} ({len(compact)} records)", file=sys.stderr)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Check whether URLs return audio-like bytes.")
    parser.add_argument("urls", nargs="*")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--icy", action="store_true", help="send Icy-MetaData: 1")
    parser.add_argument("--resolve-playlist", action="store_true", help="follow first stream URL in plain .m3u/.pls playlists")
    parser.add_argument("--timeout", type=float, default=15.0)
    parser.add_argument("--max-bytes", type=int, default=MAX_BYTES_DEFAULT)
    parser.add_argument("--from-candidates", help="read a public/sources/*-candidates.json file and probe candidate stream URLs")
    parser.add_argument("--only-unplayable", action="store_true", help="with --from-candidates, probe rows currently shown as unplayable")
    parser.add_argument("--output", help="write batch probe report JSON")
    parser.add_argument("--resume", action="store_true", help="reuse matching records from --output when it already exists")
    parser.add_argument("--limit", type=int, help="limit batch probes for a smoke run")
    parser.add_argument("--concurrency", type=int, default=1)
    parser.add_argument("--flush-every", type=int, default=100, help="write partial batch output every N completed probes")
    args = parser.parse_args()

    if args.from_candidates:
        return run_candidates_batch(args)
    if not args.urls:
        parser.error("provide at least one URL, or use --from-candidates")

    results = [probe(url, args) for url in args.urls]
    if args.json:
        print(json.dumps({"generatedAt": utc_now(), "results": [asdict(r) for r in results]}, indent=2))
    else:
        for result in results:
            print_text(result)
    return 0 if all(r.ok for r in results) else 2


if __name__ == "__main__":
    sys.exit(main())
