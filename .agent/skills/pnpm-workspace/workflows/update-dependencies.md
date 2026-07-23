# SOP: update pnpm dependencies safely

## 1. Confirm policy before touching versions

```
pnpm dependency:status
```

Verify `pnpm-workspace.yaml` still has:

- `minimumReleaseAge: 10080` and no `minimumReleaseAgeExclude`.
- `saveExact: true`.
- `auditLevel: moderate`.
- Reviewed build-script policy (`allowBuilds` maps each reviewed package name to `true`/`false`).

If a newer package is required but blocked by the 7-day age gate, stop and ask a human. Do not bypass the gate locally or in config.

## 2. Update and exact-pin

```
pnpm update -r --latest
pnpm pin:dependencies
pnpm install --lockfile-only
```

Rules:

- Direct `dependencies` and `devDependencies`: exact resolved versions only.
- `peerDependencies`: keep compatibility ranges.
- Workspace links: keep `workspace:*`.
- Remove deprecated stub type packages when the runtime package ships its own types.

## 3. Review install lifecycle scripts

```
pnpm check:install-scripts
```

For every dependency with `preinstall`, `install`, or `postinstall`, review the package and then add its name to `allowBuilds` in `pnpm-workspace.yaml`:

- `true` if an explicit, reviewed bootstrap/rebuild step may run it, or
- `false` if installs must block it.

Prefer blocking by default; scriptless CI installs remain mandatory. When a CI job needs native/CLI binaries from approved packages, run `pnpm bootstrap:scriptless-install` after the scriptless install.

## 4. Audit and handle vulnerabilities

```
pnpm audit --audit-level=moderate
```

- Direct vulnerable dependency: update the direct dependency.
- Transitive-only vulnerable dependency: add a root `overrides` entry in `pnpm-workspace.yaml` with a comment naming the GHSA/CVE and why the override is needed.

## 5. Validate before pushing

```
pnpm setup:workspace
pnpm check:exact-dependencies
pnpm check:install-scripts
pnpm audit --audit-level=moderate
pnpm check:skill-readme
pnpm build
pnpm typecheck
pnpm lint
pnpm test
```

If `pnpm install --ignore-scripts` leaves native packages unusable for local generated assets, rebuild only the needed reviewed packages locally (for example `pnpm rebuild sharp esbuild workerd`) without changing CI's scriptless install policy.
