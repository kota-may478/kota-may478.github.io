#!/usr/bin/env python3
"""Aggregate places_change_log.json into a markdown table for the PR."""
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
log = json.loads((ROOT / "tools/places_change_log.json").read_text(encoding="utf-8"))

# Group by entry name
by_entry = defaultdict(lambda: {"jp": None, "en": None, "cv": None, "source": set()})

def slot(file: str) -> str:
    if file == "index.html":
        return "jp"
    if file == "index_en.html":
        return "en"
    if "presentation.tex" in file or "extracurricular.tex" in file:
        return "cv"
    return "other"

for row in log:
    e = row["entry"]
    s = slot(row["file"])
    if s == "other":
        continue
    prev = by_entry[e][s]
    cell = f"`{row['before']}` → `{row['after']}`"
    if prev:
        by_entry[e][s] = prev + "; " + cell
    else:
        by_entry[e][s] = cell
    by_entry[e]["source"].add(row["source"])

lines = [
    "| Entry | JP (before → after) | EN | CV | Source |",
    "| --- | --- | --- | --- | --- |",
]
for entry in sorted(by_entry.keys()):
    d = by_entry[entry]
    src = "; ".join(sorted(d["source"]))
    lines.append(
        f"| {entry} | {d['jp'] or '—'} | {d['en'] or '—'} | {d['cv'] or '—'} | {src} |"
    )

out = ROOT / "tools/places_table.md"
out.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(out)
