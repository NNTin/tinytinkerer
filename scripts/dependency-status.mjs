import { execFileSync } from 'node:child_process'

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim()

console.log('pnpm version:', run('pnpm', ['--version']))
console.log('minimumReleaseAge:', run('pnpm', ['config', 'get', 'minimumReleaseAge']))
console.log('saveExact:', run('pnpm', ['config', 'get', 'saveExact']))
console.log('auditLevel:', run('pnpm', ['config', 'get', 'auditLevel']))
console.log('onlyBuiltDependencies:', run('pnpm', ['config', 'get', 'onlyBuiltDependencies', '--json']))
console.log('ignoredBuiltDependencies:', run('pnpm', ['config', 'get', 'ignoredBuiltDependencies', '--json']))
console.log('\nOutdated direct dependencies (registry latest; the age gate may intentionally hold newer releases back):')
try {
  console.log(run('pnpm', ['outdated', '-r']) || 'None')
} catch (error) {
  const output = error.stdout ? String(error.stdout).trim() : ''
  console.log(output || 'None')
}
