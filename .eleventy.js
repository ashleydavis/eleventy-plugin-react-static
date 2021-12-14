const esbuild = require('esbuild');
const requireFromString = require('require-from-string');

//
// Plugin entry point.
//
module.exports = (eleventyConfig, pluginConfig) => {
    const React = pluginConfig?.React || require("react");
    const ReactDOMServer = pluginConfig?.ReactDOMServer || require('react-dom/server');

    const rootId = pluginConfig.rootId || "root";

    eleventyConfig.addTemplateFormats("jsx");
    eleventyConfig.addExtension("jsx", {
        read: false, // Allows this plugin to read the file, returned from needsToReadFileContents()

        async getData(inputPath) {
            const serverSideRenderingCode = await bundleServerSideCode(inputPath);
            const serverSideComponent = requireFromString(serverSideRenderingCode, undefined);
            return serverSideComponent.data;
        },

        compile(str, inputPath, ...args) {

            // Renders the template.
            return async (data) => { 

                if (str) {
                    if (typeof str === "function") { // Renders string/function templates, e.g. "permalink".
                        const result = str(data);
                        if (result && typeof result.then === "function") {
                            // Assume it's a promise.
                            return await result;
                        }
                        else {
                            return result;
                        }
                    }
                    else {
                        return str;
                    }
                }

                const serverSideRenderingCode = await bundleServerSideCode(inputPath);
                const serverSideModule = requireFromString(serverSideRenderingCode, undefined);
                if (serverSideModule.default === undefined) {
                    throw new Error(`Page ${inputPath} doesn't export a "default" component.`);
                }

                const ServerSideComponent = React.createElement(
                    serverSideModule.default,
                    cleanData(data),
                    null
                );

                const clientHydrationCode = await bundleClientSideCode(inputPath, data, rootId);
                let staticHtml;
                try {
                    staticHtml = ReactDOMServer.renderToString(ServerSideComponent);
                }
                catch (err) {
                    console.error(`Error rendering React web page:`);
                    console.error(err);
                    throw new Error(`Failed to render React web page.`);
                }

                return `
                    <div>
                        <div id="${rootId}">
                            ${staticHtml}
                        </div>
                        <script>
                            process = {
                                env: { NODE_ENV: "production" }
                            };
                            ${clientHydrationCode}
                        </script>
                        </div>
                `;
            };
        },    
    });
};

//
// Clone an object omitting circular references.
//
function copyWithoutCircularReferences(references, object) {
    if (Array.isArray(object)) {
        const cleanArray = [];

        for (const value of object) {
            if (references.indexOf(value) < 0) {
                references.push(value);
                try {
                    cleanArray.push(copyWithoutCircularReferences(references, value));
                }
                finally {
                    references.pop();
                }
            }
        }

        return cleanArray;
    }
    else {
        const cleanObject = {};

        for (const key of Object.keys(object)) {
            
            if (key === "templateContent") {
                // Attempting to follow this "getter" causes an error to be thrown.
                return;
            }
    
            if (key[0] === "_") {
                // Don't follow "private" properties.
                return;
            }
    
            const value = object[key];
            if (value) {
                if (typeof value === 'object') {
                    if (references.indexOf(value) < 0) {
                        references.push(value);
                        try {
                            cleanObject[key] = copyWithoutCircularReferences(references, value);
                        }
                        finally {
                            references.pop();
                        }
                    } 
                } 
                else if (typeof value !== 'function') {
                    cleanObject[key] = value;
                }
            }
        }
    
        return cleanObject;
    }
}

//
// Stringify an object removing circular references and lazy evaluated properties.
// 
// https://stackoverflow.com/questions/4816099/chrome-sendrequest-error-typeerror-converting-circular-structure-to-json
//
function cleanStringify(object) {
    if (object && typeof object === 'object') {
        object = copyWithoutCircularReferences([object], object);
    }
    return JSON.stringify(object, null, 4);
}

//
// Create a clean copy of an object with no circular references and no lazy evaluated properties.
//
function cleanData(object) {
    return JSON.parse(cleanStringify(object));
}

//
// Bundles code for server side rendering.
//
async function bundleServerSideCode(inputPath) {
    const serverSideRenderingResult = await esbuild.build({
        entryPoints: [
            inputPath,
        ],
        bundle: true,
        platform: 'node',
        external: ['react', 'react-dom'],
        plugins: [],
        write: false,
        absWorkingDir: process.cwd(),
    });

    return serverSideRenderingResult.outputFiles[0].text;
}

//
// Bundles code for client side hydration.
//
async function bundleClientSideCode(inputPath, data, rootId) {
    const clientSideCode = `
        const component = require("${inputPath}");
        const React = require("react");
        const ReactDOM = require("react-dom");
        const App = React.createElement(
            component.default,
            ${cleanStringify(data)},
            null
        );
        ReactDOM.hydrate(App, document.getElementById("${rootId}"));    
    `;

    const clientSideResult = await esbuild.build({
        stdin: {
            contents: clientSideCode,
            resolveDir: process.cwd(),
        },
        bundle: true,
        plugins: [],
        write: false,
        absWorkingDir: process.cwd(),
    });

    return clientSideResult.outputFiles[0].text;
}

