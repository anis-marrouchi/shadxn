// --- A2A Protocol types per Google A2A spec ---

// Agent capability advertisement
export interface AgentCard {
  name: string
  description: string
  url: string
  version: string
  capabilities: {
    streaming: boolean
    pushNotifications: boolean
    stateTransitionHistory: boolean
  }
  skills: AgentSkill[]
  defaultInputModes: string[]
  defaultOutputModes: string[]
}

export interface AgentSkill {
  id: string
  name: string
  description: string
  tags: string[]
  examples?: string[]
}

// Task state machine
export type TaskState =
  | "submitted"
  | "working"
  | "input-required"
  | "completed"
  | "failed"
  | "canceled"

export interface Task {
  id: string
  state: TaskState
  messages: TaskMessage[]
  artifacts: TaskArtifact[]
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface TaskMessage {
  role: "user" | "agent"
  parts: MessagePart[]
}

export type MessagePart =
  | TextPart
  | FilePart
  | DataPart

export interface TextPart {
  type: "text"
  text: string
}

export interface FilePart {
  type: "file"
  file: {
    name: string
    mimeType?: string
    bytes?: string // base64 encoded
    uri?: string
  }
}

export interface DataPart {
  type: "data"
  data: Record<string, unknown>
}

// Generated outputs
export interface TaskArtifact {
  name: string
  description?: string
  parts: MessagePart[]
  index: number
}

// SSE event format
export interface TaskStatusUpdate {
  id: string
  state: TaskState
  message?: TaskMessage
  artifact?: TaskArtifact
  final: boolean
  metadata?: Record<string, unknown>
}

// JSON-RPC 2.0 types
export interface JsonRpcRequest {
  jsonrpc: "2.0"
  id: string | number
  method: string
  params?: Record<string, unknown>
}

export interface JsonRpcResponse {
  jsonrpc: "2.0"
  id: string | number
  result?: unknown
  error?: JsonRpcError
}

export interface JsonRpcError {
  code: number
  message: string
  data?: unknown
}

// A2A-specific error codes
export const A2A_ERRORS = {
  TASK_NOT_FOUND: { code: -32001, message: "Task not found" },
  TASK_NOT_CANCELABLE: { code: -32002, message: "Task cannot be canceled" },
  INVALID_PARAMS: { code: -32602, message: "Invalid params" },
  INTERNAL_ERROR: { code: -32603, message: "Internal error" },
  METHOD_NOT_FOUND: { code: -32601, message: "Method not found" },
  PARSE_ERROR: { code: -32700, message: "Parse error" },
} as const
