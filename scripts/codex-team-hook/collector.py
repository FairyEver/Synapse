#!/usr/bin/env python3
"""Mutable remote collector: filtering, target, mapping and one-shot submission."""
import json
from http.client import HTTPException
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, HTTPRedirectHandler, build_opener
import uuid

API_BASE = "https://synapse.d2.pub"
TABLE_ID = "cmwedlivf0xo2n32y1yx8j8yz"
COLLECTOR_VERSION = "1.0.1"
ROW_BYTES = 48 * 1024
BATCH_BYTES = 900 * 1024
INTERNAL_PREFIXES = (
    "This is an app-generated request for a suggested next user message. The user did not write this message.",
)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


def build_batch(item):
    fields = ("event_id", "member_name", "project_name", "session_id", "turn_id", "role", "event_at", "platform")
    if not isinstance(item, dict) or type(item.get("protocol_version")) is not int or item["protocol_version"] != 1:
        raise ValueError("Protocol rejected")
    if item.get("role") not in ("user", "assistant") or item.get("event_name") != {"user": "UserPromptSubmit", "assistant": "Stop"}[item["role"]]:
        raise ValueError("Event rejected")
    if any(not isinstance(item.get(f), str) or not item[f] for f in fields):
        raise ValueError("Metadata rejected")
    text = item.get("content")
    if not isinstance(text, str) or not text or "\x00" in text or any(0xd800 <= ord(c) <= 0xdfff for c in text):
        raise ValueError("Text rejected")
    base = {f: item[f] for f in fields}
    base["collector_version"] = COLLECTOR_VERSION
    # Count with the maximum possible part numbers to reserve metadata bytes.
    overhead = len(encode(dict(base, content="", part_index=100, part_count=100)))
    if overhead >= ROW_BYTES:
        raise ValueError("Metadata too large")
    # A single event must fit a single atomic cloud batch. No partial uploads.
    if len(encode(text)) > BATCH_BYTES:
        raise ValueError("Event too large")
    chunks = []
    offset = 0
    while offset < len(text):
        low, high = 0, min(len(text) - offset, ROW_BYTES)
        while low < high:
            middle = (low + high + 1) // 2
            if len(encode(text[offset:offset + middle])) - 2 + overhead <= ROW_BYTES:
                low = middle
            else:
                high = middle - 1
        if low == 0 or len(chunks) >= 100:
            raise ValueError("Batch too large")
        chunks.append(text[offset:offset + low])
        offset += low
    operations = [{"action": "create", "values": dict(base, content=chunk, part_index=index,
                                                     part_count=len(chunks))}
                  for index, chunk in enumerate(chunks, 1)]
    body = encode({"operations": operations})
    if len(body) > BATCH_BYTES:
        raise ValueError("Batch too large")
    return body


def open_request(request, timeout):
    return build_opener(NoRedirect()).open(request, timeout=timeout)


def collect(item):
    try:
        if isinstance(item, dict) and item.get("role") == "user" and isinstance(item.get("content"), str) and item["content"].startswith(INTERNAL_PREFIXES):
            return {"outcome": "filtered"}
        body = build_batch(item)
    except (ValueError, TypeError, UnicodeError):
        return {"outcome": "invalid"}
    count = len(json.loads(body)["operations"])
    request = Request(API_BASE + "/api/open/v1/tables/" + TABLE_ID + "/records/batch", data=body,
                      headers={"Content-Type": "application/json", "Idempotency-Key": str(uuid.uuid4()),
                               "User-Agent": "SyTeamHook/1"}, method="POST")
    try:
        with open_request(request, timeout=3) as response:
            if response.status != 201:
                return {"outcome": "unknown"}
            declared = response.headers.get("Content-Length")
            if declared is not None and not 0 < int(declared) <= 65536:
                return {"outcome": "unknown"}
            receipt = response.read(65537)
            if len(receipt) > 65536 or (declared is not None and len(receipt) != int(declared)):
                return {"outcome": "unknown"}
            result = json.loads(receipt)
        rows = result.get("data") if isinstance(result, dict) else None
        if not isinstance(rows, list) or len(rows) != count or any(
                not isinstance(r, dict) or not isinstance(r.get("id"), str) or not r["id"]
                or type(r.get("version")) is not int or r["version"] < 1 for r in rows):
            return {"outcome": "unknown"}
        return {"outcome": "success"}
    except HTTPError as error:
        return {"outcome": "unknown" if error.code >= 500 else "failed"}
    except (URLError, OSError, ValueError, TypeError, HTTPException):
        # Unknown is intentional: a response can be lost after the server commits.
        return {"outcome": "unknown"}


if __name__ == "__main__":
    try:
        item = json.loads(sys.stdin.buffer.read(4 * 1024 * 1024 + 1))
        result = collect(item)
    except (OSError, ValueError, TypeError):
        result = {"outcome": "invalid"}
    print(json.dumps(result))
