module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '(src/.*|test/architecture)\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['src/**/*.(t|j)s'],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@rescom/schemas/(.*)$': '<rootDir>/../../packages/schemas/src/$1',
    '^@rescom/schemas$': '<rootDir>/../../packages/schemas/src',
  },
};
