// Dependencies
// =============================================================================
import getCssData          from 'get-css-data';
import transformCss        from './transform-css';
import { fixVarObjNames }  from './transform-css';
import { variableStore }   from './transform-css';


// Constants & Variables
// =============================================================================
const isBrowser       = typeof window !== 'undefined';
const isNativeSupport = isBrowser && window.CSS && window.CSS.supports && window.CSS.supports('(--a: 0)');

const defaults = {
    // Targets
    rootElement  : isBrowser ? document : null,
    shadowDOM    : false,
    // Sources
    include      : 'style,link[rel=stylesheet]',
    exclude      : '',
    variables    : {},    // transformCss
    // Options
    fixNestedCalc: true,  // transformCss
    onlyLegacy   : true,  // cssVars
    onlyVars     : false, // cssVars, parseCSS
    preserve     : false, // transformCss
    silent       : false, // cssVars
    updateDOM    : true,  // cssVars
    updateURLs   : true,  // cssVars
    watch        : null,  // cssVars
    // Callbacks
    onBeforeSend() {},    // cssVars
    onSuccess() {},       // cssVars
    onWarning() {},       // transformCss
    onError() {},         // cssVars
    onComplete() {}       // cssVars
};
const regex = {
    // CSS comments
    cssComments: /\/\*[\s\S]+?\*\//g,
    // CSS keyframes (@keyframes & @-VENDOR-keyframes)
    cssKeyframes: /@(?:-\w*-)?keyframes/,
    // CSS root vars
    cssRootRules: /(?::root\s*{\s*[^}]*})/g,
    // CSS url(...) values
    cssUrls: /url\((?!['"]?(?:data|http|\/\/):)['"]?([^'")]*)['"]?\)/g,
    // CSS variable declarations
    cssVarDecls: /(?:[\s;]*)(-{2}\w[\w-]*)(?:\s*:\s*)([^;]*);/g,
    // CSS variable :root declarations and var() function values
    cssVars: /(?:(?::root\s*{\s*[^;]*;*\s*)|(?:var\(\s*))(--[^:)]+)(?:\s*[:)])/
};
const styleNodeAttr       = 'data-cssvars';
const styleNodeAttrInVal  = 'in';
const styleNodeAttrOutVal = 'out';

// Counter used to track ponyfill executions and generate date attribute values
let cssVarsCounter = 0;

// Mutation observer reference created via options.watch
let cssVarsObserver = null;

// Debounce timer used with options.watch
let debounceTimer = null;

// Indicates if document-level custom property values have been parsed, stored,
// and ready for use with options.shadowDOM
let isShadowDOMReady = false;


