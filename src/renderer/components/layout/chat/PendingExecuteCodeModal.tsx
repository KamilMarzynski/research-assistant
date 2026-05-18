import type { ExecuteCodeApprovalPayload } from "../../../../shared/ipc-types";
import ReviewDialog from "./ReviewDialog";

interface PendingExecuteCodeModalProps {
  request: ExecuteCodeApprovalPayload;
  onApprove: () => void;
  onDeny: () => void;
  onClose: () => void;
}

export default function PendingExecuteCodeModal({
  request,
  onApprove,
  onDeny,
  onClose,
}: PendingExecuteCodeModalProps) {
  return (
    <ReviewDialog
      title="Review Code Execution"
      onApproveOnce={onApprove}
      onDeny={onDeny}
      onClose={onClose}
      dataTestid="pending-execute-code-modal"
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span className="chip">{request.language}</span>
        {request.networkEnabled && <span className="chip chip--warn">network enabled</span>}
        {request.requestedPaths.length > 0 && (
          <span className="chip chip--warn">path access included</span>
        )}
      </div>
      <p style={{ color: "var(--ink-2)", fontSize: 13.5, marginBottom: 8 }}>
        The agent wants to run sandboxed code. Review the intent, inputs, and code before approving.
      </p>
      <span className="t-mono t-tertiary" style={{ fontSize: 12, display: "block" }}>
        <strong>Intent:</strong> {request.intent}
      </span>
      <span className="t-mono t-tertiary" style={{ fontSize: 12, marginTop: 8, display: "block" }}>
        <strong>Code hash:</strong> {request.codeHash}
      </span>
      {(request.workspaceFiles.length > 0 || request.inlineFiles.length > 0) && (
        <div style={{ marginTop: 12, fontSize: 12, color: "var(--ink-2)" }}>
          {request.workspaceFiles.length > 0 && (
            <div>
              <strong>Workspace files:</strong> {request.workspaceFiles.join(", ")}
            </div>
          )}
          {request.inlineFiles.length > 0 && (
            <div>
              <strong>Inline files:</strong> {request.inlineFiles.join(", ")}
            </div>
          )}
        </div>
      )}
      {request.requestedPaths.length > 0 && (
        <div style={{ marginTop: 12, fontSize: 12, color: "var(--ink-2)" }}>
          <strong>Additional path approval:</strong>{" "}
          {request.requestedPaths.map((p) => p.path).join(", ")}
        </div>
      )}
      <pre
        className="thin-scroll"
        style={{
          padding: 12,
          background: "var(--surface-2)",
          borderRadius: "var(--r-md)",
          fontSize: 12,
          maxHeight: 260,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          marginTop: 12,
        }}
      >
        {request.code}
      </pre>
    </ReviewDialog>
  );
}
