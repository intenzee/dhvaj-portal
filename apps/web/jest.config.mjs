import nextJest from 'next/jest.js';

const createJestConfig = nextJest({ dir: './' });

/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'jest-environment-jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  // Ignore build output so its copied package.json doesn't trigger a
  // jest-haste-map naming collision with the workspace root.
  modulePathIgnorePatterns: ['<rootDir>/.next/'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@hsdg/contracts$': '<rootDir>/../../packages/contracts/src/index.ts',
  },
};

export default createJestConfig(config);
