// Presentation layer of the share viewer.
//
// It is independent of where the data comes from: a "source" object hands it
// an in-memory Map of relative path -> Uint8Array, and this module renders the
// two-entry directory (KiCAD data / README.md), KiCanvas and the Markdown
// preview. Nothing is written to localStorage, sessionStorage or IndexedDB.
//
// Source contract:
//   {
//     requiresCredentials: boolean,
//     open(credentials | null): Promise<{ projectName: string, files: Map<string, Uint8Array> }>
//   }
// open() rejects with SourceError(code); `code` maps to the i18n key "error.<code>".

import {
    applyTranslations,
    initLang,
    onLangChange,
    t,
    toggleLang,
} from "./i18n.js";
import { Marked } from "./vendor/marked/marked.esm.js";
import DOMPurify from "./vendor/dompurify/purify.es.mjs";

export class SourceError extends Error {
    constructor(code, options) {
        super(code, options);
        this.name = "SourceError";
        this.code = code;
    }
}

export const KICAD_EXTENSIONS = [".kicad_pro", ".kicad_sch", ".kicad_pcb"];

const IMAGE_TYPES = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    webp: "image/webp",
    avif: "image/avif",
    bmp: "image/bmp",
};

// Prefix for ids inside the rendered README, so its headings cannot clash
// with (or clobber) anything in the viewer itself.
const README_ID_PREFIX = "readme-";

export function isKicadPath(path) {
    return KICAD_EXTENSIONS.some((ext) => path.endsWith(ext));
}

export function findReadmePath(files) {
    if (files.has("README.md")) {
        return "README.md";
    }
    for (const path of files.keys()) {
        if (!path.includes("/") && path.toLowerCase() === "readme.md") {
            return path;
        }
    }
    return null;
}

/**
 * Resolve a relative reference (e.g. "img/a.png") against the archive root.
 * Returns null for absolute URLs, root-relative paths or paths that escape
 * the root.
 */
export function resolveArchivePath(ref) {
    if (!ref || /^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith("/")) {
        return null;
    }
    const base = "https://archive.invalid/root/";
    let url;
    try {
        url = new URL(ref, base);
    } catch {
        return null;
    }
    if (url.origin !== "https://archive.invalid" || !url.pathname.startsWith("/root/")) {
        return null;
    }
    try {
        return decodeURIComponent(url.pathname.slice("/root/".length));
    } catch {
        return null;
    }
}

function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (key === "class") {
            node.className = value;
        } else if (key === "i18n") {
            node.dataset.i18n = value;
        } else if (key === "i18nAttr") {
            node.dataset.i18nAttr = value;
        } else if (key.startsWith("on")) {
            node.addEventListener(key.slice(2), value);
        } else if (value === true) {
            node.setAttribute(key, "");
        } else if (value !== false && value != null) {
            node.setAttribute(key, value);
        }
    }
    for (const child of children) {
        node.append(child);
    }
    return node;
}

// ---------------------------------------------------------------------------
// Markdown

// GitHub-style heading slug, so README tables of contents keep working.
function slugify(text) {
    return text
        .trim()
        .toLowerCase()
        .replace(/<[^>]*>/g, "")
        .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
        .replace(/\s/g, "-");
}

function createMarked() {
    const used = new Map();
    const marked = new Marked({
        gfm: true,
        renderer: {
            heading({ tokens, depth, text }) {
                let slug = slugify(text);
                const count = used.get(slug) ?? 0;
                used.set(slug, count + 1);
                if (count > 0) {
                    slug = `${slug}-${count}`;
                }
                const inner = this.parser.parseInline(tokens);
                return `<h${depth} id="${escapeHtml(slug)}">${inner}</h${depth}>\n`;
            },
        },
    });
    return marked;
}

const purifier = DOMPurify(window);
let purifyContext = null;

