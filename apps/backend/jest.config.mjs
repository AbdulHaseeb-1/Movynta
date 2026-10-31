/** Jest runs the TypeScript sources as ESM (the package is "type": "module"). Use `pnpm --filter movynta-backend test`. */
export default {
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testRegex: "\\.spec\\.ts$",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.ts$": ["ts-jest", { useESM: true, tsconfig: "tsconfig.spec.json" }],
  },
};
