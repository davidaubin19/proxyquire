import Module from 'module';
import resolve from 'resolve';
import forEach from 'lodash.foreach';
import * as aliases from './aliases';
const path = require('path');

function getRequest(request, parentPath) {
  const parentDir = parentPath;
  if (aliases.isAliased(request)) {
    return aliases.relative(parentDir, request);
  } else {
    return request;
  }
}

// The moduleId is the absolute path of the module on your system.
function getModuleId(request, parentPath) {
  return resolve.sync(request, {
    basedir: path.dirname(parentPath),
    extensions: Object.keys(require.extensions),
  });
}

function makeMockModule(moduleId, exports) {
  const mockedModule = new Module(moduleId);
  mockedModule.exports = exports;
  return mockedModule;
}

function getFromCache(moduleId) {
  return Module._cache[moduleId];
}

function removeFromCache(moduleId) {
  delete require.cache[moduleId];
  delete Module._cache[moduleId];
}

function addToCache(moduleId, module) {
  Module._cache[moduleId] = module;
  require.cache[moduleId] = module;
}

function replaceCacheEntry(moduleId, module) {
  if (module) {
    removeFromCache(moduleId);
    addToCache(moduleId, module);
  }
}

function warmUpModuleCache(request, parent) {
  const moduleId = getModuleId(request, parent.filename);

  // Load the module without stubs so that Module._cache is properly
  // warmed up and so that a dependency of our thing under test is not
  // instantiated with a stub instead of the real thing.
  Module._load(request, parent);

  // the module should not be a child to this module.
  parent.children.pop();

  // We're only doing this because we're nice and we clean up after ourselves
  const module = getFromCache(moduleId);

  // Remove the module from the cache (because we want to load it with stubs after this)
  removeFromCache(moduleId);

  return module;
}

// delete this module from the cache to force re-require in order to allow resolving test module via parent.module
removeFromCache(require.resolve(__filename));
// delete this module from the module.parent children to prevent leaks
module.parent.children.splice(
  module.parent.children.indexOf(module),
  1,
);

/**
 * proxyquire - require a module with a list of mocks instead of their real implementations
 *
 * type Request = string;
 * type ModuleExports = {
 *   [methodOrProperty: string]: any;
 *   default?: any;
 * }
 * type Stubs = {
 *   [modulePathOrName: string]: ModuleExports;
 * }
 *
 * @param {Request} request - a module name / relative path (e.g. 'moment' or '../StockPileStore')
 * @param {Stubs} stubs - a key value pair of modules to mock and the mock implementations
 * @returns {exports}
 */
export default function proxyquire(req, stubs) {
  let error;
  let moduleLoadedWithStubs;
  const parent = module.parent; // fancy node.js thing that means 'the module which required *this file*'
  const request = getRequest(req, parent.filename);
  const requestId = getModuleId(request, parent.filename);

  // We store the "real" modules in here so that we can clean up after
  // ourselves after we have loaded the module.
  //
  // type ModuleCache {
  //   [absolutePath: string]: Module
  // }
  const tempCache = new Map();

  // We load the module once without stubs so that the caches are all
  // properly loaded. We hold on to the old value so we can clean up after
  // ourselves and put it back in the cache once we're done.
  const trueModule = warmUpModuleCache(request, parent);

  try {
    // We replace the real modules from the Module cache by our stubs.
    forEach(stubs, (stub, stubPath) => {
      const stubRequest = getRequest(stubPath, requestId);
      const moduleId = getModuleId(stubRequest, requestId);
      tempCache.set(moduleId, getFromCache(moduleId));
      replaceCacheEntry(moduleId, makeMockModule(moduleId, stub));
    });

    moduleLoadedWithStubs = Module._load(request, parent);

    // the mocked module should not be a child of this module.
    parent.children.pop();

  } catch (e) {
    // We actually want to show that error, but we also want to clean up
    // after ourselves before we do anything of the sort. Otherwise we'd be
    // leaving the mocks in the module cache... and that's pretty bad!
    error = e;
  }

  // We clean up after ourselves by putting back the true module values
  // into the cache
  forEach(stubs, (stub, stubPath) => {
    const stubRequest = getRequest(stubPath, requestId);
    const moduleId = getModuleId(stubRequest, requestId);
    replaceCacheEntry(moduleId, tempCache.get(moduleId));
    tempCache.delete(moduleId); // because I'm paranoid
  });

  // We put back the module value into the cache
  replaceCacheEntry(requestId, trueModule);

  if (error) {
    // finally throw that nasty error!
    throw error;
  }

  return moduleLoadedWithStubs;
}

// temporary, while w
export const noCallThru = () => proxyquire;

// exported for testing against memory leaks
export const __parent__ = module.parent;

export const alias = aliases.add;
export const unalias = aliases.remove;
export const getAliases = aliases.get;
