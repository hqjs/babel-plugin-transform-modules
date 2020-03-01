# https://hqjs.org
Transform CommonJS modules files into ES modules

# Installation
```sh
npm install hqjs@babel-plugin-transform-modules
```

# Transformation
Can recognise UMD files and mixed `import`, `export` with `require` statements. Turns dynamic require into static imports. Transforms double `default`.

It will turn
```js
import a from 'a';
import b from 'b';

let t;
if (process.env.NODE_ENV === 'production') {
  require('x');
} else {
  t = require('y');
}

import 'w';

export const z = 0;

export default class A {};

exports.q = 1;

exports.default = {t};

module.exports = {a};
```
into
```js
import a from 'a';
import b from 'b';
import "x";
import _ref2 from "y";
import 'w';
const _ref = {
  exports: {}
};

(function (module, exports) {
  let t;

  if (process.env.NODE_ENV === 'production') {} else {
    t = _ref2;
  }

  exports.z = 0;
  module.exports = Object.assign(class A {}, exports);
  ;
  exports.q = 1;
  module.exports = Object.assign(exports, {
    t
  });
  module.exports = {
    a
  };
})(_ref, _ref.exports);

export default _ref.exports;
```
