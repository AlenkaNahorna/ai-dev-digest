/** Pure phantom-gate rules. No filesystem, database, or framework dependency. */
export const PHANTOM_GLOBALS_ALLOWLIST: ReadonlySet<string> = new Set([
  'console', 'process', 'globalThis', 'require', 'module', 'exports', '__dirname', '__filename',
  'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'Promise',
  'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'Map', 'Set', 'WeakMap',
  'WeakSet', 'Date', 'RegExp', 'Proxy', 'Reflect', 'BigInt', 'setTimeout', 'setInterval',
  'clearTimeout', 'clearInterval', 'setImmediate', 'clearImmediate', 'queueMicrotask',
  'structuredClone', 'fetch', 'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder',
  'AbortController', 'AbortSignal', 'Headers', 'Request', 'Response', 'FormData', 'Blob',
  'File', 'FileReader', 'Buffer', 'window', 'document', 'navigator', 'localStorage',
  'sessionStorage', 'performance', 'crypto', 'location', 'history', 'parseInt', 'parseFloat',
  'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
  'super', 'this', 'arguments', 'undefined', 'NaN', 'Infinity', 'describe', 'it', 'test',
  'expect', 'beforeAll', 'beforeEach', 'afterAll', 'afterEach', 'vi', 'jest',
]);
