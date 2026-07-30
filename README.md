# terraform-monorepo-action

Detects which Terraform/OpenTofu **root modules** in a monorepo are affected by a change — so your CI only plans/applies what actually changed, including modules affected through shared-module dependencies.

Diffing is delegated to [tj-actions/changed-files](https://github.com/tj-actions/changed-files) (SHA-pinned), inheriting its support for pull requests, pushes, merge queues, shallow clones and forks.

## Quick start

> Requires `actions/checkout` to run first.

```yaml
jobs:
  detect:
    runs-on: ubuntu-latest
    outputs:
      root_modules: ${{ steps.modules.outputs.root_modules }}
      any_changed: ${{ steps.modules.outputs.any_changed }}
    steps:
      - uses: actions/checkout@v7
      - uses: imaware/terraform-monorepo-action@v2
        id: modules

  plan:
    needs: detect
    if: needs.detect.outputs.any_changed == 'true'
    runs-on: ubuntu-latest
    strategy:
      matrix:
        module: ${{ fromJSON(needs.detect.outputs.root_modules) }}
    steps:
      - uses: actions/checkout@v7
      - uses: hashicorp/setup-terraform@v3
      - run: terraform -chdir="$MODULE" init && terraform -chdir="$MODULE" plan
        env:
          MODULE: ${{ matrix.module }}
```

Terraform/OpenTofu only runs on **root modules** — child (shared) modules are libraries consumed via `module` blocks. Feed `root_modules` to your plan/apply matrix; a change to a child module automatically marks every root module using it as changed.

## How it works

1. **Discover** — every directory with `*.tf` / `*.tf.json` / `*.tofu` / `*.tofu.json` files is a module (test files, `.terraform/`, `.github/` ignored).
2. **Classify** — **root module** = has a definitive marker (`backend`/`cloud`/`encryption` block — even empty, `.terraform.lock.hcl`, `terraform.tfstate`) or ≥2 supporting markers (`provider` config, `terraform.tfvars`, `*.auto.tfvars`). Everything else = **child module**.
3. **Graph** — local `module "x" { source = "../..." }` refs build the dependency graph; changes propagate child → dependents.
4. **Map** — changed files map to their deepest owning module, per git status.

### Ordered applies

`root_modules_ordered` is an array of layers in topological order — every module's dependencies live in an earlier layer, and modules within a layer are independent of each other:

```yaml
- run: |
    echo "$LAYERS" | jq -c '.[]' | while read -r layer; do
      echo "$layer" | jq -r '.[]' | while read -r module; do
        terraform -chdir="$module" apply -auto-approve
      done
    done
  env:
    LAYERS: ${{ steps.modules.outputs.root_modules_ordered }}
```

## Inputs

| Input                      | Default   | Description                                                                                        |
| -------------------------- | --------- | -------------------------------------------------------------------------------------------------- |
| `mode`                     | `changed` | `all` returns every module; `changed` returns only modules affected by the diff.                   |
| `files`                    |           | Glob patterns restricting which changed files are considered (passed to tj-actions/changed-files). |
| `files_ignore`             |           | Glob patterns of changed files to ignore (passed to tj-actions/changed-files).                     |
| `base_sha`                 |           | Override the base SHA used for the diff.                                                           |
| `sha`                      |           | Override the head SHA used for the diff.                                                           |
| `since_last_remote_commit` | `false`   | Diff against the last remote commit instead of the default base.                                   |
| `fetch_depth`              | `25`      | Depth of additional history fetched when needed.                                                   |
| `include`                  |           | Glob patterns of directories considered during module discovery (empty = whole repository).        |
| `exclude`                  |           | Glob patterns of directories excluded from discovery, e.g. `**/examples/**`, `docs/**`.            |
| `follow_dependencies`      | `true`    | Mark modules depending on changed modules (via local `source` refs) as changed too.                |
| `summary`                  | `true`    | Write a markdown report of the detected modules to the job summary.                                |

## Outputs

All outputs are JSON strings — parse with `fromJSON()`.

| Output                 | Description                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| `root_modules`         | Affected root (deployable) modules — **the main output**; feed it to your plan/apply matrix. |
| `root_modules_ordered` | Root modules as array of arrays: topologically ordered layers, dependencies first.           |
| `module_changes`       | Per-status detail: `{"added": [], "modified": [], "renamed": [], "deleted": []}`.            |
| `dependency_graph`     | Every discovered module with class, engine, markers, dependencies and dependents.            |
| `any_changed`          | `'true'` when at least one module is affected (including deletions).                         |

Example `module_changes`:

```json
{
  "added": ["stacks/new"],
  "modified": ["modules/network"],
  "renamed": [],
  "deleted": ["stacks/old"]
}
```

Example `dependency_graph`:

```json
{
  "modules/network": {
    "class": "child",
    "engine": "terraform",
    "markers": [],
    "dependencies": [],
    "dependents": ["stacks/vpc"]
  },
  "stacks/vpc": {
    "class": "root",
    "engine": "terraform",
    "markers": ["terraform backend block"],
    "dependencies": ["modules/network"],
    "dependents": []
  }
}
```

## Migrating from v1

- The `token`, `ignore` and `monitored` inputs were removed. Discovery is now based on Terraform/OpenTofu semantics instead of extension lists — use `include` / `exclude` (discovery scope) and `files` / `files_ignore` (diff scope) instead of `ignore`.
- The v1 `modules` output was replaced by `root_modules` (deployable modules only, JSON array of paths) — `fromJSON()` fan-out keeps working. Full detail lives in the `module_changes` and `dependency_graph` outputs.
- Modules are no longer detected from `.yaml` / `.tpl` files alone, which removes the false positives v1 was prone to. Files inside a module directory (templates, YAML, etc.) still mark that module as changed.
- Change detection now uses local git diffs via tj-actions/changed-files instead of the GitHub compare API, adding support for merge queues, shallow clones and more event types.

## Development

```bash
npm ci
npm run all   # format check, lint, typecheck, test, build
```

`detect/dist/` is committed and verified by CI (`check-dist`); rebuild with `npm run build` after changing `src/`.
