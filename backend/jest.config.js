'use strict';

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  setupFiles: ['./tests/setup.js'],
  coverageDirectory: 'coverage',
  collectCoverageFrom: ['src/**/*.js'],
  testTimeout: 30000,
  verbose: true,
  forceExit: true,
};
