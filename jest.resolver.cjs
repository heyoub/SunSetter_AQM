const path = require('path');

module.exports = (request, options) => {
  const basedir = options?.basedir;
  const rootDir = options?.rootDir || process.cwd();
  const defaultResolver = options?.defaultResolver;

  const isBaseConvexImport = request === './base-convex-generator.js';
  const isConvexGeneratorDir =
    typeof basedir === 'string' &&
    basedir === path.join(rootDir, 'src', 'generator', 'convex');

  if (isBaseConvexImport && isConvexGeneratorDir) {
    return path.join(rootDir, 'src', 'generator', 'convex', 'base-convex-generator.ts');
  }

  if (typeof defaultResolver === 'function') {
    return defaultResolver(request, {
      ...options,
      basedir: basedir || rootDir,
      rootDir,
    });
  }

  return require.resolve(request, {
    paths: [basedir || rootDir, rootDir].filter(Boolean),
  });
};
