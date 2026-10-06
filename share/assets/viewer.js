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
    getLang,
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

/** README file names per UI language, most preferred first. */
const README_NAMES = {
    ja: ["README.md", "README.en.md"],
    en: ["README.en.md", "README.md"],
};

/**
 * README to show for a UI language: README.en.md for English when present,
 * README.md otherwise (and vice versa). Root-level, case-insensitive.
 */
export function findReadmePath(files, lang = "ja") {
    const rootFiles = [...files.keys()].filter((p) => !p.includes("/"));
    for (const name of README_NAMES[lang] ?? README_NAMES.ja) {
        const found = rootFiles.find((p) => p.toLowerCase() === name.toLowerCase());
        if (found) {
            return found;
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

// Blob URLs of README images, revoked when the decrypted content is wiped.
const readmeBlobUrls = new Set();

function revokeReadmeBlobUrls() {
    for (const url of readmeBlobUrls) {
        URL.revokeObjectURL(url);
    }
    readmeBlobUrls.clear();
}

function renderMarkdown(text, files) {
    purifyContext = {
        imageUrl(path) {
            const data = files.get(path);
            const ext = path.split(".").pop().toLowerCase();
            if (!data || !IMAGE_TYPES[ext]) {
                return null;
            }
            const url = URL.createObjectURL(new Blob([data], { type: IMAGE_TYPES[ext] }));
            readmeBlobUrls.add(url);
            return url;
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
        // The site offsets the h2 underline differently for Latin and
        // Japanese text; pick per heading since README language varies.
        for (const h2 of fragment.querySelectorAll("h2")) {
            if (!/[\u3000-\u30ff\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(h2.textContent)) {
                h2.classList.add("sv-latin");
            }
        }
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
// Mermaid diagrams in README.md

let mermaidPromise = null;
let mermaidCounter = 0;
/**
 * Load the vendored Mermaid bundle once, only when a README actually contains
 * a diagram, inside a hidden same-origin about:blank iframe.
 *
 * Mermaid lays diagrams out in temporary DOM nodes before returning the SVG.
 * Extensions that rewrite page content (e.g. "click to call" extensions that
 * wrap phone-number-like digits, which also match numbers in Mermaid's CSS)
 * would corrupt those nodes in the main document. Content scripts are not
 * injected into about:blank frames unless an extension opts in, so Mermaid
 * runs in such a frame and only its SVG string is used here.
 */
function loadMermaid() {
    mermaidPromise ??= new Promise((resolve, reject) => {
        const frame = el("iframe", { "aria-hidden": "true", tabindex: "-1", title: "" });
        frame.style.cssText = "position:absolute;left:-100000px;top:0;width:1600px;height:1200px;border:0;visibility:hidden;";
        document.body.append(frame);
        const win = frame.contentWindow;
        const doc = frame.contentDocument;
        if (!win || !doc) {
            reject(new Error("Mermaid frame unavailable"));
            return;
        }
        doc.open();
        doc.write("<!doctype html><html><head><meta charset=\"utf-8\"></head><body></body></html>");
        doc.close();
        const script = doc.createElement("script");
        script.src = new URL("./vendor/mermaid/mermaid.min.js", import.meta.url).href;
        script.onload = () => {
            const mermaid = win.mermaid;
            if (!mermaid) {
                reject(new Error("Mermaid did not load"));
                return;
            }
            mermaid.initialize({
                startOnLoad: false,
                // "strict": labels are sanitised and click/script features are disabled.
                securityLevel: "strict",
                theme: "default",
                fontFamily: "Arial, sans-serif",
                // HTML labels (Mermaid's default): with SVG <text> labels,
                // subgraph titles are not taken into account when sizing the
                // subgraph and overflow its box. The DOMPurify pass below keeps
                // the label HTML inside <foreignObject>.
                htmlLabels: true,
                flowchart: { htmlLabels: true },
                // Keys that %%{init}%% directives inside a README may not change
                // (Mermaid's defaults plus htmlLabels).
                secure: ["secure", "securityLevel", "startOnLoad", "maxTextSize", "suppressErrorRendering", "maxEdges", "htmlLabels"],
            });
            resolve(mermaid);
        };
        script.onerror = () => reject(new Error("Mermaid failed to load"));
        doc.head.append(script);
    });
    return mermaidPromise.catch((err) => {
        mermaidPromise = null;
        throw err;
    });
}

/**
 * Replace every ```mermaid code block under `root` with the rendered SVG.
 * A block that fails to render is kept as code with a short note.
 */
async function renderMermaidBlocks(root) {
    const blocks = [...root.querySelectorAll("pre > code.language-mermaid")];
    if (!blocks.length) {
        return;
    }
    let mermaid;
    try {
        mermaid = await loadMermaid();
    } catch (err) {
        console.error(err);
        for (const code of blocks) {
            code.parentElement.after(el("p", { class: "sv-missing", i18n: "readme.mermaidFailed" }));
        }
        return;
    }
    for (const code of blocks) {
        const pre = code.parentElement;
        try {
            const { svg } = await mermaid.render(`sv-mermaid-${++mermaidCounter}`, code.textContent);
            // Defence in depth: Mermaid already sanitises in strict mode;
            // strip scripts and event handlers again before inserting.
            // <foreignObject> is declared an HTML integration point so the
            // (sanitised) HTML labels inside it are kept.
            const fragment = purifier.sanitize(svg, {
                RETURN_DOM_FRAGMENT: true,
                USE_PROFILES: { svg: true, svgFilters: true, html: true },
                ADD_TAGS: ["foreignObject", "style"],
                HTML_INTEGRATION_POINTS: { "annotation-xml": true, foreignobject: true },
                FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "button", "textarea", "select"],
            });
            const { img, naturalWidth } = svgToImage(fragment);
            const figure = el("div", { class: "sv-mermaid" }, [img]);
            pre.replaceWith(figure);
            makeZoomable(figure, img, naturalWidth);
        } catch (err) {
            console.warn("Mermaid diagram could not be rendered", err);
            pre.after(el("p", { class: "sv-missing", i18n: "readme.mermaidFailed" }));
        }
    }
}

/**
 * Show a rendered diagram as an <img> backed by a blob: SVG instead of inline
 * SVG. Content scripts of browser extensions cannot reach into an image, so
 * they cannot corrupt it (e.g. "click to call" extensions that wrap
 * phone-number-like digits found in the diagram's CSS), and scripts or styles
 * inside the image can never affect the page.
 */
function svgToImage(fragment) {
    const svg = fragment.querySelector("svg");
    if (!svg) {
        throw new Error("Mermaid produced no SVG");
    }
    const [, , width, height] = (svg.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
    if (!(width > 0 && height > 0)) {
        throw new Error("Mermaid SVG has no usable viewBox");
    }
    // An SVG image needs an intrinsic size; Mermaid emits width="100%".
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.removeAttribute("style");
    const xml = new XMLSerializer().serializeToString(svg);
    const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml" }));
    readmeBlobUrls.add(url);
    const img = el("img", {
        src: url,
        width: String(Math.round(width)),
        height: String(Math.round(height)),
        decoding: "async",
        i18nAttr: "alt:readme.diagramAlt",
    });
    return { img, naturalWidth: width };
}

/**
 * Large diagrams are scaled down to the column width. Let the reader toggle
 * such a diagram between "fit to width" and its natural size (scrollable)
 * with a click or Enter/Space.
 */
function makeZoomable(figure, img, naturalWidth) {
    if (!(naturalWidth > figure.clientWidth)) {
        return; // already shown at full size
    }
    figure.classList.add("sv-mermaid--zoomable");
    figure.tabIndex = 0;
    figure.setAttribute("role", "button");
    figure.dataset.i18nAttr = "title:readme.diagramZoom;aria-label:readme.diagramZoom";
    const toggle = () => {
        const full = figure.classList.toggle("sv-mermaid--full");
        img.style.width = full ? `${naturalWidth}px` : "";
        img.style.maxWidth = full ? "none" : "";
    };
    figure.addEventListener("click", toggle);
    figure.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggle();
        }
    });
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

    // Refuse to run inside a frame (clickjacking): GitHub Pages cannot send
    // X-Frame-Options / frame-ancestors, and a <meta> CSP cannot express it.
    if (window.top !== window.self) {
        const note = el("p", { class: "sv-card sv-status sv-error", i18n: "error.framed" });
        root.replaceChildren(note);
        applyTranslations(root);
        onLangChange(() => applyTranslations(root));
        return;
    }

    const state = {
        view: "form",
        projectName: null,
        files: null,
        historyDepth: 0,
    };

    const title = el("h1", {
        class: "sv-title",
        onclick: () => window.scrollTo({ top: 0, behavior: "smooth" }),
    });
    const backButton = el("button", {
        type: "button",
        class: "sv-nav-button",
        i18n: "nav.back",
        hidden: true,
        onclick: () => goBack(),
    });
    const langButton = el("button", {
        type: "button",
        class: "sv-nav-button",
        i18n: "lang.toggle",
        i18nAttr: "aria-label:lang.toggleLabel",
        onclick: () => toggleLang(),
    });
    const main = el("main", { class: "sv-main" });

    const views = {
        form: el("section"),
        status: el("p", { class: "sv-card sv-status", role: "status" }),
        dir: el("section", { class: "sv-card sv-dir" }),
        kicad: el("section", { class: "sv-kicad" }),
        readme: el("article", { class: "sv-card sv-readme" }),
    };
    for (const view of Object.values(views)) {
        view.hidden = true;
        main.append(view);
    }

    const app = el("div", { class: "sv-app" }, [
        ...(devBanner ? [el("div", { class: "sv-dev-banner", i18n: "dev.banner" })] : []),
        el("header", { class: "sv-header" }, [
            el("div", { class: "sv-header-start" }, [backButton]),
            title,
            el("div", { class: "sv-header-end" }, [langButton]),
        ]),
        main,
        el("footer", { class: "sv-footer" }, [el("p", { i18n: "footer.copyright" })]),
    ]);
    root.replaceChildren(app);

    function refreshTitle() {
        if (state.projectName) {
            title.removeAttribute("data-i18n");
            title.textContent = state.projectName;
            // The project name stays out of document.title, which browsers
            // keep in their history.
            document.title = t("app.title");
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
        app.classList.toggle("sv-app--kicad", view === "kicad");
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
        // Switch between README.md and README.en.md when both exist.
        if (state.files && state.view === "readme") {
            const before = state.readmePath;
            renderReadme();
            if (state.readmePath !== before) {
                window.scrollTo(0, 0);
            }
        }
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
            class: "sv-button",
            i18n: "form.submit",
        });

        const form = el(
            "form",
            {
                class: "sv-card sv-form",
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
                    el("span", { class: "sv-entry-text" }, [
                        el("span", { class: "sv-entry-name", i18n: nameKey }),
                        el("span", { class: "sv-entry-desc", i18n: available ? descKey : "dir.unavailable" }),
                    ]),
                    el("span", { class: "sv-entry-chevron", "aria-hidden": "true" }, ["chevron_right"]),
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

    // Render the README for the current UI language (README.en.md / README.md)
    // unless that file is already shown.
    function renderReadme() {
        const path = findReadmePath(state.files, getLang());
        if (state.readmePath === path && views.readme.firstChild) {
            return true;
        }
        try {
            revokeReadmeBlobUrls();
            const text = new TextDecoder("utf-8").decode(state.files.get(path));
            views.readme.replaceChildren(renderMarkdown(text, state.files));
            state.readmePath = path;
            renderMermaidBlocks(views.readme).then(() => applyTranslations(views.readme));
            return true;
        } catch (err) {
            console.error(err);
            views.readme.replaceChildren();
            state.readmePath = null;
            showStatus("readme.failed");
            return false;
        }
    }

    function openReadme() {
        if (!renderReadme()) {
            return;
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

    // --- leaving the page ---------------------------------------------------------------

    // Decrypted content must not survive in the back/forward cache: wipe it
    // when the page is hidden, and start over if the page is restored.
    function wipeDecryptedContent() {
        if (!state.files) {
            return;
        }
        state.files = null;
        state.projectName = null;
        views.kicad.replaceChildren();
        views.readme.replaceChildren();
        views.dir.replaceChildren();
        state.readmePath = null;
        revokeReadmeBlobUrls();
    }

    window.addEventListener("pagehide", wipeDecryptedContent);
    window.addEventListener("pageshow", (event) => {
        if (event.persisted) {
            window.location.reload();
        }
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
