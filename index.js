const getRoot = node => node.parent ? getRoot(node.parent) : node;

const isModuleExports = (t, node) => t.isIdentifier(node.object, { name: 'module' }) &&
  t.isIdentifier(node.property, { name: 'exports' });

const isModuleExportsId = (t, node) => t.isMemberExpression(node.object) &&
  t.isIdentifier(node.object.object, { name: 'module' }) &&
  t.isIdentifier(node.object.property, { name: 'exports' });

const isExports = (t, node) => t.isIdentifier(node.object, { name: 'exports' });

const notRequire = (t, nodePath) => {
  const [ requireArg, ...rest ] = nodePath.node.arguments;
  return nodePath.node.callee.name !== 'require' ||
    rest.length !== 0 ||
    !t.isStringLiteral(requireArg) ||
    nodePath.scope.hasBinding('require');
};

const requireVisitor = (t, rootPath) => ({
  CallExpression(nodePath) {
    if (notRequire(t, nodePath)) return;
    const [ requireArg ] = nodePath.node.arguments;
    const { value: modName } = requireArg;
    const mid = rootPath.scope.generateUidIdentifierBasedOnNode(modName);
    const importDecl = t.importDeclaration(
      [ t.importDefaultSpecifier(mid) ],
      t.stringLiteral(modName)
    );
    nodePath.replaceWith(mid);
    rootPath.node.body.unshift(importDecl);
  },
});

module.exports = function({ types: t }) {
  let commonjs = false;
  let umd = false;

  return {
    visitor: {
      AssignmentExpression(nodePath) {
        if (umd) return;
        const { left } = nodePath.node;
        if (
          t.isMemberExpression(left) && (
            (
              (isModuleExports(t, left) || isModuleExportsId(t, left)) &&
              !nodePath.scope.hasBinding('module')
            ) ||
            (isExports(t, left) && !nodePath.scope.hasBinding('exports'))
          )
        ) commonjs = true;
      },
      CallExpression(nodePath) {
        if (umd || notRequire(t, nodePath)) return;
        commonjs = true;
      },
      Program: {
        enter(nodePath) {
          commonjs = false;
          umd = false;
          const { body } = nodePath.node;
          const [ expr ] = body;
          if (
            body.length === 1 &&
            t.isExpressionStatement(expr) &&
            t.isCallExpression(expr.expression) &&
            t.isFunctionExpression(expr.expression.callee)
          ) {
            umd = true;
            for (const [ index, argument ] of expr.expression.arguments.slice().entries()) {
              if (t.isThisExpression(argument)) {
                expr.expression.arguments.splice(index, 1, t.identifier('self'));
              }
            }
          }
        },
        exit(nodePath) {
          if (!umd && commonjs) {
            const id = nodePath.scope.generateUidIdentifierBasedOnNode('module');
            const exportsId = t.identifier('exports');
            const mod = t.objectExpression([
              t.objectProperty(t.identifier('exports'), t.objectExpression([])),
            ]);
            const decl = t.variableDeclaration('const', [
              t.variableDeclarator(id, mod),
            ]);
            const wrap = t.expressionStatement(t.callExpression(
              t.functionExpression(null, [ t.identifier('module'), exportsId ], t.blockStatement(nodePath.node.body)),
              [ id, t.memberExpression(id, t.identifier('exports')) ]
            ));
            const final = t.exportDefaultDeclaration(t.memberExpression(id, t.identifier('exports')));
            nodePath.node.body = [ decl, wrap, final ];
            nodePath.traverse(requireVisitor(t, nodePath));
          }
        },
      },
    },
  };
};
