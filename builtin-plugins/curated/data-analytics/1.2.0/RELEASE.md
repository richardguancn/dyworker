# Preparing and deploying Data

This is the maintainer procedure for a Data release. A request to deploy Data
includes preparation and validation. Read this guide before choosing commands;
`build:mcp` alone does not produce the lightweight release package.

## Select the source and version

Use the requested release/integration branch and record its commit. The release
source must contain `scripts/prepare-data-plugin-release.mjs`, `mcp/build.mjs`,
`mcp/package.mjs`, and the matching runtime tests. If those files are absent,
stop: this checkout lacks the release toolchain. Find the intended release branch
rather than publishing unfiltered source or substituting another branch's build.

Choose the intended exact version, keeping `.codex-plugin/plugin.json`,
`package.json`, and lockfile version fields aligned. Rebuild after any version or
source change. Versions already present remotely must not normally be reused.
Use a new version for changed package bytes; an alpha suffix is still a version.

For chart CDN changes, follow the [chart release guide](skills/visualize-data/CHART_RELEASES.md). The same release supplies Chat, Work and Pages charts and the React renderer used by dashboards and HTML exports. Verify both browser entries before shipping the plugin.

Read the source branch's `scripts/data-examples-cdn.md` and build-script usage.
Use its pinned, frozen dependency workspace with the matching MCP Extensions SDK.
Hydrate declared blob assets and verify their committed hash pins. Do not use an
unrelated global publisher/toolchain or install arbitrary latest dependencies.

## Select the release publisher

