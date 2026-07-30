export type Engine = 'terraform' | 'tofu'

export type ModuleClass = 'root' | 'child'

export type ChangeStatus =
  'added' | 'copied' | 'modified' | 'renamed' | 'type_changed' | 'deleted'

export interface ModuleAnalysis {
  /** POSIX path of the module directory, relative to the repo root. */
  path: string
  engine: Engine
  /**
   * Markers that alone prove this is a deployable root module
   * (backend/cloud/encryption block, lock file, state file).
   */
  definitiveMarkers: string[]
  /**
   * Weaker root indicators (provider configuration, tfvars files); at least
   * two are required to classify a module as root.
   */
  supportingMarkers: string[]
  /** Module paths (repo-relative) this module depends on via local `source` refs. */
  dependencies: string[]
}

export interface ClassifiedModule extends ModuleAnalysis {
  moduleClass: ModuleClass
}
