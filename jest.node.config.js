module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: [
    '**/?(*.)+(node).+(ts|js)'
  ],
  transform: {
    '^.+\\.(ts|js)$': 'babel-jest'
  },
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  moduleNameMapper: {
    '^axios$': require.resolve('axios'),
  }
};
