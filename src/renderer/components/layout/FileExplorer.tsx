import { useEffect, useState } from "react";
import { IPC } from "../../../shared/ipc-channels";
import type { FileNode } from "../../../shared/ipc-types";
import { IconDoc, IconFolder } from "../shared/Icons";

interface FileExplorerProps {
  projectId: string;
}

export default function FileExplorer({ projectId }: FileExplorerProps) {
  const [tree, setTree] = useState<FileNode | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    window.electronAPI
      .invoke(IPC.GET_FILE_TREE, { projectId })
      .then((root) => setTree(root as FileNode))
      .catch((err) => console.error("[FileExplorer] failed to load tree:", err))
      .finally(() => setLoading(false));
  }, [projectId]);

  if (loading)
    return <span style={{ fontSize: 12, color: "var(--ink-3)", padding: 16 }}>Loading...</span>;
  if (!tree)
    return <span style={{ fontSize: 12, color: "var(--ink-3)", padding: 16 }}>No files.</span>;

  return (
    <div className="thin-scroll" style={{ padding: 12, overflow: "auto", flex: 1 }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>
        Project Files
      </div>
      <FileTreeNode node={tree} depth={0} />
    </div>
  );
}

function FileTreeNode({ node, depth }: { node: FileNode; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const isDir = node.isDirectory;

  const baseStyle = {
    cursor: isDir ? "pointer" : "default",
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    display: "flex",
    alignItems: "center",
    gap: 4,
    padding: "2px 0",
    color: "var(--ink-2)",
  } as const;

  const icon = isDir ? (
    <IconFolder size={13} strokeColor="var(--ink-3)" />
  ) : (
    <IconDoc size={13} strokeColor="var(--ink-3)" />
  );

  return (
    <div style={{ paddingLeft: depth * 12 }}>
      {isDir ? (
        // biome-ignore lint/a11y/useSemanticElements: styled as a file-tree row, not a native button
        <div
          role="button"
          tabIndex={0}
          style={baseStyle}
          onClick={() => setExpanded(!expanded)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setExpanded(!expanded);
            }
          }}
        >
          {icon}
          <span>{node.name}</span>
        </div>
      ) : (
        <div style={baseStyle}>
          {icon}
          <span>{node.name}</span>
        </div>
      )}
      {isDir &&
        expanded &&
        node.children?.map((child) => (
          <FileTreeNode key={child.path} node={child} depth={depth + 1} />
        ))}
    </div>
  );
}
