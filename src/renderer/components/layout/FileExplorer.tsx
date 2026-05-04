import { Box, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { IPC } from "../../../shared/ipc-channels";
import type { FileNode } from "../../../shared/ipc-types";

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

  if (loading) return <Typography variant="body2">Loading...</Typography>;
  if (!tree) return <Typography variant="body2">No files.</Typography>;

  return (
    <Box sx={{ p: 1, overflow: "auto" }}>
      <Typography variant="subtitle2" gutterBottom>
        Project Files
      </Typography>
      <FileTreeNode node={tree} depth={0} />
    </Box>
  );
}

function FileTreeNode({ node, depth }: { node: FileNode; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const isDir = node.isDirectory;

  return (
    <Box sx={{ pl: depth * 1.5 }}>
      <Typography
        variant="body2"
        sx={{
          cursor: isDir ? "pointer" : "default",
          fontFamily: "monospace",
          fontSize: "0.8rem",
        }}
        onClick={() => isDir && setExpanded(!expanded)}
      >
        {isDir ? (expanded ? "📂" : "📁") : "📄"} {node.name}
      </Typography>
      {isDir &&
        expanded &&
        node.children?.map((child) => (
          <FileTreeNode key={child.path} node={child} depth={depth + 1} />
        ))}
    </Box>
  );
}