purifier.addHook("afterSanitizeAttributes", (node) => {
    const ctx = purifyContext;
    if (!ctx || node.nodeType !== Node.ELEMENT_NODE) {
        return;
    }
    if (node.hasAttribute("id")) {
        node.setAttribute("id", README_ID_PREFIX + node.getAttribute("id"));
    }
    if (node.tagName === "IMG") {
        const src = node.getAttribute("src") ?? "";
        node.removeAttribute("src");
        node.removeAttribute("srcset");
        const path = resolveArchivePath(src);
        const url = path ? ctx.imageUrl(path) : null;
        if (url) {
            node.setAttribute("src", url);
        } else {
            node.dataset.missing = "1";
        }
    } else if (node.tagName === "A" && node.hasAttribute("href")) {
        const href = node.getAttribute("href");
        if (href.startsWith("#")) {
            node.dataset.anchor = href.slice(1);
        } else if (/^(https?:|mailto:)/i.test(href)) {
            node.setAttribute("target", "_blank");
            node.setAttribute("rel", "noopener noreferrer");
        } else {
            // Relative links point at files that are not part of the share.
            node.removeAttribute("href");
            node.dataset.i18nAttr = "title:readme.linkDisabled";
        }
    }
});

// Blob URLs for README images live as long as the page; the README is
// rendered once per unlock, so they are not revoked.
function renderMarkdown(text, files) {
    purifyContext = {
        imageUrl(path) {
            const data = files.get(path);
            const ext = path.split(".").pop().toLowerCase();
            if (!data || !IMAGE_TYPES[ext]) {
                return null;
            }
            return URL.createObjectURL(new Blob([data], { type: IMAGE_TYPES[ext] }));
        },
    };
    try {
        const html = createMarked().parse(text);
        const fragment = purifier.sanitize(html, {
            RETURN_DOM_FRAGMENT: true,
            ALLOW_DATA_ATTR: false,
            FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select"],
            // CSP must allow inline styles for KiCanvas, so README styles are
            // stripped here instead (as GitHub does) to prevent UI overlays.
            FORBID_ATTR: ["style"],
        });
        for (const img of fragment.querySelectorAll("img[data-missing]")) {
            const note = el("span", { class: "sv-missing", i18n: "readme.imageMissing" });
            if (img.alt) {
                note.title = img.alt;
            }
            img.replaceWith(note);
        }
        return fragment;
    } finally {
        purifyContext = null;
    }
}

// ---------------------------------------------------------------------------
// KiCanvas

let kicanvasModule = null;

function loadKicanvas() {
    kicanvasModule ??= import("./vendor/kicanvas/kicanvas.js");
    return kicanvasModule;
}

/**
 * Build the <kicanvas-embed> markup with every KiCad file inlined as a named
 * <kicanvas-source>. KiCanvas picks the parser by the file name extension,
 * and resolves hierarchical sheets by their relative path, so the archive
 * paths are passed unchanged. The markup is inserted as an HTML string
 * (rather than built with createElement + setAttribute) so the custom
 * elements see their attributes and children when they upgrade.
 */
function kicanvasMarkup(files) {
    const decoder = new TextDecoder("utf-8");
    const order = (path) => KICAD_EXTENSIONS.findIndex((ext) => path.endsWith(ext));
    const paths = [...files.keys()]
        .filter(isKicadPath)
        .sort((a, b) => order(a) - order(b) || (a < b ? -1 : a > b ? 1 : 0));
    // "nooverlay": the viewer fills the page, so the click-to-interact
    // overlay meant for inline embeds is not needed.
    let html = '<kicanvas-embed controls="full" controlslist="nooverlay">';
    for (const path of paths) {
        const text = decoder.decode(files.get(path));
        html += `<kicanvas-source name="${escapeHtml(path)}">${escapeHtml(text)}</kicanvas-source>`;
    }
    html += "</kicanvas-embed>";
    return html;
}

/**
 * KiCanvas always opens the first page of its project, which is the board
 * whenever a .kicad_pcb is present. Once it has picked that page, switch to
 * the first schematic page (the root sheet) instead. The project object is
 * reached through the public `project` property of the inner app elements,
 * so the vendored bundle stays unmodified.
 */
