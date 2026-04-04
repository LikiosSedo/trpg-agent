// Type declaration for open-claude-cli (no official @types package)
declare module 'open-claude-cli/engine' {
  export function createEngine(options: any): any
  export function createSession(options: any): any
  export class Agent {
    constructor(options: any)
    messages: any[]
    run(input: string): AsyncGenerator<any>
    getMessages(): any[]
    [key: string]: any
  }
  export class Tool {
    constructor(options: any)
    static create(options: any): Tool
    execute(input: any, context?: any): Promise<any>
    [key: string]: any
  }
  export type ToolDefinition = any
  export type ToolResult = any
}
