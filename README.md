# terraform-monorepo-action

Detects which Terraform/OpenTofu **root modules** in a monorepo are affected by a change, so your CI only plans/applies what actually changed. Change to a child module (local module) automatically marks every root module using it as changed.

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
      - uses: tchsvc-infra/terraform-monorepo-action@v2
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

## How it works

1. **Discover** - every directory with `*.tf` / `*.tf.json` / `*.tofu` / `*.tofu.json` files is a module (test files, `.terraform/`, `.github/` ignored).
2. **Classify** - **root module** = has a definitive marker (`backend`/`cloud`/`encryption` block (it can be empty), `.terraform.lock.hcl`, `terraform.tfstate`) or ≥2 supporting markers (`provider` config, `terraform.tfvars`, `*.auto.tfvars`). Everything else = **child module**.
3. **Graph** - local `module "x" { source = "../..." }` refs build the dependency graph; changes propagate child → dependents.
4. **Map** - changed files map to their deepest owning module, per git status.

### Ordered applies

`root_modules_ordered` is an array of layers in topological order, every module's dependencies live in an earlier layer, and modules within a layer are independent of each other:

```yaml
- run: |
    echo "$MODULES" | jq -c '.[]' | while read -r module; do
      echo "$module" | jq -r '.[]' | while read -r submodule; do
        terraform -chdir="$submodule" apply -auto-approve
      done
    done
  env:
    MODULES: ${{ steps.modules.outputs.root_modules_ordered }}
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
| `environments`             |           | Per-environment file patterns, one `name=pattern[;pattern...]` per line (see below).               |
| `summary`                  | `true`    | Write a markdown report of the detected modules to the job summary.                                |

## Outputs

All outputs are JSON strings, you can parse it with `fromJSON()`.

| Output                 | Description                                                                                                                                                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `root_modules`         | Affected root (deployable) modules, **the main output**; feed it to your plan/apply matrix.                                                                                                                                         |
| `root_modules_ordered` | Root modules as array of arrays: topologically ordered layers, dependencies first.                                                                                                                                                  |
| `module_changes`       | Per-status detail: `{"added": [], "modified": [], "renamed": [], "deleted": []}`.                                                                                                                                                   |
| `dependency_graph`     | Every discovered module with class, engine, markers, dependencies and dependents.                                                                                                                                                   |
| `environments_matrix`  | `{module, environment}` entries for `strategy.matrix.include`, fanned out per triggered environment (see [Per-environment triggering](#per-environment-triggering)). Modules without environments produce plain `{module}` entries. |
| `any_changed`          | `'true'` when at least one module is affected (including deletions).                                                                                                                                                                |

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

Example `environments_matrix` (with the `environments` input set; `terraform/variables/prod.tfvars` changed):

```json
[{ "module": "terraform", "environment": "prod" }]
```

Without the `environments` input it degrades to plain module entries: `[{"module": "terraform"}]`.

## Per-environment triggering

For layouts where one root module serves multiple environments via var-files (e.g. `terraform/variables/{dev,prod}.tfvars`), declare which files belong to which environment. The name left of `=` is a free-form label (it becomes `matrix.environment`); the patterns right of `=` (delimited by `;` or `,`) match file names or full paths when they contain a `/`:

```yaml
- uses: tchsvc-infra/terraform-monorepo-action@v2
  id: modules
  with:
    environments: |
      dev=dev.tfvars;dev.backend.tfvars
      prod=prod.tfvars;prod.backend.tfvars
```

- A changed file matching an environment's patterns triggers **only that environment** (`variables/prod.tfvars` → prod only).
- Any other changed file in the module (code, templates) triggers **all environments** of that module.
- Modules without environment files produce a plain `{module}` entry.
- Patterns never connect modules to each other. A trigger always belongs to the module that owns the changed file: if `stacks/app` and `stacks/db` each have a `prod.tfvars`, changing `stacks/app/variables/prod.tfvars` yields `{"module": "stacks/app", "environment": "prod"}` and `stacks/db` is unaffected, since none of its files changed.
- The input is the only registry of environment names — files never invent environments. An **undeclared** env file (e.g. a new `staging.tfvars` before `staging=` is added to the input) counts as regular module content: it re-triggers all declared environments, but `staging` itself is not deployed until declared.
- **Deleting** an env file triggers that environment one last time (the trigger comes from the diff, not the current tree) — a window for destroy/cleanup. Afterwards the module no longer has that environment.

### Scoping patterns by path

Filename patterns apply repo-wide (any file with that name counts as an environment file, in whatever module owns it). Use path globs (any pattern containing `/`) when a same-named file should **not** count as an environment file in some subtree, or when environment labels differ per subtree:

```yaml
environments: |
  # only var-files under stacks/app count as environments; a prod.tfvars
  # elsewhere is treated as regular module content
  dev=stacks/app/variables/dev.*
  prod=stacks/app/variables/prod.*
```

```yaml
environments: |
  # any direct child of stacks/ (app, db, ...), but nothing outside stacks/
  dev=stacks/*/variables/dev.*
  prod=stacks/*/variables/prod.*
```

```yaml
environments: |
  # different environment labels per subtree
  app-prod=stacks/app/**/prod.*
  db-prod=stacks/db/**/prod.*
```

Consume `environments_matrix` via matrix `include`:

```yaml
strategy:
  matrix:
    include: ${{ fromJSON(needs.detect.outputs.environments_matrix) }}
steps:
  - run: tofu -chdir="$MODULE" plan -var-file="variables/$ENV.tfvars"
    env:
      MODULE: ${{ matrix.module }}
      ENV: ${{ matrix.environment }}
```

Example output: `[{"module": "terraform", "environment": "prod"}]`

## Migrating from v1

- The `token`, `ignore` and `monitored` inputs were removed. Discovery is now based on Terraform/OpenTofu semantics instead of extension lists. Use `include` / `exclude` (discovery scope) and `files` / `files_ignore` (diff scope) instead of `ignore`.
- The v1 `modules` output was replaced by `root_modules` (deployable modules only, JSON array of paths), `fromJSON()` fan-out keeps working. Full detail lives in the `module_changes` and `dependency_graph` outputs.
- Modules are no longer detected from `.yaml` / `.tpl` files alone, which removes the false positives v1 was prone to. Files inside a module directory (templates, YAML, etc.) still mark that module as changed.
- Change detection now uses local git diffs via tj-actions/changed-files instead of the GitHub compare API, adding support for merge queues, shallow clones and more event types.

## Development

```bash
npm ci
npm run all   # format check, lint, typecheck, test, build
```

`dist/` is committed and verified by CI (`check-dist`); rebuild with `npm run build` after changing `src/`.
