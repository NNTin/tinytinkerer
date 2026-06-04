module.exports = {
  extends: ['@commitlint/config-conventional'],
  defaultIgnores: false,
  ignores: [
    (message) =>
      /^chore\(merge\): merge [0-9a-f]{40} into [0-9a-f]{40}$/m.test(message)
  ]
}