// Functions
// =============================================================================
/**
 * Fetches, parses, and transforms CSS custom properties from specified
 * <style> and <link> elements into static values, then appends a new <style>
 * element with static values to the DOM to provide CSS custom property
 * compatibility for legacy browsers. Also provides a single interface for
 * live updates of runtime values in both modern and legacy browsers.
 *
 * @preserve
 * @param {object}   [options] Options object
 * @param {object}   [options.rootElement=document] Root element to traverse for
 *                   <link> and <style> nodes.
 * @param {boolean}  [options.shadowDOM=false] Determines if shadow DOM <link>
 *                   and <style> nodes will be processed.
 * @param {string}   [options.include="style,link[rel=stylesheet]"] CSS selector
 *                   matching <link re="stylesheet"> and <style> nodes to
 *                   process
 * @param {string}   [options.exclude] CSS selector matching <link
 *                   rel="stylehseet"> and <style> nodes to exclude from those
 *                   matches by options.include
 * @param {object}   [options.variables] A map of custom property name/value
 *                   pairs. Property names can omit or include the leading
 *                   double-hyphen (—), and values specified will override
 *                   previous values.
 * @param {boolean}  [options.fixNestedCalc=true] Removes nested 'calc' keywords
 *                   for legacy browser compatibility.
 * @param {boolean}  [options.onlyLegacy=true] Determines if the ponyfill will
 *                   only generate legacy-compatible CSS in browsers that lack
 *                   native support (i.e., legacy browsers)
 * @param {boolean}  [options.onlyVars=false] Determines if CSS rulesets and
 *                   declarations without a custom property value should be
 *                   removed from the ponyfill-generated CSS
 * @param {boolean}  [options.preserve=false] Determines if the original CSS
 *                   custom property declaration will be retained in the
 *                   ponyfill-generated CSS.
 * @param {boolean}  [options.silent=false] Determines if warning and error
 *                   messages will be displayed on the console
 * @param {boolean}  [options.updateDOM=true] Determines if the ponyfill will
 *                   update the DOM after processing CSS custom properties
 * @param {boolean}  [options.updateURLs=true] Determines if the ponyfill will
 *                   convert relative url() paths to absolute urls.
 * @param {boolean}  [options.watch=false] Determines if a MutationObserver will
 *                   be created that will execute the ponyfill when a <link> or
 *                   <style> DOM mutation is observed.
 * @param {function} [options.onBeforeSend] Callback before XHR is sent. Passes
 *                   1) the XHR object, 2) source node reference, and 3) the
 *                   source URL as arguments.
 * @param {function} [options.onSuccess] Callback after CSS data has been
 *                   collected from each node and before CSS custom properties
 *                   have been transformed. Allows modifying the CSS data before
 *                   it is transformed by returning any string value (or false
 *                   to skip). Passes 1) CSS text, 2) source node reference, and
 *                   3) the source URL as arguments.
 * @param {function} [options.onWarning] Callback after each CSS parsing warning
 *                   has occurred. Passes 1) a warning message as an argument.
 * @param {function} [options.onError] Callback after a CSS parsing error has
 *                   occurred or an XHR request has failed. Passes 1) an error
 *                   message, and 2) source node reference, 3) xhr, and 4 url as
 *                   arguments.
 * @param {function} [options.onComplete] Callback after all CSS has been
 *                   processed, legacy-compatible CSS has been generated, and
 *                   (optionally) the DOM has been updated. Passes 1) a CSS
 *                   string with CSS variable values resolved, 2) a reference to
 *                   the appended <style> node, 3) an object containing all
 *                   custom properies names and values, and 4) the ponyfill
 *                   execution time in milliseconds.
 *
 * @example
 *
 *   cssVars({
 *     rootElement  : document,
 *     shadowDOM    : false,
 *     include      : 'style,link[rel="stylesheet"]',
 *     exclude      : '',
 *     variables    : {},
 *     fixNestedCalc: true,
 *     onlyLegacy   : true,
 *     onlyVars     : false,
 *     preserve     : false,
 *     silent       : false,
 *     updateDOM    : true,
 *     updateURLs   : true,
 *     watch        : false,
 *     onBeforeSend(xhr, node, url) {},
 *     onSuccess(cssText, node, url) {},
 *     onWarning(message) {},
 *     onError(message, node, xhr, url) {},
 *     onComplete(cssText, styleNode, cssVariables, benchmark) {}
 *   });
 */
