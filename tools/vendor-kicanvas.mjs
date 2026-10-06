#!/usr/bin/env node
// Reproducibly derive share/assets/vendor/kicanvas/kicanvas.js from the
// upstream KiCanvas bundle.
//
// Usage:
//   curl -o /tmp/kicanvas.js https://kicanvas.org/kicanvas/kicanvas.js
//   node tools/vendor-kicanvas.mjs /tmp/kicanvas.js
//
// Every patch is a literal search/replace that must match exactly once, so an
// upstream update that changes the minified code fails loudly instead of
// producing a half-patched file. When upgrading, update UPSTREAM_SHA256 and
// the anchors below, then re-check the viewer.
//
// KiCanvas is MIT licensed (see share/assets/vendor/kicanvas/license.txt);
// the modifications are listed in share/assets/vendor/versions.txt.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Build of github.com/theacodes/kicanvas commit b031159eb74aaa7eef2b026fd85d35bc05ff2095.
const UPSTREAM_SHA256 = "ca910f25276c3efb9aacb3a5d6341d4d9af4736d4c875fb0440d2cc856865ab7";

const OUTPUT = join(dirname(fileURLToPath(import.meta.url)), "..", "share", "assets", "vendor", "kicanvas", "kicanvas.js");

// UI palette modelled on KiCad's default (light) desktop look. Appended to the
// shared kc-ui stylesheet so it overrides the upstream purple/gradient theme.
const KICAD_LIKE_UI_CSS = `
/* local patch: KiCad-like UI palette */
:host{
--bg:#f4f4f4;--fg:#1e1e1e;
--tooltip-bg:#ffffe1;--tooltip-fg:#1e1e1e;--tooltip-border:1px solid #767676;
--scrollbar-bg:#ececec;--scrollbar-fg:#b9b9b9;--scrollbar-active-fg:#8c8c8c;--scrollbar-hover-bg:#a0a0a0;
--activity-bar-bg:#e6e6e6;--activity-bar-fg:#333333;--activity-bar-active-bg:#fafafa;--activity-bar-active-fg:#1e1e1e;
--resizer-bg:#c8c8c8;--resizer-active-bg:#3874d8;
--panel-bg:#fafafa;--panel-fg:#1e1e1e;--panel-border:1px solid #c8c8c8;
--panel-title-bg:#e6e6e6;--panel-title-fg:#1e1e1e;--panel-title-border:1px solid #c8c8c8;
--panel-title-button-bg:transparent;--panel-title-button-fg:#333333;--panel-title-button-hover-bg:#d4d4d4;--panel-title-button-hover-fg:inherit;--panel-title-button-disabled-bg:inherit;--panel-title-button-disabled-fg:#9a9a9a;
--panel-subtitle-bg:#ededed;--panel-subtitle-fg:#1e1e1e;
--dropdown-bg:#ffffff;--dropdown-fg:#1e1e1e;
--button-bg:#e1e1e1;--button-fg:#1e1e1e;--button-hover-bg:#e5f1fb;--button-hover-fg:#1e1e1e;--button-focus-outline:1px solid #3874d8;--button-selected-bg:#cce4f7;--button-selected-fg:#1e1e1e;--button-disabled-bg:#f0f0f0;--button-disabled-fg:#9a9a9a;
--button-success-bg:#d7ecd9;--button-success-fg:#1e1e1e;--button-success-hover-bg:#c4e3c7;--button-success-hover-fg:#1e1e1e;
--button-danger-bg:#f6d6d6;--button-danger-fg:#1e1e1e;--button-danger-hover-bg:#f0c2c2;--button-danger-hover-fg:#1e1e1e;
--button-outline-bg:#fafafa;--button-outline-fg:#1e1e1e;--button-outline-hover-bg:#e5f1fb;--button-outline-hover-fg:#1e1e1e;--button-outline-disabled-bg:#f0f0f0;--button-outline-disabled-fg:#9a9a9a;
--button-toolbar-bg:#f0f0f0;--button-toolbar-fg:#1e1e1e;--button-toolbar-hover-bg:#e5f1fb;--button-toolbar-hover-fg:#1e1e1e;--button-toolbar-disabled-bg:#f0f0f0;--button-toolbar-disabled-fg:#9a9a9a;
--button-menu-bg:transparent;--button-menu-fg:#1e1e1e;--button-menu-hover-bg:transparent;--button-menu-hover-fg:#3874d8;--button-menu-disabled-bg:transparent;--button-menu-disabled-fg:#9a9a9a;
--input-bg:#ffffff;--input-fg:#1e1e1e;--input-border:1px solid #a0a0a0;--input-accent:#3874d8;--input-focus-outline:1px solid #3874d8;--input-placeholder:#8c8c8c;--input-disabled-bg:#f0f0f0;--input-disabled-fg:#9a9a9a;
--input-range-bg:#c8c8c8;--input-range-fg:#1e1e1e;--input-range-hover-bg:#3874d8;--input-range-disabled-bg:#f0f0f0;
--list-item-bg:#fafafa;--list-item-fg:#1e1e1e;--list-item-active-bg:#cce4f7;--list-item-active-fg:#1e1e1e;--list-item-hover-bg:#e5f1fb;--list-item-hover-fg:#1e1e1e;--list-item-disabled-bg:#fafafa;--list-item-disabled-fg:#9a9a9a;
--grid-outline:#c8c8c8;
--gradient-purple-green-light:#e6e6e6;--gradient-purple-blue-medium:#c8c8c8;--gradient-purple-blue-dark:#fafafa;
--gradient-purple-green-highlight:#3874d8;--gradient-cyan-blue-light:#3874d8;--gradient-purple-red:#3874d8;--gradient-purple-red-highlight:#5a8de0;
}
`;

