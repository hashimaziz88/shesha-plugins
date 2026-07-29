// Runs from inside <framework>/shesha-reactjs, so rootDir is that package.
//
// NOTE on rootDir: this file is copied by gen-registry.mjs to
// `<framework>/shesha-reactjs/.shesha-registry-gen/jest.config.cjs`, i.e. one
// level *inside* the shesha-reactjs package. So `__dirname` at runtime is
// `.../shesha-reactjs/.shesha-registry-gen`, and the package root
// (shesha-reactjs itself, where `@/*` -> `./src/*` is anchored per
// tsconfig.base.json's baseUrl) is only ONE level up — not two.
const path = require('path');

module.exports = {
  rootDir: path.resolve(__dirname, '..'),
  testEnvironment: 'jsdom',
  testMatch: ['**/.shesha-registry-gen/extract.test.ts'],
  setupFilesAfterEnv: ['<rootDir>/.shesha-registry-gen/setup.js'],
  transform: {
    // The framework's own tsconfig.json (via tsconfig.base.json) targets
    // ESNext modules for the rollup build; Jest needs CommonJS output, so we
    // point ts-jest at the framework's existing tsconfig.test.json, which
    // already overrides module to commonjs for exactly this purpose.
    '^.+\\.tsx?$': ['ts-jest', {
      isolatedModules: true,
      diagnostics: false,
      tsconfig: '<rootDir>/tsconfig.test.json',
    }],
  },
  moduleNameMapper: {
    // antd ships ESM under es/; Jest needs the CJS build.
    '^antd/es/(.*)$': 'antd/lib/$1',
    // nanoid and redux-actions are ESM-only and would need transformIgnorePatterns
    // gymnastics; the extraction never exercises their behaviour.
    '^nanoid$': '<rootDir>/.shesha-registry-gen/stubs/nanoid.js',
    '^redux-actions$': '<rootDir>/.shesha-registry-gen/stubs/reduxActions.js',
    // `?raw` text imports and CSS imports carry no props.
    '\\?raw$': '<rootDir>/.shesha-registry-gen/stubs/raw.js',
    '\\.(css|less|scss)$': '<rootDir>/.shesha-registry-gen/stubs/raw.js',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transformIgnorePatterns: ['node_modules/(?!(nanoid|redux-actions)/)'],
};
