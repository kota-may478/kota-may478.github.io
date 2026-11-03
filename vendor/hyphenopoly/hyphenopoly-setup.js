/**
 * Shared Hyphenopoly bootstrap: fade-in safe hyphenation retry on .fade-in sections.
 * Hyphenopoly © Mathias Nater, MIT — see Hyphenopoly_Loader.js header.
 */
(function (global) {
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

    function createFadeInWatch(hyphenSelectors) {
        function hyphenateWithin(root) {
            // Hyphenopoly_Loader stores hyphenators in a Map of deferred Promises
            // (defProm). hyphenators.HTML resolves to the DOM hyphenator function.
            var htmlHyphenator = global.Hyphenopoly &&
                Hyphenopoly.hyphenators &&
                Hyphenopoly.hyphenators.HTML;
            if (!htmlHyphenator || typeof htmlHyphenator.then !== "function") {
                return;
            }
            hyphenSelectors.forEach(function (sel) {
                root.querySelectorAll(sel).forEach(function (el) {
                    htmlHyphenator.then(function (fn) {
                        if (typeof fn === "function" && countSoftHyphens(el) === 0) {
                            fn(el, sel);
                        }
                    });
                });
            });
        }

        return function watchFadeInSections() {
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
        };
    }

    function initHyphenopoly(pageConfig) {
        var watchFadeInSections = createFadeInWatch(pageConfig.hyphenSelectors);

        Hyphenopoly.config({
            require: pageConfig.require,
            fallbacks: pageConfig.fallbacks,
            setup: {
                hide: "text",
                timeout: 3000,
                keepAlive: true,
                selectors: pageConfig.setupSelectors
            },
            handleEvent: {
                hyphenopolyEnd: watchFadeInSections
            }
        });
    }

    global.HyphenopolyPage = {
        init: function (pageConfig) {
            function start() {
                initHyphenopoly(pageConfig);
            }
            if (document.readyState === "loading") {
                document.addEventListener("DOMContentLoaded", start, { once: true });
            } else {
                start();
            }
        }
    };
})(window);
