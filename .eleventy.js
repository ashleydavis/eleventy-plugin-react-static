const { randomUUID } = require('crypto');
const esbuild = require('esbuild');
const path = require("path");
const React = require("react");
const ReactDOMServer = require('react-dom/server');

//
// Plugin entry point.
//
module.exports = (eleventyConfig, pluginConfig) => {
    eleventyConfig.addTemplateFormats("jsx");
    eleventyConfig.addExtension("jsx", {
        read: false, // Allows this plugin to read the file, returned from needsToReadFileContents()

        async getData(inputPath) {
            const component = await loadComponent(inputPath);
            return component.data;
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
                    const component = await loadComponent(inputPath);
                    const mergedData = {
                        functions: this.config.javascriptFunctions,
                        ...data,
                    };

                    const Component = React.createElement(
                        component.default,
                        mergedData,
                        null
                    );
                    const html = ReactDOMServer.renderToStaticMarkup(Component);
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

//
// Loads the component from the JSX template.
//
async function loadComponent(inputPath) {
    const resolvedFilePath = require.resolve(inputPath, { paths: [ process.cwd() ] });

    const outputFileName = randomUUID() + ".js";
    const outputFilePath = path.join(process.cwd(), "tmp", outputFileName);

    await esbuild.build({
        entryPoints: [
            resolvedFilePath,
        ],
        bundle: true,
        platform: 'node',
        outfile: outputFilePath,
        loader: { '.client.js': 'text' },
        external: ['styled-components', 'react', 'react-dom'],
        plugins: [],
    });

    return module.require(outputFilePath); 
}
