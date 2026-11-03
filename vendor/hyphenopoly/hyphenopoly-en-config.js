/**
 * English page only: client-side hyphenation when native CSS hyphens are ineffective.
 * Hyphenopoly © Mathias Nater, MIT — see Hyphenopoly_Loader.js header.
 */
(function () {
    function revealHyphenationSections() {
        document.querySelectorAll("#about, #career, #achievements, #projects, #tools").forEach((section) => {
            section.classList.add("is-visible");
        });
    }

    function startHyphenopoly() {
        revealHyphenationSections();
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
                selectors: {
                    "#about p.bio-text": {},
                    "#career .no-bullet li": {},
                    "#achievements ol > li": {},
                    "#projects .project-description": {},
                    ".tool-card-description": {}
                }
            }
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", startHyphenopoly, { once: true });
    } else {
        startHyphenopoly();
    }
})();
