const esbuild = require('esbuild');
const React = require("react");
const ReactDOMServer = require('react-dom/server');
const requireFromString = require('require-from-string');

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
                                ${component.clientSideCode}
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

    const serverSideRenderingResult = await esbuild.build({
        entryPoints: [
            inputPath,
        ],
        bundle: true,
        platform: 'node',
        external: ['react', 'react-dom'], // These are external because this bundle will be loaded in this process.
        plugins: [],
        write: false,
        absWorkingDir: process.cwd(),
    });

    const serverSideRenderingCode = serverSideRenderingResult.outputFiles[0].text;

    const clientSideCode = `
        const component = require("${inputPath}");
        const React = require("react");
        const ReactDOM = require("react-dom");
        const App = React.createElement(
            component.default,
            ${cleanStringify(data)},
            null
        );
        ReactDOM.hydrate(App, document.getElementById("root"));    
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

    const bundledClientSideCode = clientSideResult.outputFiles[0].text;

    return {
        clientSideCode: bundledClientSideCode,
        module: requireFromString(serverSideRenderingCode),
    };
}
