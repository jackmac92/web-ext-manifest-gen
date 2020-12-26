module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testRegex: '(^src.*/__tests__/.*|(\\.|/)(test|spec))\\.(jsx?|tsx?)$',
  testPathIgnorePatterns: ['/node_modules/', '/lib/'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest'
  }
}
