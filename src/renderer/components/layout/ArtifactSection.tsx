import FileExplorer from "./FileExplorer";

interface ArtifactSectionProps {
  projectId: string;
}

export default function ArtifactSection({ projectId }: ArtifactSectionProps) {
  return <FileExplorer projectId={projectId} />;
}
