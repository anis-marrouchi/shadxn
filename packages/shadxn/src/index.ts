// shadxn — public library API

// Registry utilities
export {
  fetchTree,
  getItemTargetPath,
  getRegistryBaseColor,
  getRegistryBaseColors,
  getRegistryIndex,
  getRegistryStyles,
  resolveTree,
  setBaseUrl,
  getBaseUrl,
  isUrl,
  fetchSchema,
} from "./utils/registry"

export { registryIndexSchema, registrySchema } from "./utils/registry/schema"

// Transformers
export { transform } from "./utils/transformers"

// Config
export {
  getConfig,
  resolveConfigPaths,
  rawConfigSchema,
  DEFAULT_COMPONENTS,
  DEFAULT_TAILWIND_CONFIG,
  DEFAULT_TAILWIND_CSS,
  DEFAULT_UTILS,
  type Config,
  type RawConfig,
} from "./utils/get-config"

// Project info
export { getProjectConfig, preFlight } from "./utils/get-project-info"

// Package manager
export { getPackageManager } from "./utils/get-package-manager"

// Import resolution
export { resolveImport } from "./utils/resolve-import"

// Templates
export {
  UTILS,
  UTILS_JS,
  TAILWIND_CONFIG,
  TAILWIND_CONFIG_WITH_VARIABLES,
  TAILWIND_CONFIG_TS,
  TAILWIND_CONFIG_TS_WITH_VARIABLES,
} from "./utils/templates"

// Re-export agentx for convenience
export { logger, handleError } from "agentx"
