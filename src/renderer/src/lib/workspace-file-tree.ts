/**
 * Shared workspace file tree builder (same logic as RightPanel FileTree).
 */

export interface WorkspaceFileInfo {
  path: string
  is_dir?: boolean
  size?: number
  modified_at?: string
  created_at?: string
}

export interface TreeNode {
  name: string
  path: string
  is_dir: boolean
  size?: number
  created_at?: string
  modified_at?: string
  children: TreeNode[]
}

export function buildFileTree(files: WorkspaceFileInfo[]): TreeNode[] {
  const root: TreeNode[] = []
  const nodeMap = new Map<string, TreeNode>()

  const sortedFiles = [...files].sort((a, b) => {
    const aIsDir = a.is_dir ?? false
    const bIsDir = b.is_dir ?? false
    if (aIsDir && !bIsDir) return -1
    if (!aIsDir && bIsDir) return 1
    return a.path.localeCompare(b.path)
  })

  for (const file of sortedFiles) {
    const normalizedPath = file.path.startsWith("/") ? file.path.slice(1) : file.path
    const parts = normalizedPath.split("/")
    const fileName = parts[parts.length - 1]

    const node: TreeNode = {
      name: fileName,
      path: file.path,
      is_dir: file.is_dir ?? false,
      size: file.size,
      created_at: file.created_at,
      modified_at: file.modified_at,
      children: []
    }

    if (parts.length === 1) {
      root.push(node)
      nodeMap.set(normalizedPath, node)
    } else {
      let currentPath = ""
      let parentChildren = root

      for (let i = 0; i < parts.length - 1; i++) {
        currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i]

        let parentNode = nodeMap.get(currentPath)
        if (!parentNode) {
          parentNode = {
            name: parts[i],
            path: "/" + currentPath,
            is_dir: true,
            children: []
          }
          parentChildren.push(parentNode)
          nodeMap.set(currentPath, parentNode)
        }
        parentChildren = parentNode.children
      }

      parentChildren.push(node)
      nodeMap.set(normalizedPath, node)
    }
  }

  function sortChildren(nodes: TreeNode[]): void {
    nodes.sort((a, b) => {
      if (a.is_dir && !b.is_dir) return -1
      if (!a.is_dir && b.is_dir) return 1
      return a.name.localeCompare(b.name)
    })
    nodes.forEach((n) => sortChildren(n.children))
  }
  sortChildren(root)

  return root
}