function cssVars(options = {}) {
    const msgPrefix = 'cssVars(): ';
    const settings  = Object.assign({}, defaults, options);

    // Always exclude styleNodeAttr elements (the generated <style> nodes
    // containing previously transformed CSS and previously processed nodes)
    settings.exclude = `[${styleNodeAttr}]` + (settings.exclude ? `,${settings.exclude}` : '');

    // If benchmark key is not availalbe, this is the first call (not recursive)
    if (!settings.__benchmark) {
        settings.variables = fixVarObjNames(settings.variables);
    }

    // Store benchmark start time
    settings.__benchmark = !settings.__benchmark ? getTimeStamp() : settings.__benchmark;

    function handleError(message, sourceNode, xhr, url) {
        /* istanbul ignore next */
        if (!settings.silent) {
            // eslint-disable-next-line
            console.error(`${msgPrefix}${message}\n`, sourceNode);
        }

        settings.onError(message, sourceNode, xhr, url);
    }

    function handleWarning(message) {
        /* istanbul ignore next */
        if (!settings.silent) {
            // eslint-disable-next-line
            console.warn(`${msgPrefix}${message}`);
        }

        settings.onWarning(message);
    }

    // Exit if non-browser environment (e.g. Node)
    if (!isBrowser) {
        return;
    }

    // Disconnect existing MutationObserver
    if (settings.watch === false && cssVarsObserver) {
        cssVarsObserver.disconnect();
    }

    // Add / recreate MutationObserver
    if (settings.watch) {
        addMutationObserver(settings);
        cssVarsDebounced(settings, 100);
    }
    // Verify readyState to ensure all <link> and <style> nodes are available
    else if (document.readyState !== 'loading') {
        const isShadowElm = settings.shadowDOM || settings.rootElement.shadowRoot || settings.rootElement.host;

        // Native support
        if (isNativeSupport && settings.onlyLegacy) {
            // Apply settings.variables
            if (settings.updateDOM) {
                const targetElm = settings.rootElement.host || (settings.rootElement === document ? document.documentElement : settings.rootElement);

                // Set variables using native methods
                Object.keys(settings.variables).forEach(key => {
                    targetElm.style.setProperty(key, settings.variables[key]);
                });
            }
        }
        // Ponyfill: Handle rootElement set to a shadow host or root
        else if (isShadowElm && !isShadowDOMReady) {
            // Get all document-level CSS
            getCssData({
                rootElement: defaults.rootElement,
                include: defaults.include,
                exclude: settings.exclude,
                onSuccess(cssText, node, url) {
                    const cssRootRules = (cssText.match(regex.cssRootRules) || []).join('');

                    // Return only matching :root {...} blocks
                    return cssRootRules || false;
                },
                onComplete(cssText, cssArray, nodeArray) {
                    // Transform CSS, which stores custom property values from
                    // cssText in variableStore. This step ensures that
                    // variableStore contains all document-level custom property
                    // values for subsequent ponyfill calls.
                    transformCss(cssText, {
                        persist: true
                    });

                    isShadowDOMReady = true;

                    // Call the ponyfill again to process the rootElement
                    // initially specified. Values stored in variableStore will
                    // be used to transform values in shadow host/root elements.
                    cssVars(settings);
                }
            });
        }
        // Ponyfill: Process CSS
        else {
            getCssData({
                rootElement: settings.rootElement,
                include: settings.include,
                exclude: settings.exclude,
                // This filter does a test on each block of CSS. An additional
                // filter is used in the parser to remove individual
                // declarations.
                filter: settings.onlyVars ? regex.cssVars : null,
                onBeforeSend: settings.onBeforeSend,
                onSuccess(cssText, node, url) {
                    const returnVal = settings.onSuccess(cssText, node, url);

                    cssText = returnVal !== undefined && Boolean(returnVal) === false ? '' : returnVal || cssText;

                    // Convert relative url(...) values to absolute
                    if (settings.updateURLs) {
                        const cssUrls = cssText
                        // Remove comments to avoid processing @import in comments
                            .replace(regex.cssComments, '')
                            // Match url(...) values
                            .match(regex.cssUrls) || [];

                        cssUrls.forEach(cssUrl => {
                            const oldUrl = cssUrl.replace(regex.cssUrls, '$1');
                            const newUrl = getFullUrl(oldUrl, url);

                            cssText = cssText.replace(cssUrl, cssUrl.replace(oldUrl, newUrl));
                        });
                    }

                    return cssText;
                },
                onError(xhr, node, url) {
                    const responseUrl = xhr.responseURL || getFullUrl(url, location.href);
                    const statusText  = xhr.statusText ? `(${xhr.statusText})` : 'Unspecified Error' + (xhr.status === 0 ? ' (possibly CORS related)' : '');
                    const errorMsg    = `CSS XHR Error: ${responseUrl} ${xhr.status} ${statusText}`;

                    handleError(errorMsg, node, xhr, responseUrl);
                },
                onComplete(cssText, cssArray, nodeArray = []) {
                    const prevInNodes    = settings.rootElement.querySelectorAll(`[${styleNodeAttr}*="${styleNodeAttrInVal}"]`);
                    const hasPrevVarDecl = Boolean(
                        // In settings.variables
                        Object.keys(settings.variables).some(key => {
                            const isSameProp  = variableStore.dom.hasOwnProperty(key);
                            const isSameValue = isSameProp && variableStore.dom[key] !== settings.variables[key];

                            return isSameProp && isSameValue;
                        }) ||
                        // In cssText
                        (function hasPrevVarInCSS() {
                            const cssRootRules = (cssText.match(regex.cssRootRules) || []).join('');

                            let cssVarDeclsMatch;

                            while((cssVarDeclsMatch = regex.cssVarDecls.exec(cssRootRules)) !== null) {
                                const prop        = cssVarDeclsMatch[1];
                                const value       = cssVarDeclsMatch[2];
                                const isSameProp  = variableStore.dom.hasOwnProperty(prop);
                                const isSameValue = isSameProp && variableStore.dom[prop] !== value;

                                if (isSameProp && isSameValue) {
                                    return true;
                                }
                            }
                        })()
                    );

                    // Full Update
                    if (hasPrevVarDecl) {
                        // Remove mark from previously processed nodes
                        for (let i = 0, len = prevInNodes.length; i < len; i++) {
                            prevInNodes[i].removeAttribute(styleNodeAttr);
                        }

                        // Add full update flag
                        settings.__fullUpdate = true;

                        cssVars(settings);
                    }
                    // Progressive Update
                    else {
                        const cssMarker = /\/\*__CSSVARSPONYFILL-(\d+)__\*\//g;
                        let hasKeyframesWithVars;

                        // Concatenate cssArray items, replacing those that do
                        // not contain a CSS custom property declaraion or
                        // function with a temporary marker . After the CSS is
                        // transformed, the markers will be replaced with the
                        // matching cssArray item. This optimization is done to
                        // avoid processing CSS that will not change as a
                        // results of the ponyfill.
                        cssText = cssArray.map((css, i) => regex.cssVars.test(css) ? css : `/*__CSSVARSPONYFILL-${i}__*/`).join('');

                        try {
                            cssText = transformCss(cssText, {
                                fixNestedCalc: settings.fixNestedCalc,
                                onlyVars     : settings.onlyVars,
                                persist      : settings.updateDOM,
                                preserve     : settings.preserve,
                                variables    : settings.variables,
                                onWarning    : handleWarning
                            });

                            hasKeyframesWithVars = regex.cssKeyframes.test(cssText);

                            // Replace markers with appropriate cssArray item
                            cssText = cssText.replace(cssMarker, (match, group1) => cssArray[group1]);
                        }
                        catch(err) {
                            let errorThrown = false;

                            // Iterate cssArray to detect CSS text and node(s)
                            // responsibile for error.
                            cssArray.forEach((cssText, i) => {
                                try {
                                    cssText = transformCss(cssText, settings);
                                }
                                catch(err) {
                                    const errorNode = nodeArray[i - 0];

                                    errorThrown = true;
                                    handleError(err.message, errorNode);
                                }
                            });

                            // In the event the error thrown was not due to
                            // transformCss, handle the original error.
                            /* istanbul ignore next */
                            if (!errorThrown) {
                                handleError(err.message || err);
                            }
                        }

                        // Process shadow DOM
                        if (settings.shadowDOM) {
                            const elms = [
                                settings.rootElement,
                                ...settings.rootElement.querySelectorAll('*')
                            ];

                            // Iterates over all elements in rootElement and calls
                            // cssVars on each shadowRoot, passing document-level
                            // custom properties as options.variables.
                            for (let i = 0, elm; (elm = elms[i]); ++i) {
                                if (elm.shadowRoot && elm.shadowRoot.querySelector('style')) {
                                    const shadowSettings = Object.assign({}, settings, {
                                        rootElement: elm.shadowRoot,
                                        variables  : variableStore.dom
                                    });

                                    cssVars(shadowSettings);
                                }
                            }
                        }

                        if (cssText.length || nodeArray.length) {
                            const cssNodes  = nodeArray || settings.rootElement.querySelectorAll('link[rel*="stylesheet"],style');
                            const lastNode  = cssNodes ? cssNodes[cssNodes.length - 1] : null;
                            let styleNode = null;

                            if (settings.updateDOM) {
                                // Increment ponyfill counter
                                cssVarsCounter++;

                                styleNode = document.createElement('style');

                                // Set in/out and job number as data attributes
                                styleNode.setAttribute(`${styleNodeAttr}-job`, cssVarsCounter);
                                styleNode.setAttribute(styleNodeAttr, styleNodeAttrOutVal);
                                nodeArray.forEach(node => {
                                    node.setAttribute(`${styleNodeAttr}-job`, cssVarsCounter);
                                    node.setAttribute(styleNodeAttr, styleNodeAttrInVal);
                                });

                                // Insert ponyfill <style> after last node
                                if (lastNode) {
                                    lastNode.parentNode.insertBefore(styleNode, lastNode.nextSibling);
                                }
                                // Insert ponyfill <style> after last link/style node
                                else {
                                    const targetNode = settings.rootElement.head || settings.rootElement.body || settings.rootElement;

                                    targetNode.appendChild(styleNode);
                                }

                                if (settings.__fullUpdate) {
                                    const prevOutNodes = settings.rootElement.querySelectorAll(`[${styleNodeAttr}*="${styleNodeAttrOutVal}"]`);

                                    // Remove previous output <style> nodes
                                    for (let i = 0, len = prevOutNodes.length; i < len; i++) {
                                        const node = prevOutNodes[i];

                                        if (node !== styleNode) {
                                            node.parentNode.removeChild(node);
                                        }
                                    }
                                }
                            }

                            // Callback and get (optional) return value
                            cssText = settings.onComplete(
                                cssText,
                                styleNode,
                                JSON.parse(JSON.stringify(settings.updateDOM ? variableStore.dom : variableStore.temp)),
                                getTimeStamp() - settings.__benchmark
                            ) || cssText;

                            if (settings.updateDOM) {
                                styleNode.textContent = cssText;

                                if (hasKeyframesWithVars) {
                                    fixKeyframes(settings.rootElement);
                                }
                            }
                        }
                    }
                }
            });
        }
    }
    // Delay function until DOMContentLoaded event is fired
    /* istanbul ignore next */
    else {
        document.addEventListener('DOMContentLoaded', function init(evt) {
            cssVars(options);

            document.removeEventListener('DOMContentLoaded', init);
        });
    }
}


