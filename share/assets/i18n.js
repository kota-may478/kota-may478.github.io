// UI strings and language state for the share viewer.
// All user-visible UI text lives here; other modules refer to keys only.
// The selected language is kept in memory only (never persisted).

export const SUPPORTED_LANGS = ["ja", "en"];
export const DEFAULT_LANG = "ja";

export const MESSAGES = {
    ja: {
        "app.title": "共有プロジェクト",
        "lang.toggle": "Japanese/English",
        "lang.toggleLabel": "Switch to English",

        "form.heading": "プロジェクトを開く",
        "form.description":
            "共有されたIDとパスワードを入力してください。",
        "form.projectName": "ID",
        "form.password": "パスワード",
        "form.showPassword": "パスワードを表示",
        "form.submit": "開く",
        "form.working": "復号しています…",

        "loading.files": "ファイルを読み込んでいます…",

        "dir.heading": "ファイル",
        "dir.kicad": "KiCADデータ",
        "dir.kicadDesc": "回路図と基板を表示します",
        "dir.readme": "README.md",
        "dir.readmeDesc": "説明文を表示します",
        "dir.unavailable": "含まれていません",

        "nav.back": "戻る",

        "kicad.loading": "KiCADデータを読み込んでいます…",
        "kicad.failed": "KiCADデータを表示できませんでした。",

        "readme.failed": "README.md を表示できませんでした。",
        "readme.imageMissing": "画像が含まれていません",
        "readme.linkDisabled": "このリンク先は共有に含まれていません",
        "readme.mermaidFailed": "この図（Mermaid）を表示できませんでした",
        "readme.diagramZoom": "クリックで拡大／縮小",
        "readme.diagramAlt": "図（Mermaid）",

        "error.credentials": "IDかパスワードが違います。",
        "error.network": "データを取得できませんでした。",
        "error.format": "データの形式が正しくありません。",
        "error.unsupported":
            "このブラウザには必要な機能がありません。最新のブラウザで開いてください。",
        "error.listing":
            "ファイル一覧を取得できませんでした（開発用ページ）。",
        "error.noProject":
            "URLに ?project=<プロジェクト名> を指定してください（開発用ページ）。",
        "error.unknown": "予期しないエラーが発生しました。",
        "error.framed": "このページは他のページに埋め込んだ状態では表示できません。アドレスを直接開いてください。",

        "dev.banner": "開発用ページ：平文のファイルを直接読み込んでいます",
        "footer.copyright": "© 2026 Kota Fujimoto. All rights reserved.",
    },
    en: {
        "app.title": "Shared project",
        "lang.toggle": "Japanese/English",
        "lang.toggleLabel": "日本語に切り替え",

        "form.heading": "Open project",
        "form.description":
            "Enter the ID and password you were given.",
        "form.projectName": "ID",
        "form.password": "Password",
        "form.showPassword": "Show password",
        "form.submit": "Open",
        "form.working": "Decrypting…",

        "loading.files": "Loading files…",

        "dir.heading": "Files",
        "dir.kicad": "KiCAD data",
        "dir.kicadDesc": "View the schematic and board",
        "dir.readme": "README.md",
        "dir.readmeDesc": "View the description",
        "dir.unavailable": "Not included",

        "nav.back": "Back",

        "kicad.loading": "Loading KiCAD data…",
        "kicad.failed": "Could not display the KiCAD data.",

        "readme.failed": "Could not display README.md.",
        "readme.imageMissing": "Image not included",
        "readme.linkDisabled": "This link target is not part of the share",
        "readme.mermaidFailed": "Could not render this diagram (Mermaid)",
        "readme.diagramZoom": "Click to zoom in / out",
        "readme.diagramAlt": "Diagram (Mermaid)",

        "error.credentials": "The ID or password is incorrect.",
        "error.network": "Could not fetch the data.",
        "error.format": "The data format is invalid.",
        "error.unsupported":
            "This browser lacks required features. Please use an up-to-date browser.",
        "error.listing": "Could not list the files (development page).",
        "error.noProject":
            "Add ?project=<project name> to the URL (development page).",
        "error.unknown": "An unexpected error occurred.",
        "error.framed": "This page cannot be shown inside another page. Please open its address directly.",

        "dev.banner": "Development page: loading plaintext files directly",
        "footer.copyright": "© 2026 Kota Fujimoto. All rights reserved.",
    },
};

let currentLang = DEFAULT_LANG;
const listeners = new Set();

/** Pick the initial language from a query string such as "?lang=en". */
export function initLang(search = window.location.search) {
    const requested = new URLSearchParams(search).get("lang");
    setLang(SUPPORTED_LANGS.includes(requested) ? requested : DEFAULT_LANG);
}

export function getLang() {
    return currentLang;
}

export function setLang(lang) {
    if (!SUPPORTED_LANGS.includes(lang)) {
        return;
    }
    currentLang = lang;
    document.documentElement.lang = lang;
    for (const listener of listeners) {
        listener(lang);
    }
}

export function toggleLang() {
    setLang(currentLang === "ja" ? "en" : "ja");
}

/** Register a callback fired after every language change. */
export function onLangChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function t(key) {
    return MESSAGES[currentLang][key] ?? MESSAGES[DEFAULT_LANG][key] ?? key;
}

/**
 * Re-translate every element under `root` that carries
 * data-i18n="key" (textContent) or data-i18n-attr="attr:key;attr:key".
 */
export function applyTranslations(root) {
    for (const el of root.querySelectorAll("[data-i18n]")) {
        el.textContent = t(el.dataset.i18n);
    }
    for (const el of root.querySelectorAll("[data-i18n-attr]")) {
        for (const pair of el.dataset.i18nAttr.split(";")) {
            const [attr, key] = pair.split(":");
            if (attr && key) {
                el.setAttribute(attr, t(key));
            }
        }
    }
}
