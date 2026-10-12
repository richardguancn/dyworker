#!/usr/bin/env bash
set -euo pipefail

data_ci_suite="all"
if [[ "$#" -eq 2 && "$1" == "--suite" && "$2" =~ ^(app|inline)$ ]]; then
  data_ci_suite="$2"
elif [[ "$#" -ne 0 ]]; then
  printf 'Usage: run-inline-chart-ci.sh [--suite app|inline]\n' >&2
  exit 1
fi

if [[ "$(uname -s)" != "Linux" ]]; then
  printf 'The Data inline CI helper requires a Linux Buildkite worker.\n' >&2
  exit 1
fi

data_ci_test_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
data_ci_plugin_root="$(cd -- "$data_ci_test_root/../.." && pwd)"
data_ci_repo_root="$(cd -- "$data_ci_plugin_root/../../../.." && pwd)"
data_ci_node_version="$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["engines"]["node"])' "$data_ci_repo_root/package.json")"

if [[ ! "$data_ci_node_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  printf 'The root package.json must pin an exact Node version: %s\n' "$data_ci_node_version" >&2
  exit 1
fi

# CI must use an already-reviewed Node archive, never stage a new toolchain.
data_ci_node_manifest="$data_ci_repo_root/lib/js/oai_js/oai_js/node/v$data_ci_node_version/manifest.json"
if [[ ! -f "$data_ci_node_manifest" ]]; then
  printf 'Missing reviewed Node archive manifest: %s\n' "$data_ci_node_manifest" >&2
  exit 1
fi

data_ci_work_dir="$(mktemp -d "${TMPDIR:-/tmp}/data-inline-ci.XXXXXX")"
data_ci_work_dir="$(cd -- "$data_ci_work_dir" && pwd -P)"
trap 'rm -rf -- "$data_ci_work_dir"' EXIT

cd "$data_ci_repo_root"
oaipkg run oai_js.install_node "node_version=$data_ci_node_version" "prefix=$data_ci_work_dir/node"
export PATH="$data_ci_work_dir/node/bin:$PATH"
data_ci_node="$data_ci_work_dir/node/bin/node"
if [[ "$("$data_ci_node" --version)" != "v$data_ci_node_version" ]]; then
  printf 'The Data inline CI job is not using its pinned Node runtime.\n' >&2
  exit 1
fi

"$data_ci_node" --test "$data_ci_test_root/inline-chart-ci.test.mjs"

# Start from empty caches so repository-local dependencies cannot conceal a
# broken installed-plugin prebuilt runtime or a missing pinned browser.
export DATA_INLINE_CACHE_DIR="$data_ci_work_dir/inline-cache"
export DATA_INLINE_MONOREPO_ROOT="$data_ci_repo_root"
export PLAYWRIGHT_BROWSERS_PATH="$data_ci_work_dir/browsers"

cd "$data_ci_plugin_root"
# Customer builds use the payload shipped in the plugin, not a registry. Hydrate
# the exact release assets before exercising an isolated installed-plugin copy.
blobdata download oai-maintained-plugins \
  --repo-root "$data_ci_repo_root" --filter '^plugins/data-analytics/'

data_ci_offline_plugin="$data_ci_work_dir/installed-data-plugin"
data_ci_project="$data_ci_work_dir/data-app"
"$data_ci_node" --input-type=module -e '
  import { cpSync } from "node:fs";
  import { basename, join } from "node:path";
  const [source, plugin, project] = process.argv.slice(1);
  const options = {
    recursive: true,
    filter: (path) => !["node_modules", "dist"].includes(basename(path)),
  };
  cpSync(source, plugin, options);
  cpSync(join(plugin, "templates/data-app/base"), project, options);
' "$data_ci_plugin_root" "$data_ci_offline_plugin" "$data_ci_project"

data_ci_no_npm_dir="$data_ci_work_dir/no-npm"
mkdir -p "$data_ci_no_npm_dir"
cat > "$data_ci_no_npm_dir/npm" <<'EOF'
#!/bin/sh
printf 'Customer Data builds must not invoke a package manager.\n' >&2
exit 86
EOF
chmod +x "$data_ci_no_npm_dir/npm"
for data_ci_package_manager in npx pnpm yarn corepack bun; do
  cp "$data_ci_no_npm_dir/npm" "$data_ci_no_npm_dir/$data_ci_package_manager"
done

data_ci_run_offline() {
  PATH="$data_ci_no_npm_dir" \
    NODE_PATH= \
    NODE_OPTIONS= \
    NAPI_RS_FORCE_WASI=error \
    NAPI_RS_NATIVE_LIBRARY_PATH="$data_ci_work_dir/untrusted-native-override.node" \
    npm_config_offline=true \
    npm_config_cache="$data_ci_work_dir/npm-cache" \
    "$@"
}

data_ci_run_offline "$data_ci_node" \
  "$data_ci_offline_plugin/templates/data-app/base/scripts/verify-protected-runtime.mjs"
data_ci_run_offline "$data_ci_node" "$data_ci_offline_plugin/scripts/data-app.mjs" \
  build --project-dir "$data_ci_project"
data_ci_app_state="$data_ci_work_dir/offline-app-state.json"
data_ci_run_offline "$data_ci_node" "$data_ci_offline_plugin/tests/ci/verify-offline-build.mjs" \
  capture --project-dir "$data_ci_project" --state-file "$data_ci_app_state"
data_ci_run_offline "$data_ci_node" "$data_ci_offline_plugin/tests/ci/verify-prebuilt-runtime.mjs" \
  --project-dir "$data_ci_project"
# Repeat the complete customer build and prove both the reviewed source and
# runtime identity stay stable without creating an installed dependency tree.
for data_ci_repeat in 1 2 3; do
  data_ci_run_offline "$data_ci_node" "$data_ci_offline_plugin/scripts/data-app.mjs" \
    build --project-dir "$data_ci_project"
  data_ci_run_offline "$data_ci_node" "$data_ci_offline_plugin/tests/ci/verify-offline-build.mjs" \
    verify --project-dir "$data_ci_project" --state-file "$data_ci_app_state"
done
data_ci_package_result="$data_ci_work_dir/offline-sites-package.json"
data_ci_run_offline "$data_ci_node" \
  "$data_ci_offline_plugin/skills/publish-artifact-to-sites/scripts/package-data-app-for-sites.mjs" \
  --project-dir "$data_ci_project" --project-id appgprj_data_offline_ci > "$data_ci_package_result"
data_ci_run_offline "$data_ci_node" "$data_ci_offline_plugin/tests/ci/verify-offline-build.mjs" \
  verify --project-dir "$data_ci_project" --state-file "$data_ci_app_state" --require-worker \
  --package-result-file "$data_ci_package_result"
data_ci_run_offline "$data_ci_node" \
  "$data_ci_offline_plugin/skills/visualize-data/scripts/render-inline-chart.mjs" \
  --prepare --offline --cache-dir "$DATA_INLINE_CACHE_DIR"

# npm is allowed only for maintainer tests in this disposable plugin copy, after
# the complete cold/warm/customer/Sites path has passed without it. The explicit
# source-build tests and actual Codex visualization-host fixture still use Vite;
# their private dependency tree must not be mistaken for a customer requirement.
cd "$data_ci_offline_plugin"
npm ci --no-audit --no-fund
data_ci_run_offline "$data_ci_node" "$data_ci_offline_plugin/scripts/data-app.mjs" \
  prepare --project-dir "$data_ci_offline_plugin/templates/data-app/base"
(
  cd "$data_ci_offline_plugin/templates/data-app/base"
  npm ci --ignore-scripts --no-audit --no-fund
)
export DATA_INLINE_HOST_DEPENDENCY_ROOT="$data_ci_offline_plugin/templates/data-app/base"

data_ci_browsers=(chromium)
if [[ "$data_ci_suite" != "inline" ]]; then data_ci_browsers+=(webkit); fi
"$data_ci_node" node_modules/playwright-core/cli.js install --with-deps --only-shell "${data_ci_browsers[@]}"
if [[ "$data_ci_suite" != "inline" ]]; then
  npm test
  "$data_ci_node" tests/data-app-serialization-browser.smoke.mjs
  "$data_ci_node" tests/data-app-feature-coverage-browser.smoke.mjs
  # Linux WPE MiniBrowser aborts in its EGL renderer on repeated SVG touches.
  # Keep all Chromium gesture tests and the separate WebKit responsive checks.
  DATA_APP_SKIP_WEBKIT_TOUCH=1 npm run test:mobile-responsive-browser
  npm run test:data-app-browser
  npm run test:data-report-browser
fi
if [[ "$data_ci_suite" != "app" ]]; then
  npm run test:inline-chart-browser
fi
if [[ "$data_ci_suite" != "inline" ]]; then
  npm run test:data-app-polish-browser
  npm run test:data-app-custom-layout-browser
fi
