// --- Permission mode definitions and config schema ---

import { z } from "zod"

export const PERMISSION_MODES = ["default", "acceptEdits", "plan", "yolo"] as const
export type PermissionMode = (typeof PERMISSION_MODES)[number]

export const permissionModeSchema = z.enum(PERMISSION_MODES)

export interface PermissionRule {
  pattern: string
  action: "allow" | "deny" | "confirm"
}

export const permissionConfigSchema = z.object({
  mode: permissionModeSchema.default("default"),
  allow: z.array(z.string()).default([]),
  deny: z.array(z.string()).default([]),
  confirm: z.array(z.string()).default([]),
})

export type PermissionConfig = z.infer<typeof permissionConfigSchema>
