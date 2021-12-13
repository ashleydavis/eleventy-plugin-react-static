const { randomUUID } = require('crypto');
const esbuild = require('esbuild');
const path = require("path");
const React = require("react");
const ReactDOMServer = require('react-dom/server');
const fs = require("fs-extra");

//
// Plugin entry point.
//
module.exports = (eleventyConfig, pluginConfig) => {
    eleventyConfig.addTemplateFormats("jsx");
    eleventyConfig.addExtension("jsx", {
        read: false, // Allows this plugin to read the file, returned from needsToReadFileContents()

        async getData(inputPath) {
            const component = await loadComponent(inputPath, undefined);
            return component.module.data;
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

                try {
                    const component = await loadComponent(inputPath, data);
                    const Component = React.createElement(
                        component.module.default,
                        cleanData(data),
                        null
                    );
                    let html = ReactDOMServer.renderToString(Component);

                    html = `
                        <div>
                            <div id="root">
                                ${html}
                            </div>
                            <script>
                                process = {
                                    env: { NODE_ENV: "production" }
                                };
                                ${component.code}
                            </script>
                         </div>
                    `;

                    return html;       
                }
                catch (err) {
                    console.error(`Error rendering React web page:`);
                    console.error(err);
                }
            };
        },    
    });
};

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
// Loads the component from the JSX template.
//
async function loadComponent(inputPath, data) {
    const resolvedFilePath = require.resolve(inputPath, { paths: [ process.cwd() ] });

    const baseName = randomUUID();
    const ssrBundleName = `${baseName}-ssr-bundle.js`;
    const ssrBundlePath = path.join(__dirname, "tmp", ssrBundleName);
    console.log(`Generating bundle to ${ssrBundlePath}`);

    await esbuild.build({
        entryPoints: [
            resolvedFilePath,
        ],
        bundle: true,
        platform: 'node',
        outfile: ssrBundlePath,
        loader: { '.client.js': 'text' },
        external: ['styled-components', 'react', 'react-dom'],
        plugins: [],
    });

    const hydrateSourcePath = path.join(__dirname, "tmp", `${baseName}-hydrate-source.js`);
    await fs.writeFile(hydrateSourcePath, `
        const component = require("./${ssrBundleName}");
        const React = require("react");
        const ReactDOM = require("react-dom");
        const App = React.createElement(
            component.default,
            ${cleanStringify(data)},
            null
        );
        ReactDOM.hydrate(App, document.getElementById("root"));
    `);

    console.log(`Hydrate source: ${hydrateSourcePath}`);

    const hydrateBundlePath = path.join(__dirname, "tmp", `${baseName}-hydrate-bundle.js`);
    console.log(`Generating hydrate bundle to ${hydrateBundlePath}`);

    await esbuild.build({
        entryPoints: [
            hydrateSourcePath,
        ],
        bundle: true,
        platform: 'node',
        outfile: hydrateBundlePath,
        loader: { '.client.js': 'text' },
        plugins: [],
    });

    return {
        code: await fs.readFile(hydrateBundlePath, "utf8"),
        module: module.require(ssrBundlePath),
    };
}
