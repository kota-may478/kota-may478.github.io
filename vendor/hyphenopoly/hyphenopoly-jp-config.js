/**
 * Japanese page: hyphenate English runs marked with lang="en" only.
 * Hyphenopoly © Mathias Nater, MIT — see Hyphenopoly_Loader.js header.
 */
(function () {
    var JP_EN_SELECTOR = "[lang=\"en\"]";

    HyphenopolyPage.init({
        require: {
            "en": "FORCEHYPHENOPOLY"
        },
        fallbacks: {
            "en": "en-us"
        },
        hyphenSelectors: [JP_EN_SELECTOR],
        setupSelectors: {
            "[lang=\"en\"]": {}
        }
    });
})();
