const getRoot = node => node.parent ? getRoot(node.parent) : node;

const isModuleExports = (t, node) => t.isIdentifier(node.object, { name: 'module' }) &&
  t.isIdentifier(node.property, { name: 'exports' });

const isModuleExportsId = (t, node) => t.isMemberExpression(node.object) &&
  t.isIdentifier(node.object.object, { name: 'module' }) &&
  t.isIdentifier(node.object.property, { name: 'exports' });

const isExports = (t, node) => t.isIdentifier(node.object, { name: 'exports' });

const isExportDefault = (t, node) => t.isIdentifier(node.object, { name: 'exports' }) &&
  t.isIdentifier(node.property, { name: 'default' })

const notRequire = (t, nodePath) => {
  const [requireArg, ...rest] = nodePath.node.arguments;
  return nodePath.node.callee.name !== 'require' ||
    rest.length !== 0 ||
    !t.isStringLiteral(requireArg) ||
    nodePath.scope.hasBinding('require');
};

const esVisitor = (index, t, rootPath, {exports, moduleExports, objectAssign, latestExport, exportsMap}) => ({
  CallExpression(nodePath) {
    if (notRequire(t, nodePath)) return;
    const [requireArg] = nodePath.node.arguments;
    const { value: modName } = requireArg;
    const { parent } = nodePath;
    if (t.isExpressionStatement(parent)) {
      const importDecl = t.importDeclaration(
        [],
        t.stringLiteral(modName)
      );
      nodePath.remove();
      rootPath.node.body.splice(index.value, 0, importDecl);
    } else {
      const mid = rootPath.scope.generateUidIdentifierBasedOnNode(modName);
      const importDecl = t.importDeclaration(
        [t.importDefaultSpecifier(mid)],
        t.stringLiteral(modName)
      );
      nodePath.replaceWith(mid);
      rootPath.node.body.splice(index.value, 0, importDecl);
    }
    index.value++;
  },
  ImportDeclaration(nodePath) {
    const { node } = nodePath;
    rootPath.node.body.splice(index.value, 0, node);
    index.value++;
    nodePath.remove();
  },
  ExportNamedDeclaration(nodePath) {
    const { declaration } = nodePath.node;
    const [ declarator ] = declaration.declarations;
    if (latestExport.start < declaration.start) {
      latestExport.path = nodePath;
      latestExport.start = declaration.start;
    }
    nodePath.replaceWith(t.assignmentExpression(
      '=',
      t.memberExpression(exports, declarator.id),
      declarator.init
    ));
  },
  ExportDefaultDeclaration(nodePath) {
    if(t.isProgram(nodePath.parent)) return;
    const { declaration } = nodePath.node;
    if (
      t.isExpression(declaration) &&
      !t.isArrowFunctionExpression(declaration) &&
      !t.isObjectExpression(declaration) &&
      !t.isArrayExpression(declaration) &&
      !t.isNewExpression(declaration)
    ) {
      nodePath.replaceWith(t.assignmentExpression(
        '=',
        moduleExports,
        declaration
      ));
    } else {
      if (declaration.id != null) {
        nodePath.replaceWith(declaration);
        exportsMap.set(nodePath, t.expressionStatement(t.assignmentExpression(
            '=',
            moduleExports,
            t.callExpression(objectAssign, [declaration.id, exports])
          )));
      } else {
        const expression = t.isClassDeclaration(declaration) ?
          t.classExpression(declaration.id, declaration.superClass, declaration.body, declaration.decorators) :
          t.isFunctionDeclaration(declaration) ?
            t.functionExpression(declaration.id, declaration.params, declaration.body, declaration.generator, declaration.async) :
            declaration;
        nodePath.replaceWith(
          t.assignmentExpression(
            '=',
            moduleExports,
            expression
          )
        );
      }
    }
  },
});

module.exports = function ({ types: t }) {
  let commonjs = false;
  let umd = false;
  let latestExport = { path: null, start: 0 };
  const exportsMap = new Map;
  const moduleExportsMap = new Map;
  const importIndex = { value: 0 };
  const exports = t.identifier('exports');
  const moduleExports = t.memberExpression(
    t.identifier('module'),
    exports
  );
  const objectAssign = t.memberExpression(
    t.identifier('Object'),
    t.identifier('assign')
  );

  return {
    visitor: {
      AssignmentExpression(nodePath) {
        if (umd) return;
        const { left, right } = nodePath.node;
        if (
          t.isMemberExpression(left) && (
            (
              (isModuleExports(t, left) || isModuleExportsId(t, left)) &&
              !nodePath.scope.hasBinding('module')
            ) ||
            (isExports(t, left) && !nodePath.scope.hasBinding('exports'))
          )
        ) {
          commonjs = true;
          if (isExportDefault(t, left)) {
            nodePath.node.left = moduleExports;
            nodePath.node.right = t.callExpression(
              objectAssign,
              [
                right,
                exports
              ]
            );
            moduleExportsMap.set(nodePath, nodePath.node);
          } else if (isExports(t, left)) {
            if (latestExport.start < nodePath.node.start) {
              latestExport.path = nodePath;
              latestExport.start = nodePath.node.start;
            }
          }
        }
      },
      CallExpression(nodePath) {
        if (umd || notRequire(t, nodePath)) return;
        commonjs = true;
      },
      Program: {
        enter(nodePath) {
          latestExport.path = null;
          latestExport.start = 0;
          exportsMap.clear();
          moduleExportsMap.clear()
          commonjs = false;
          umd = false;
          importIndex.value = 0;
          const { body } = nodePath.node;
          const [expr] = body;
          if (
            body.length === 1 &&
            t.isExpressionStatement(expr) &&
            t.isCallExpression(expr.expression) &&
            t.isFunctionExpression(expr.expression.callee)
          ) {
            umd = true;
            for (const [index, argument] of expr.expression.arguments.slice().entries()) {
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
              t.functionExpression(null, [t.identifier('module'), exportsId], t.blockStatement(nodePath.node.body)),
              [id, t.memberExpression(id, t.identifier('exports'))]
            ));
            const final = t.exportDefaultDeclaration(t.memberExpression(id, t.identifier('exports')));
            nodePath.node.body = [decl, wrap, final];
            nodePath.traverse(esVisitor(importIndex, t, nodePath, {exports, moduleExports, objectAssign, latestExport, exportsMap}));

            for (const [exportPath, exportAssignment] of exportsMap.entries()) {
              if (exportPath.node && latestExport.start > exportPath.node.start) {
                latestExport.path.insertAfter(exportAssignment);
              } else exportPath.insertAfter(exportAssignment);
            }
            for (const [exportPath, exportAssignment] of moduleExportsMap.entries()) {
              if (latestExport.start > exportAssignment.start) {
                latestExport.path.insertAfter(exportAssignment);
                exportPath.remove();
              }
            }
          }
        },
      },
    },
  };
};
