/**
 * English page only: client-side hyphenation when native CSS hyphens are ineffective.
 * Hyphenopoly © Mathias Nater, MIT — see Hyphenopoly_Loader.js header.
 */
(function () {
    var HYPHEN_SELECTORS = [
        "#about p.bio-text",
        "#career .no-bullet li",
        "#achievements ol > li",
        "#projects .project-description",
        ".tool-card-description"
    ];

    function countSoftHyphens(root) {
        if (!root) {
            return 0;
        }
        var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        var n = 0;
        while (walker.nextNode()) {
            if (walker.currentNode.data.indexOf("\u00AD") !== -1) {
                n += 1;
            }
        }
        return n;
    }

    function hyphenateWithin(root) {
        if (!window.Hyphenopoly || !Hyphenopoly.hyphenators || !Hyphenopoly.hyphenators.HTML) {
            return;
        }
        HYPHEN_SELECTORS.forEach(function (sel) {
            root.querySelectorAll(sel).forEach(function (el) {
                if (countSoftHyphens(el) === 0) {
                    Hyphenopoly.hyphenators.HTML(el, sel);
                }
            });
        });
    }

    function watchFadeInSections() {
        document.querySelectorAll(".fade-in").forEach(function (section) {
            if (section.classList.contains("is-visible")) {
                hyphenateWithin(section);
            }
        });

        var observer = new MutationObserver(function (mutations) {
            mutations.forEach(function (mutation) {
                if (mutation.attributeName !== "class") {
                    return;
                }
                var section = mutation.target;
                if (section.classList.contains("fade-in") && section.classList.contains("is-visible")) {
                    hyphenateWithin(section);
                }
            });
        });

        document.querySelectorAll(".fade-in").forEach(function (section) {
            observer.observe(section, { attributes: true, attributeFilter: ["class"] });
        });
    }

    function startHyphenopoly() {
        Hyphenopoly.config({
            require: {
                "en": "FORCEHYPHENOPOLY"
            },
            fallbacks: {
                "en": "en-us"
            },
            setup: {
                hide: "text",
                timeout: 3000,
                keepAlive: true,
                selectors: {
                    "#about p.bio-text": {},
                    "#career .no-bullet li": {},
                    "#achievements ol > li": {},
                    "#projects .project-description": {},
                    ".tool-card-description": {}
                }
            },
            handleEvent: {
                hyphenopolyEnd: watchFadeInSections
            }
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", startHyphenopoly, { once: true });
    } else {
        startHyphenopoly();
    }
})();