const PATCHES = [
    {
        description: "remove the external Google Fonts <link> (fonts are self-hosted)",
        apply(src) {
            const start = 'document.body.appendChild(f`<link';
            const endMarker = 'crossorigin="anonymous" />`);';
            const i = indexOnce(src, start);
            const j = src.indexOf(endMarker, i);
            if (j < 0 || !src.slice(i, j).includes("fonts.googleapis.com")) {
                throw new Error("font <link> statement not found");
            }
            return (
                src.slice(0, i) +
                "/* local patch: external Google Fonts <link> removed; fonts are self-hosted by the share viewer */" +
                src.slice(j + endMarker.length)
            );
        },
    },
    {
        description: 'default canvas theme: "witchhazel" -> "kicad"',
        apply(src) {
            // themes = [witch_hazel (Gi), kicad_default (Wn)]; default: witch_hazel
            indexOnce(src, 'var Zn=[Gi,Wn]');
            indexOnce(src, 'name:"kicad",friendly_name:"KiCad"');
            return replaceOnce(src, "Xe={default:Gi,", "Xe={default:Wn,");
        },
    },
    {
        description: "default mouse controls aligned with KiCad (wheel zooms)",
        apply(src) {
            return replaceOnce(src, '"alignControlsWithKiCad",!1)', '"alignControlsWithKiCad",!0)');
        },
    },
    {
        description: "append KiCad-like UI palette to the kc-ui stylesheet",
        apply(src) {
            const open = "var mr=`:host{font-size:var(--font-size, 16px);";
            const i = indexOnce(src, open);
            const j = src.indexOf("`", i + open.length);
            const css = src.slice(i, j);
            if (css.includes("${") || !css.includes("--panel-title-bg:")) {
                throw new Error("kc-ui stylesheet literal not recognised");
            }
            return src.slice(0, j) + KICAD_LIKE_UI_CSS + src.slice(j);
        },
    },
];

function indexOnce(src, needle) {
    const i = src.indexOf(needle);
    if (i < 0 || src.indexOf(needle, i + 1) >= 0) {
        throw new Error(`expected exactly one occurrence of ${JSON.stringify(needle)}`);
    }
    return i;
}

function replaceOnce(src, from, to) {
    const i = indexOnce(src, from);
    return src.slice(0, i) + to + src.slice(i + from.length);
}

function sha256(text) {
    return createHash("sha256").update(text).digest("hex");
}

const input = process.argv[2];
if (!input) {
    console.error("usage: node tools/vendor-kicanvas.mjs <upstream kicanvas.js>");
    process.exit(2);
}

let src = readFileSync(input, "utf8");
const inHash = sha256(src);
if (inHash !== UPSTREAM_SHA256) {
    console.error(`upstream SHA-256 mismatch:\n  expected ${UPSTREAM_SHA256}\n  got      ${inHash}`);
    console.error("Review the upstream change, then update UPSTREAM_SHA256 and the patch anchors.");
    process.exit(1);
}

for (const patch of PATCHES) {
    src = patch.apply(src);
    console.log(`patched: ${patch.description}`);
}

writeFileSync(OUTPUT, src);
console.log(`wrote ${OUTPUT}\nSHA-256 ${sha256(src)}`);