// Functions (Private)
// =============================================================================
/**
 * Creates mutation observer that executes the ponyfill when a <link> or <style>
 * DOM mutation is observed.
 *
 * @param {object} settings
 */
function addMutationObserver(settings) {
    if (!window.MutationObserver) {
        return;
    }

    const isLink  = node => node.tagName === 'LINK' && (node.getAttribute('rel') || '').indexOf('stylesheet') !== -1;
    const isStyle = node => node.tagName === 'STYLE' && !node.hasAttribute(styleNodeAttr);

    if (cssVarsObserver) {
        cssVarsObserver.disconnect();
    }

    settings.watch = defaults.watch;

    cssVarsObserver = new MutationObserver(function(mutations) {
        const hasCSSMutation = mutations.some((mutation) => {
            let isCSSMutation = false;

            if (mutation.type === 'attributes') {
                isCSSMutation = isLink(mutation.target) || isStyle(mutation.target);
            }
            else if (mutation.type === 'childList') {
                const addedNodes   = Array.apply(null, mutation.addedNodes);
                const removedNodes = Array.apply(null, mutation.removedNodes);

                isCSSMutation = [].concat(addedNodes, removedNodes).some(node => {
                    const isValidLink  = isLink(node) && !node.disabled;
                    const isValidStyle = isStyle(node) && regex.cssVars.test(node.textContent);

                    return (isValidLink || isValidStyle);
                });
            }

            return isCSSMutation;
        });

        if (hasCSSMutation) {
            clearTimeout(debounceTimer);
            cssVars(settings);
        }
    });

    cssVarsObserver.observe(document.documentElement, {
        attributes     : true,
        attributeFilter: ['disabled', 'href'],
        childList      : true,
        subtree        : true
    });
}

