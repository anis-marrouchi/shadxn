// agentx — public library API

// Core agent orchestrator
export {
  createAgentContext,
  generate,
  generateStream,
  type AgentContext,
  type GenerateOptions,
  type GenerateResult,
  type GenerateStreamEvent,
} from "./agent"

// Providers
export {
  createProvider,
  ClaudeProvider,
  ClaudeCodeProvider,
  type ProviderName,
} from "./agent/providers"

export type {
  AgentProvider,
  AgentConfig,
  OutputType,
  GenerationMessage,
  GenerationResult,
  GeneratedFile,
  ProviderOptions,
  StreamEvent,
  AnthropicMessage,
  ContentBlock,
  RawGenerationResult,
} from "./agent/providers/types"

export { agentConfigSchema, OUTPUT_TYPES, outputTypeDescriptions } from "./agent/providers/types"

// Context
export { detectTechStack, formatTechStack, type TechStack } from "./agent/context/tech-stack"
export { detectSchemas, formatSchemas, type ProjectSchemas } from "./agent/context/schema"
export { gatherContext7Docs } from "./agent/context/context7"

// Skills
export { loadLocalSkills, matchSkillsToTask, parseSkillFile, parseSkillContent } from "./agent/skills/loader"
export { installSkillPackage, generateSkillMd, listInstalledSkills } from "./agent/skills/registry"
export { generateSkill } from "./agent/skills/generator"

// Outputs
export { resolveOutputType, OUTPUT_CONFIGS, type OutputConfig } from "./agent/outputs/types"

// Tools
export { getAnthropicTools, getLegacyTools, formatToolsForSystemPrompt, ALL_TOOL_NAMES } from "./agent/tools"
export { ToolExecutor, type ToolCallInput, type ToolResult, type ToolExecutorOptions } from "./agent/tools"

// Runtime
export {
  ShadxnRuntime,
  Memory,
  HealEngine,
  EnhanceEngine,
  Pipeline,
  type MemoryEntry,
  type MemoryStore,
  type HealConfig,
  type HealResult,
  type EnhanceConfig,
  type EnhanceResult,
  type PipelineRequest,
  type PipelineResponse,
  type MiddlewareFn,
  type RuntimeConfig,
} from "./runtime"

// MCP
export { startMcpServer } from "./mcp"

// Memory hierarchy
export { MemoryHierarchy } from "./memory"
export { ContextBuilder, resolveAtImports, loadProjectInstructions } from "./memory"

// Observability
export { UsageTracker, globalTracker, debug, setDebug, isDebug, exportSession } from "./observability"
export type { StepUsage, ModelUsage, UsageSummary } from "./observability"

// Permissions
export { PermissionManager, globalPermissions, permissionModeSchema, permissionConfigSchema, PERMISSION_MODES } from "./permissions"
export type { PermissionMode, PermissionConfig, PermissionRule, PermissionAction } from "./permissions"

// Hooks
export { HookRegistry, loadHooks, globalHooks, HOOK_EVENTS, BLOCKING_EVENTS } from "./hooks"
export type { HookEvent, HookDefinition, HookContext, HookResult, HookHandler } from "./hooks"

// Git
export { GitManager } from "./git"
export type { GitStatus, GitLogEntry, GitDiffFile, GitCommitResult } from "./git"

// REPL
export { ReplEngine, createSession, saveSession, loadSession, loadLatestSession, listSessions } from "./repl"
export { isCommand, parseCommand, getCommand, registerCommand } from "./repl"
export type { ReplOptions, Session } from "./repl"

// A2A
export { A2AServer } from "./a2a"
export type { A2AServerConfig, AgentCard, Task, TaskState, TaskMessage, TaskArtifact, TaskStatusUpdate } from "./a2a"

// Auth & Utils
export {
  loadAuthConfig,
  saveAuthConfig,
  resolveToken,
  ensureCredentials,
  runModelSetup,
  type AuthConfig,
} from "./utils/auth-store"

export { logger } from "./utils/logger"
export { handleError } from "./utils/handle-error"
export { getPackageInfo } from "./utils/get-package-info"
