export { HookRegistry } from "./registry"
export { loadHooks } from "./loader"
export type { HookEvent, HookDefinition, HookContext, HookResult, HookHandler } from "./types"
export { HOOK_EVENTS, BLOCKING_EVENTS } from "./types"

import { HookRegistry } from "./registry"

// Singleton hook registry for the CLI process
export const globalHooks = new HookRegistry()
