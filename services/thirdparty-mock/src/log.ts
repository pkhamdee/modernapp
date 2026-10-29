// Structured JSON logs to stdout (read with kubectl logs).
export function log(level: 'info' | 'warn' | 'error', message: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, message, ...fields }))
}
