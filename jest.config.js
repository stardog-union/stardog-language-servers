module.exports = {
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  testPathIgnorePatterns: [
    '/node_modules/',
    '/__integration-tests__',
    '.*fixtures.*',
  ],
  testRegex: '(/__tests__/.*|(\\.|/)(test|spec))\\.(js|ts)$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleDirectories: ['src', 'node_modules'],
  moduleNameMapper: {
    '\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$':
      '<rootDir>/__mocks__/fileMock.js',
    '\\.(css|less|scss)$': 'identity-obj-proxy',
  },
  collectCoverage: false,
  collectCoverageFrom: ['**/src/**/*.{js,ts}'],
  coveragePathIgnorePatterns: [
    '.d.ts',
    '/__tests__',
    '/__integration-tests__',
    '.*fixtures.*',
  ],
  coverageReporters: ['json', 'lcov', 'text', 'text-summary'],
  setupTestFrameworkScriptFile: './jest.setup.js',
  globals: {
    'ts-jest': {
      diagnostics: false, // don't fail tests due to type checker
    },
  },
};