The Data integration branch and the release publisher are separate checkouts.
This guide requires the CLI introduced in
[openai/openai#1636894](https://github.com/openai/openai/pull/1636894);
Data's integration-branch CLI does not yet have `release check`, `--prepared`,
or `--allow-existing-version`. Do not assume its installed entrypoint supports
this procedure.

Use a release-tooling checkout containing that change. The alpha-4 deployment
was qualified with publisher commit
[`379df8d84435b7dd0cea518c6dbacd666bd6b570`](https://github.com/openai/openai/commit/379df8d84435b7dd0cea518c6dbacd666bd6b570)
(the same executable code as `fb48a710e3f02bfc4f993a84c7c0a65fcfb27344`).
Until the tooling PR lands, use that reviewed candidate explicitly; after it
lands, a compatible descendant is sufficient. Install the publisher's declared
dependencies in its own checkout-local environment using its
[project instructions](https://github.com/openai/openai/blob/379df8d84435b7dd0cea518c6dbacd666bd6b570/project/cloud_plugins_import/README.md#local-validation)
and the repository Python setup guidance. Keep Data's source and frozen build
dependencies unchanged.

Set the absolute path to that environment's CLI and verify its capabilities:

```bash
export DATA_RELEASE_CLI=/absolute/release-tooling-checkout/.venv/bin/cloud-plugin-admin
"$DATA_RELEASE_CLI" release check --help
"$DATA_RELEASE_CLI" release stage --help
```

The help must list `--prepared` and `--allow-existing-version`. Record the
publisher revision and verify its imports resolve to the intended checkout.
If the selected CLI lacks these commands or flags, obtain the compatible
publisher before proceeding; do not omit the remote check or use the older
integration-branch CLI as a fallback. All commands below use this selected CLI.

## Build the lightweight package

From the Data plugin root, set these to real absolute paths:

```bash
export DATA_RELEASE_DEPENDENCIES=/absolute/frozen-publisher
export DATA_RELEASE_OUTPUT=/absolute/new/data-analytics
export DATA_CHART_RELEASE=/absolute/qualified/chart-candidate
unset DATA_HOME_PREVIEW_CONTROLS
node scripts/prepare-data-plugin-release.mjs \
  --dependencies "$DATA_RELEASE_DEPENDENCIES" \
  --output "$DATA_RELEASE_OUTPUT" \
  --chart-release "$DATA_CHART_RELEASE"
```

The chart candidate must contain the retained archive and successful qualification
receipt from [skills/visualize-data/CHART_RELEASES.md](skills/visualize-data/CHART_RELEASES.md). Preparation compares its chart
inputs with this checkout, verifies the exact hosted bytes and delivery headers,
and publishes missing CDN objects before adopting the pin. It uses the existing
Azure login only when publication is needed. A source mismatch requires a new
qualified candidate; an immutable-object conflict requires a new chart version.
A failed check stops packaging. The sibling `.cdn.json` records verified delivery.
Plugin-only variants can pass `--reuse-published-chart` with the original qualified archive. This verifies the adopted chart pin and every hosted asset without uploading anything, even when source files move. It fails on an unpublished or mismatched pin. Build and qualify a new independent chart version to publish changed chart bytes.

The output must be a new directory **outside** the plugin source. Leave
`DATA_HOME_PREVIEW_CONTROLS` unset. The preparation script builds the MCP runtime,
checks a byte-identical rebuild, packages the filtered plugin, and writes the
sibling SHA-256 inventory. Preserve its output and command log. A failure means
not ready; never fall back to deploying the source directory.

## Validate the package that will ship

Run the source branch's package/runtime tests (including
`tests/data-mcp-package.test.mjs`) and its documented installed-package smoke
procedure against the prepared output. Exercise the shipped MCP launcher,
initialization/tool discovery, v2 forms, local homepage history, and a sample artifact. Verify that no settings capability, tools, or UI are exposed. Test from the
prepared/extracted package without source `node_modules` so development files
cannot hide missing runtime assets. For changed homepage/CDN behavior, run the
matching browser smoke checks. Record the actual commands/results and any limits.

Check that manifest/runtime versions agree; verify all files against the emitted
SHA-256 inventory, required runtime assets and licenses are present, development
payloads are excluded, and the manifest retains its complete `Works With`
dependency declarations and categories. Validate with the current publisher:

```bash
"$DATA_RELEASE_CLI" --help
"$DATA_RELEASE_CLI" plugin validate "$DATA_RELEASE_OUTPUT"
"$DATA_RELEASE_CLI" release check "$DATA_RELEASE_OUTPUT" \
  --plugin-id <target-data-plugin-id> --env <target-env> --prepared
```

Confirm that the command loads the intended publisher checkout. `release check`
performs a remote read without uploading and fails if the version already exists,
including historical/detached releases visible to the admin inventory. After a
conflict, bump the version and repeat preparation/validation. Only an intentional,
authorized repair may use `--allow-existing-version`; record why and the existing
release IDs. The override does not waive build validation or failed remote reads.

The inventory is eventually consistent, so this is not an atomic reservation.
Serialize releases for Data, let recent writes index, and recheck before release.
Do not call an offline-only check proof that the remote version is unused.

## Signal readiness, then deploy/push

Only after the build, package smoke checks, and remote preflight succeed, report
**READY_TO_DEPLOY_AND_PUSH** with:

- Exact source branch/commit and pending changes, plugin name/version, and frozen dependency source.
- Prepared directory, archive/inventory hashes, package size, and validation evidence.
- Target environment/plugin ID, remote-version check result, and any approved reuse exception.
- Intended rollout audience and exact proposed deployment/source-push actions.

If a required check fails or cannot run, report **NOT_READY** and the concrete
blocker. The publisher's `READY_TO_DEPLOY` means package validation and version
preflight passed; the broader Data readiness statement also requires the build
and runtime smoke evidence above. Neither statement publishes, pushes, or grants
approval for those actions.

Commit/push the reviewed source changes and generated hash pins through the normal
PR workflow. Use Applied blob storage for generated binary assets; do not commit
release archives or dependency installations. If committing changes the revision,
record the final source commit with the same verified artifact hashes. Any content
or version change invalidates readiness and requires rebuilding/revalidation.

For an authorized detached alpha candidate, stage the prepared output:

```bash
"$DATA_RELEASE_CLI" release stage "$DATA_RELEASE_OUTPUT" \
  --plugin-id <target-data-plugin-id> --env <target-env> --prepared
```

Preserve the requested audience. Normal publication, alpha configuration changes,
and source pushes are separate actions with their existing authorization rules.
OpenAI-workspace distribution uses the existing Git sync described in the parent
AGENTS.md; do not replace that route with admin publication. For alpha/global
releases, verify the selected release/version, downloaded package hashes, runtime
smoke behavior, and `Works With` dependency metadata after deployment. A successful
upload or Git push alone does not establish a working installation.
