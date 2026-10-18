/** Shared by native and sandboxed Host entry points. Unknown opcodes are denied. */
export function fileBrokerPermissions(method: string): string[] | null {
  if (['roots', 'list', 'stat', 'search', 'find', 'grep', 'read', 'read_binary', 'watch'].includes(method)) return ['resources.directory.read']
  if (method === 'edit') return ['resources.directory.read', 'resources.directory.write']
  if (['mkdir', 'write', 'write_binary', 'move', 'delete'].includes(method)) return ['resources.directory.write']
  return null
}
