# eleventy-plugin-react-static

A plugin for [the Eleventy static web site generator](https://www.11ty.dev/) that renders React JSX and TSX files to static HTML.

## Install it

Install the plugin in your Eleventy project:

```bash
npm install eleventy-plugin-react-static
```

You also need to install `react` and `react-dom` in your Eleventy project:

```bash
npm install react react-dom
```

## Initialise it

Initialise the plugin from your `.eleventy.js` Eleventy configuration file:

```javascript
const pluginReactStatic = require("eleventy-plugin-react-static");

module.exports = function(eleventyConfig) {
    eleventyConfig.addPlugin(pluginReactStatic);

    // ... Whatever other configuration you need ... 
};
```

## Create pages

Now you can create pages using JSX and TSX files.

Here's a quick example you can try out in your Eleventy project:

### `test.jsx`
```javascript
import React from "react";

export default (data) => {
    return (
        <div>
            <div>Hello world!</div>
            <div>{data.someOfYourData}</div>
        </div>
    );
};
```

Make sure you have a `default` export for the root component.

[Eleventy data](https://www.11ty.dev/docs/data/) is passed in as `props`.

## Adding front matter

Eleventy [front matter](https://www.11ty.dev/docs/data-frontmatter/) is exported via a `data` object. Here's an updated example:

### `test.jsx`
```javascript
import React from "react";

export const data = { // Exports front matter data.
    title: "My great page",
    layout: "main",
};

export default (data) => {
    return (
        <div>
            <div>Hello world!</div>
            <div>{data.someOfYourData}</div>
        </div>
    );
};
```

## Adding pagination

You can configuration Eleventy [pagination](https://www.11ty.dev/docs/pagination/) via the front matter.

Here's a simplified example to render blog posts. Note how the `permalink` field is a function in this example. This could also be an async function if required. 

### `post.jsx`
```javascript
import React from 'react';

export const data = {
    pagination: {
        data: "posts",
        size: 1,
        alias: "post",    
    },
    permalink: ({ post }) => `/post/${post.slug}/`,
    layout: "post",
};

export default ({ video }) => {
    return (
        <div>
            <h1>{post.title}</h2>
            <div>{post.body}</div>
        </div>
    )
}
```

## Using Eleventy less than version 1

If using less than Eleventy version 1, you need to enable "experimental" mode for Eleventy.

For MacOS/Linux:

```bash
export ELEVENTY_EXPERIMENTAL=true
```

For Windows:

```bash
set ELEVENTY_EXPERIMENTAL=true
```

## How does it build the code?

This plugin bundles your JSX and TSX code *in memory* using the amazing [esbuild](https://esbuild.github.io/).

## Resources

- Inspired by
  - https://github.com/kaicataldo/eleventy-plugin-react