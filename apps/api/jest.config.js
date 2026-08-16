module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testRegex: '.*\\.(spec|e2e-spec)\\.ts$',
  moduleNameMapper: {
    '^@lending/money$': '<rootDir>/../../packages/money/src',
  },
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  testTimeout: 30000,
};