async function preferSchematic(embed, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const app = embed.shadowRoot?.querySelector("kc-schematic-app, kc-board-app");
        const project = app?.project;
        if (project?.active_page) {
            if (project.active_page.type !== "schematic") {
                const schematic = [...project.pages()].find((page) => page.type === "schematic");
                if (schematic) {
                    project.set_active_page(schematic);
                }
            }
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}

// ---------------------------------------------------------------------------
// App shell

export function startViewer({ root, source, devBanner = false }) {
    initLang();

    const state = {
        view: "form",
        projectName: null,
        files: null,
        historyDepth: 0,
    };

    const title = el("h1", { class: "sv-title" });
    const backButton = el("button", {
        type: "button",
        class: "sv-button",
        i18n: "nav.back",
        hidden: true,
        onclick: () => goBack(),
    });
    const langButton = el("button", {
        type: "button",
        class: "sv-button",
        i18n: "lang.toggle",
        i18nAttr: "aria-label:lang.toggleLabel",
        onclick: () => toggleLang(),
    });
    const main = el("main", { class: "sv-main" });

    const views = {
        form: el("section"),
        status: el("p", { class: "sv-status", role: "status" }),
        dir: el("section", { class: "sv-dir" }),
        kicad: el("section", { class: "sv-kicad" }),
        readme: el("article", { class: "sv-readme" }),
    };
    for (const view of Object.values(views)) {
        view.hidden = true;
        main.append(view);
    }

    const app = el("div", { class: "sv-app" }, [
        ...(devBanner ? [el("div", { class: "sv-dev-banner", i18n: "dev.banner" })] : []),
        el("header", { class: "sv-topbar" }, [backButton, title, langButton]),
        main,
    ]);
    root.replaceChildren(app);

    function refreshTitle() {
        if (state.projectName) {
            title.removeAttribute("data-i18n");
            title.textContent = state.projectName;
            document.title = `${state.projectName} - ${t("app.title")}`;
        } else {
            title.dataset.i18n = "app.title";
            title.textContent = t("app.title");
            document.title = t("app.title");
        }
    }

    function show(view) {
        state.view = view;
        for (const [name, node] of Object.entries(views)) {
            node.hidden = name !== view;
        }
        backButton.hidden = !(view === "kicad" || view === "readme");
        refreshTitle();
        applyTranslations(app);
    }

    function showStatus(key) {
        views.status.dataset.i18n = key;
        show("status");
    }

    onLangChange(() => {
        applyTranslations(app);
        refreshTitle();
    });

    // --- credentials form ---------------------------------------------------

    function buildForm() {
        const error = el("p", { class: "sv-error", role: "alert", hidden: true });
        const nameInput = el("input", {
            class: "sv-input",
            name: "project",
            type: "text",
            autocomplete: "off",
            autocapitalize: "off",
            spellcheck: "false",
            required: true,
        });
        const passInput = el("input", {
            class: "sv-input",
            name: "password",
            type: "password",
            autocomplete: "off",
            required: true,
        });
        const showPass = el("input", {
            type: "checkbox",
            onchange: () => {
                passInput.type = showPass.checked ? "text" : "password";
            },
        });
        const submit = el("button", {
            type: "submit",
            class: "sv-button sv-button--primary",
            i18n: "form.submit",
        });

        const form = el(
            "form",
            {
                class: "sv-panel",
                novalidate: true,
                onsubmit: async (event) => {
                    event.preventDefault();
                    if (!nameInput.value.trim() || !passInput.value) {
                        (nameInput.value.trim() ? passInput : nameInput).focus();
                        return;
                    }
                    error.hidden = true;
                    submit.disabled = true;
                    submit.dataset.i18n = "form.working";
                    applyTranslations(form);
                    try {
                        await unlock({ projectName: nameInput.value, password: passInput.value });
                        passInput.value = "";
                    } catch (err) {
                        error.dataset.i18n = errorKey(err);
                        error.hidden = false;
                    } finally {
                        submit.disabled = false;
                        submit.dataset.i18n = "form.submit";
                        applyTranslations(form);
                    }
                },
            },
            [
                el("h2", { i18n: "form.heading" }),
                el("p", { i18n: "form.description" }),
                el("label", { class: "sv-field" }, [el("span", { i18n: "form.projectName" }), nameInput]),
                el("label", { class: "sv-field" }, [el("span", { i18n: "form.password" }), passInput]),
                el("label", { class: "sv-check" }, [showPass, el("span", { i18n: "form.showPassword" })]),
                error,
                submit,
            ],
        );
        views.form.replaceChildren(form);
        return nameInput;
    }

    function errorKey(err) {
        if (err instanceof SourceError) {
            return `error.${err.code}`;
        }
        console.error(err);
        return "error.unknown";
    }

    async function unlock(credentials) {
        const result = await source.open(credentials);
        state.projectName = result.projectName;
        state.files = result.files;
        buildDirectory();
        show("dir");
    }

    // --- directory ------------------------------------------------------------

    function buildDirectory() {
        const hasKicad = [...state.files.keys()].some(isKicadPath);
        const hasReadme = findReadmePath(state.files) !== null;
        const entry = (icon, nameKey, descKey, available, onclick) =>
            el("li", {}, [
                el("button", { type: "button", class: "sv-entry", disabled: !available, onclick }, [
                    el("span", { class: "sv-entry-icon", "aria-hidden": "true" }, [icon]),
                    el("span", {}, [
                        el("span", { class: "sv-entry-name", i18n: nameKey }),
                        el("span", { class: "sv-entry-desc", i18n: available ? descKey : "dir.unavailable" }),
                    ]),
                ]),
            ]);
        views.dir.replaceChildren(
            el("h2", { i18n: "dir.heading" }),
            el("ul", {}, [
                entry("developer_board", "dir.kicad", "dir.kicadDesc", hasKicad, () => openItem("kicad")),
                entry("description", "dir.readme", "dir.readmeDesc", hasReadme, () => openItem("readme")),
            ]),
        );
    }

    function openItem(view) {
        history.pushState({ svView: view }, "");
        state.historyDepth += 1;
        if (view === "kicad") {
            openKicad();
        } else {
            openReadme();
        }
    }

    function goBack() {
        if (state.historyDepth > 0) {
            history.back(); // handled by popstate
        } else {
            show("dir");
        }
    }

    window.addEventListener("popstate", (event) => {
        if (!state.files) {
            return;
        }
        const target = event.state?.svView;
        state.historyDepth = target ? 1 : 0;
        if (target === "kicad") {
            openKicad();
        } else if (target === "readme") {
            openReadme();
        } else {
            show("dir");
        }
    });

    // --- KiCanvas ---------------------------------------------------------------

    async function openKicad() {
        // The embed is created once and kept (hidden) so returning is instant.
        if (views.kicad.firstElementChild) {
            show("kicad");
            return;
        }
        showStatus("kicad.loading");
        try {
            await loadKicanvas();
            views.kicad.innerHTML = kicanvasMarkup(state.files);
            show("kicad");
            preferSchematic(views.kicad.querySelector("kicanvas-embed")).catch((err) =>
                console.warn("Could not switch to the schematic view", err),
            );
        } catch (err) {
            console.error(err);
            views.kicad.replaceChildren();
            showStatus("kicad.failed");
        }
    }

    // --- README -------------------------------------------------------------------

    function openReadme() {
        if (!views.readme.firstChild) {
            try {
                const path = findReadmePath(state.files);
                const text = new TextDecoder("utf-8").decode(state.files.get(path));
                views.readme.replaceChildren(renderMarkdown(text, state.files));
            } catch (err) {
                console.error(err);
                views.readme.replaceChildren();
                showStatus("readme.failed");
                return;
            }
        }
        show("readme");
        window.scrollTo(0, 0);
    }

    views.readme.addEventListener("click", (event) => {
        const link = event.target.closest("a[data-anchor]");
        if (!link) {
            return;
        }
        event.preventDefault();
        let id = link.dataset.anchor;
        try {
            id = decodeURIComponent(id);
        } catch {
            // keep the raw fragment
        }
        document.getElementById(README_ID_PREFIX + id)?.scrollIntoView({ behavior: "smooth" });
    });

    // --- start -----------------------------------------------------------------------

    if (source.requiresCredentials) {
        const firstInput = buildForm();
        show("form");
        firstInput.focus();
    } else {
        showStatus("loading.files");
        unlock(null).catch((err) => {
            views.status.dataset.i18n = errorKey(err);
            views.status.classList.add("sv-error");
            applyTranslations(app);
        });
    }
}
