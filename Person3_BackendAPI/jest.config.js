/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  // A dedicated tsconfig, not the base one: tsconfig.json's `rootDir: "src"`
  // excludes `tests/`, which ts-jest then can't map an outDir for — first
  // real test run (ROADMAP.md Phase 1) surfaced this; never caught before
  // because the suite had never actually been executed.
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }],
  },
  clearMocks: true,
  collectCoverageFrom: ['src/**/*.ts'],
  verbose: true,
};
