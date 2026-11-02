#!/usr/bin/env python3
"""Apply City, Country place format across JP/EN/CV. Writes change log."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path("/workspace")
LOG: list[dict] = []


def sub(path: Path, old: str, new: str, entry: str, source: str) -> None:
    text = path.read_text(encoding="utf-8")
    if old not in text:
        return
    path.write_text(text.replace(old, new), encoding="utf-8")
    LOG.append(
        {
            "entry": entry,
            "file": str(path.relative_to(ROOT)),
            "before": old,
            "after": new,
            "source": source,
        }
    )


def main() -> None:
    jp = ROOT / "index.html"
    en = ROOT / "index_en.html"
    cv = ROOT / "pdf/workspace/tex/cv/presentation.tex"
    ex = ROOT / "pdf/workspace/tex/cv/extracurricular.tex"

    # --- JP domestic achievements (、 separator) ---
    for old, new, entry, src in [
        ("，東京，", "，東京、日本，", "IEEJ IIC/MEC (Tokyo meetings)", "IEEJ technical meetings held in Tokyo (venue city)"),
        ("，大分，", "，大分、日本，", "65th Aerospace Propulsion and Power", "Conference city Oita"),
        ("，水戸，", "，水戸、日本，", "JIASC 2024", "https://gakkai-web.net/jiasc/program/hp24/ (Mito)"),
        ("，長崎，", "，福江、日本，", "PE/PSE/SPC 2024 (PE-24-059…)", "https://workshop.iee.or.jp/…/SBW00008F20 (Fukue Bunka Kaikan)"),
        ("，沖縄，", "，名護、日本，", "PE/PSE/SPC 2023", "https://workshop.iee.or.jp/…/SBW000085C5 (Nago)"),
        ("，長岡，", "，長岡、日本，", "JIASC 2021", "https://gakkai-web.net/jiasc/program/hp21/ (Nagaoka)"),
    ]:
        sub(jp, old, new, entry, src)

    # --- EN domestic achievements ---
    for old, new, entry, src in [
        ("Ibaraki, Japan", "Mito, Japan", "JIASC 2024", "https://gakkai-web.net/jiasc/program/hp24/"),
        ("Niigata, Japan", "Nagaoka, Japan", "JIASC 2021", "https://gakkai-web.net/jiasc/program/hp21/"),
        ("Okinawa, Japan", "Nago, Japan", "PE/PSE/SPC 2023", "IEEJ workshop program SBW000085C5"),
        ("Nagasaki, Japan", "Fukue, Japan", "PE/PSE/SPC 2024", "IEEJ workshop program SBW00008F20"),
    ]:
        sub(en, old, new, entry, src)
        sub(cv, old, new, entry, src)

    # --- Intl conf: prefecture/state → city (EN/JP/CV) ---
    for old, new, entry, src in [
        ("Shimane, Japan", "Matsue, Japan", "SAMCON 2025", "http://www2.iee.or.jp/~diic/samcon/2025/ (Matsue)"),
        ("Singapore, Oct. 2023", "Singapore, Singapore, Oct. 2023", "IECON 2023 (CV pres snippet)", "City-state"),
        ("Singapore, 2023年10月", "Singapore, Singapore, 2023年10月", "IECON 2023 (JP)", "City-state"),
        ("Singapore, Oct. 2023, doi", "Singapore, Singapore, Oct. 2023, doi", "IECON 2023 (EN/CV pubs)", "City-state"),
        ("Singapore, 2023年10月, doi", "Singapore, Singapore, 2023年10月, doi", "IECON 2023 (JP pubs)", "City-state"),
    ]:
        for path in (en, jp, cv):
            sub(path, old, new, entry, src)

    # ISARC 2026 — add city
    isarc_old = "pp. 810-817, 2026年6月, doi"
    isarc_new = "pp. 810-817, Singapore, 2026年6月, doi"
    sub(jp, isarc_old, isarc_new, "ISARC 2026", "https://www.iaarc.org/isarc-2026/conference-venue2026")
    isarc_en_old = "pp. 810-817, Jun. 2026, doi"
    isarc_en_new = "pp. 810-817, Singapore, Jun. 2026, doi"
    sub(en, isarc_en_old, isarc_en_new, "ISARC 2026", "https://www.iaarc.org/isarc-2026/conference-venue2026")
    sub(
        cv,
        "pp. 810-817, Jun. 2026, doi",
        "pp. 810-817, Singapore, Jun. 2026, doi",
        "ISARC 2026",
        "https://www.iaarc.org/isarc-2026/conference-venue2026",
    )

    # --- JP presentations (insert places) ---
    jp_pres = [
        (
            "（MEC），2024年9月.",
            "（MEC），東京、日本，2024年9月.",
            "Presentation MEC Sep 2024",
            "Tokyo IEEJ meeting",
        ),
        (
            "（JIASC），2024年8月.",
            "（JIASC），水戸、日本，2024年8月.",
            "Presentation JIASC Aug 2024",
            "JIASC 2024 Mito",
        ),
        (
            "（PE/PSE/SPC），2024年3月.",
            "（PE/PSE/SPC），福江、日本，2024年3月.",
            "Presentation PE/PSE/SPC Mar 2024",
            "Fukue workshop 2024",
        ),
        (
            "（MEC），2023年9月.",
            "（MEC），東京、日本，2023年9月.",
            "Presentation MEC Sep 2023",
            "Tokyo IEEJ meeting",
        ),
        (
            "（PE/PSE/SPC），2023年3月.",
            "（PE/PSE/SPC），名護、日本，2023年3月.",
            "Presentation PE/PSE/SPC Mar 2023",
            "Nago workshop 2023",
        ),
        (
            "（JIASC），2021年8月.",
            "（JIASC），長岡、日本，2021年8月.",
            "Presentation JIASC Aug 2021",
            "JIASC 2021 Nagaoka",
        ),
    ]
    for old, new, entry, src in jp_pres:
        sub(jp, old, new, entry, src)

    # --- EN presentations ---
    en_pres = [
        (
            "(SAMCON)</i>, Mar. 2026.",
            "(SAMCON)</i>, Daegu, Korea, Mar. 2026.",
            "Presentation SAMCON Mar 2026",
            "Same as intl conf entries",
        ),
        (
            "(AIM)</i>, Jul. 2025.",
            "(AIM)</i>, Hangzhou, China, Jul. 2025.",
            "Presentation AIM Jul 2025",
            "https://www.aim2025.org/",
        ),
        (
            "(SAMCON)</i>, Mar. 2025.",
            "(SAMCON)</i>, Matsue, Japan, Mar. 2025.",
            "Presentation SAMCON Mar 2025",
            "SAMCON2025 official site",
        ),
        (
            "Joint Research Symposium</i>, Oct. 2024.",
            "Joint Research Symposium</i>, Manchester, United Kingdom, Oct. 2024.",
            "GGTX Workshop Oct 2024",
            "https://www.cis-trans.jp/spring_gx/events/Manchester2024-e.html",
        ),
        (
            "(MEC)</i>, Sep. 2024.",
            "(MEC)</i>, Tokyo, Japan, Sep. 2024.",
            "Presentation MEC Sep 2024",
            "Tokyo",
        ),
        (
            "(JIASC)</i>, Aug. 2024.",
            "(JIASC)</i>, Mito, Japan, Aug. 2024.",
            "Presentation JIASC Aug 2024",
            "JIASC 2024 Mito",
        ),
        (
            "(PE/PSE/SPC)</i>, Mar. 2024.",
            "(PE/PSE/SPC)</i>, Fukue, Japan, Mar. 2024.",
            "Presentation PE/PSE/SPC Mar 2024",
            "Fukue workshop 2024",
        ),
        (
            "(AMC)</i>, Feb. 2024.",
            "(AMC)</i>, Kyoto, Japan, Feb. 2024.",
            "Presentation AMC Feb 2024 (×2)",
            "AMC 2024 Kyoto",
        ),
        (
            "(IECON)</i>, Oct. 2023.",
            "(IECON)</i>, Singapore, Singapore, Oct. 2023.",
            "Presentation IECON Oct 2023",
            "City-state",
        ),
        (
            "(MEC)</i>, Sep. 2023.",
            "(MEC)</i>, Tokyo, Japan, Sep. 2023.",
            "Presentation MEC Sep 2023",
            "Tokyo",
        ),
        (
            "(PE/PSE/SPC)</i>, Mar. 2023.",
            "(PE/PSE/SPC)</i>, Nago, Japan, Mar. 2023.",
            "Presentation PE/PSE/SPC Mar 2023",
            "Nago workshop 2023",
        ),
        (
            "(WPW)</i>, Jul. 2022.",
            "(WPW)</i>, Bordeaux, France, Jul. 2022.",
            "Presentation WPW Jul 2022",
            "WPW 2022",
        ),
        (
            "(JIASC)</i>, Aug. 2021.",
            "(JIASC)</i>, Nagaoka, Japan, Aug. 2021.",
            "Presentation JIASC Aug 2021",
            "JIASC 2021 Nagaoka",
        ),
    ]
    for old, new, entry, src in en_pres:
        sub(en, old, new, entry, src)

    # --- CV presentation duplicates (presentation section only) ---
    cv_pres = [
        (
            "(SAMCON)}, Mar. 2026.",
            "(SAMCON)}, Daegu, Korea, Mar. 2026.",
            "Presentation SAMCON Mar 2026",
            "Same as site",
        ),
        (
            "(SAMCON)}, Mar. 2025.",
            "(SAMCON)}, Matsue, Japan, Mar. 2025.",
            "Presentation SAMCON Mar 2025",
            "SAMCON2025",
        ),
        (
            "Symposium}, Oct. 2024.",
            "Symposium}, Manchester, United Kingdom, Oct. 2024.",
            "GGTX Oct 2024",
            "SPRING GX Manchester2024 page",
        ),
        (
            "(MEC)}, Sep. 2024.",
            "(MEC)}, Tokyo, Japan, Sep. 2024.",
            "Presentation MEC Sep 2024",
            "Tokyo",
        ),
        (
            "(JIASC)}, Aug. 2024.",
            "(JIASC)}, Mito, Japan, Aug. 2024.",
            "Presentation JIASC Aug 2024",
            "Mito",
        ),
        (
            "(PE/PSE/SPC)}, Mar. 2024.",
            "(PE/PSE/SPC)}, Fukue, Japan, Mar. 2024.",
            "Presentation PE/PSE/SPC Mar 2024",
            "Fukue",
        ),
        (
            "(AMC)}, Feb. 2024.",
            "(AMC)}, Kyoto, Japan, Feb. 2024.",
            "Presentation AMC Feb 2024",
            "Kyoto AMC",
        ),
        (
            "(IECON)}, Oct. 2023.",
            "(IECON)}, Singapore, Singapore, Oct. 2023.",
            "Presentation IECON Oct 2023",
            "City-state",
        ),
        (
            "(MEC)}, Sep. 2023.",
            "(MEC)}, Tokyo, Japan, Sep. 2023.",
            "Presentation MEC Sep 2023",
            "Tokyo",
        ),
        (
            "(PE/PSE/SPC)}, Mar. 2023.",
            "(PE/PSE/SPC)}, Nago, Japan, Mar. 2023.",
            "Presentation PE/PSE/SPC Mar 2023",
            "Nago",
        ),
        (
            "(JIASC)}, Aug. 2021.",
            "(JIASC)}, Nagaoka, Japan, Aug. 2021.",
            "Presentation JIASC Aug 2021",
            "Nagaoka",
        ),
        (
            "(AIM)}, Jul. 2025.",
            "(AIM)}, Hangzhou, China, Jul. 2025.",
            "Presentation AIM Jul 2025",
            "aim2025.org",
        ),
    ]
    for old, new, entry, src in cv_pres:
        sub(cv, old, new, entry, src)

    # CV peer-reviewed SAMCON Shimane
    sub(cv, "Shimane, Japan, Mar. 2025", "Matsue, Japan, Mar. 2025", "SAMCON 2025 pub", "SAMCON2025 Matsue")
    sub(en, "Shimane, Japan, Mar. 2025", "Matsue, Japan, Mar. 2025", "SAMCON 2025 pub", "SAMCON2025 Matsue")
    sub(jp, "Shimane, Japan, Mar. 2025", "Matsue, Japan, Mar. 2025", "SAMCON 2025 pub", "SAMCON2025 Matsue")

    # CV outreach location
    sub(ex, "{Chiba} % Location", "{Kashiwa, Japan} % Location", "Kashiwanoha workshop", "Kashiwanoha, Kashiwa city")

    # Internship locations
    sub(ex, "{France} % Location", "{Compiègne, France} % Location", "UTC internship", "UTC host city")

    out = ROOT / "tools/places_change_log.json"
    import json

    out.write_text(json.dumps(LOG, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Applied {len(LOG)} replacements; log -> {out}")


if __name__ == "__main__":
    main()
