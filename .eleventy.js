const esbuild = require('esbuild');
const requireFromString = require('require-from-string');

//
// Plugin entry point.
//
module.exports = (eleventyConfig, pluginConfig) => {
    const React = pluginConfig?.React || require("react");
    const ReactDOMServer = pluginConfig?.ReactDOMServer || require('react-dom/server');

    const rootId = pluginConfig?.rootId || "root";
    const mode = pluginConfig?.mode || "hydrate";
    const minify = pluginConfig?.minify != undefined ? pluginConfig.minify : true;

    let exts = pluginConfig?.ext || ["tsx", "jsx"];
    if (typeof exts === "string") {
        exts = [ exts ]; // Wraps a single string in a one-element array.
    }

    const validModes = ["hydrate", "static", "dynamic"];
    if (!validModes.includes(mode)) {
        throw new Error(`Invalid mode ${mode}, should be one of: ${validModes.join(", ")}`);
    }

    const extConfig = {
        read: false, // Allows this plugin to read the file, returned from needsToReadFileContents()

        async getData(inputPath) {
            const serverSideRenderingCode = await bundleServerSideCode(inputPath, { minify });
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

                if (mode === "static") {
                    const ServerSideComponent = await instantiateServerSideComponent(inputPath, React, data, { minify });
                    return generateStaticCode(ServerSideComponent, ReactDOMServer);
                }
                else if (mode === "dynamic") {
                    return await generateDynamicCode(inputPath, data, { rootId, minify });  
                }
                else {
                    const ServerSideComponent = await instantiateServerSideComponent(inputPath, React, data, { minify });
                    return await generateHydrateCode(ReactDOMServer, ServerSideComponent, inputPath, data, { rootId, minify });
                }
            };
        },    
    };

    for (const ext of exts) {
        eleventyConfig.addTemplateFormats(ext);
        eleventyConfig.addExtension(ext, extConfig);
    }
};

//
// Instantiates the React component for server side rendering.
//
async function instantiateServerSideComponent(inputPath, React, data, options) {
    const serverSideRenderingCode = await bundleServerSideCode(inputPath, options);
    const serverSideModule = requireFromString(serverSideRenderingCode, undefined);
    if (serverSideModule.default === undefined) {
        throw new Error(`Page ${inputPath} doesn't export a "default" component.`);
    }

    const ServerSideComponent = React.createElement(
        serverSideModule.default,
        cleanData(data),
        null
    );
    return ServerSideComponent;
}

//
// Generates static HTML from a React component.
// Removes all trace of React from the client.
//
async function generateStaticCode(ServerSideComponent, ReactDOMServer) {
    try {
        return ReactDOMServer.renderToStaticMarkup(ServerSideComponent);
    }
    catch (err) {
        console.error(`Error rendering React web page:`);
        console.error(err);
        throw new Error(`Failed to render React web page.`);
    }
}

//
// Generates code for a dynamic (client side rendered) React page.
//
async function generateDynamicCode(inputPath, data, options) {
    const clientHydrationCode = await bundleClientSideCode(inputPath, data, `render`, options);
    return `
        <div>
            <div id="${options.rootId}"></div>
            <script>
                process = {
                    env: { NODE_ENV: "production" }
                };
                ${clientHydrationCode}
            </script>
            </div>
    `;
}

//
// Generates code to hydrate a statically rendered React page.
//
async function generateHydrateCode(ReactDOMServer, ServerSideComponent, inputPath, data, options) {
    let staticHtml;
    try {
        staticHtml = ReactDOMServer.renderToString(ServerSideComponent);
    }
    catch (err) {
        console.error(`Error rendering React web page:`);
        console.error(err);
        throw new Error(`Failed to render React web page.`);
    }

    const clientHydrationCode = await bundleClientSideCode(inputPath, data, `hydrate`, options);
    return `
        <div>
            <div id="${options.rootId}">
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
}

//
// Copy a value that may or may not be an object.
//
function copyValue(references, value) {
    if (value === undefined || value === null) {
        return undefined
    }

    if (typeof value === 'object') {
        if (references.indexOf(value) < 0) {
            references.push(value);
            try {
                return copyObject(references, value);
            }
            finally {
                references.pop();
            }
        } 
    } 
    else if (typeof value !== 'function') {
        return value;
    }
    else {
        return undefined;
    }
}

//
// Copy an object omitting circular references.
//
function copyObject(references, object) {

    if (Array.isArray(object)) {
        const cleanArray = [];

        for (const element of object) {
            const cleanValue = copyValue(references, element);
            if (cleanValue !== undefined) {
                cleanArray.push(cleanValue);
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

            const cleanValue = copyValue(references, object[key]);
            if (cleanValue !== undefined) {
                cleanObject[key] = cleanValue;
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
        object = copyObject([object], object);
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
async function bundleServerSideCode(inputPath, options) {
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
        minify: options.minify,
    });

    return serverSideRenderingResult.outputFiles[0].text;
}

//
// Bundles code for client side hydration.
//
async function bundleClientSideCode(inputPath, data, method, options) {
    const clientSideCode = `
        const component = require("${inputPath}");
        const React = require("react");
        const ReactDOM = require("react-dom");
        const App = React.createElement(
            component.default,
            ${cleanStringify(data)},
            null
        );
        ReactDOM.${method}(App, document.getElementById("${options.rootId}"));    
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
        minify: options.minify,
    });

    return clientSideResult.outputFiles[0].text;
}

