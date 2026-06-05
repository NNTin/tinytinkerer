# SOP: set up the pnpm workspace

Install dependencies with the same supply-chain protections CI uses: a frozen,
scriptless install followed by an explicit rebuild of only the reviewed native
binaries (`onlyBuiltDependencies`).

```
pnpm setup
```

`tools/setup-workspace.sh` runs the same thing. `pnpm setup` is:

```
pnpm install --frozen-lockfile --ignore-scripts && pnpm bootstrap:scriptless-install
```

- `--frozen-lockfile` installs exactly what the lockfile pins; it fails instead
  of silently drifting if `package.json` and the lockfile disagree.
- `--ignore-scripts` blocks every dependency install lifecycle script.
- `pnpm bootstrap:scriptless-install` then rebuilds only the allowlisted
  packages in `onlyBuiltDependencies`, so no unreviewed code runs at install.

To change dependencies after setup, follow `update-dependencies.md`.