/**
 * Debounces cssVars() calls
 *
 * @param {object} settings
 */
function cssVarsDebounced(settings, timeout) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function() {
        settings.__benchmark = null;
        cssVars(settings);
    }, timeout);
}

/**
 * Fixes issue with keyframe properties set using CSS custom property not being
 * applied properly in some legacy (IE) and modern (Safari) browsers.
 *
 * @param {object} rootElement
 */
function fixKeyframes(rootElement) {
    const animationNameProp = [
        'animation-name',
        '-moz-animation-name',
        '-webkit-animation-name'
    ].filter(prop => getComputedStyle(document.body)[prop])[0];

    if (animationNameProp) {
        const allNodes      = rootElement.getElementsByTagName('*');
        const keyframeNodes = [];
        const nameMarker    = '__CSSVARSPONYFILL-KEYFRAMES__';

        // Modify animation name
        for (let i = 0, len = allNodes.length; i < len; i++) {
            const node          = allNodes[i];
            const animationName = getComputedStyle(node)[animationNameProp];

            if (animationName !== 'none') {
                node.style[animationNameProp] += nameMarker;
                keyframeNodes.push(node);
            }
        }

        // Force reflow
        void document.body.offsetHeight;

        // Restore animation name
        for (let i = 0, len = keyframeNodes.length; i < len; i++) {
            const nodeStyle = keyframeNodes[i].style;

            nodeStyle[animationNameProp] = nodeStyle[animationNameProp].replace(nameMarker, '');
        }
    }
}

/**
 * Returns fully qualified URL from relative URL and (optional) base URL
 *
 * @param   {string} url
 * @param   {string} [base=location.href]
 * @returns {string}
 */
function getFullUrl(url, base = location.href) {
    const d = document.implementation.createHTMLDocument('');
    const b = d.createElement('base');
    const a = d.createElement('a');

    d.head.appendChild(b);
    d.body.appendChild(a);
    b.href = base;
    a.href = url;

    return a.href;
}

/**
 * Returns a time stamp in milliseconds
 *
 * @returns {number}
 */
function getTimeStamp() {
    return isBrowser && window.performance.now ? performance.now() : new Date().getTime();
}


// Export
// =============================================================================
export default cssVars;
