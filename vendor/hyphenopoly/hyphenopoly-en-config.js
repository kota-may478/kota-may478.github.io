/**
 * English page: client-side hyphenation when native CSS hyphens are ineffective.
 * Hyphenopoly © Mathias Nater, MIT — see Hyphenopoly_Loader.js header.
 */
(function () {
    var EN_SELECTORS = [
        "#about p.bio-text",
        "#career .no-bullet li",
        "#achievements ol > li",
        "#projects .project-description",
        ".tool-card-description"
    ];

    HyphenopolyPage.init({
        require: {
            "en": "FORCEHYPHENOPOLY"
        },
        fallbacks: {
            "en": "en-us"
        },
        hyphenSelectors: EN_SELECTORS,
        setupSelectors: {
            "#about p.bio-text": {},
            "#career .no-bullet li": {},
            "#achievements ol > li": {},
            "#projects .project-description": {},
            ".tool-card-description": {}
        }
    });
})();
