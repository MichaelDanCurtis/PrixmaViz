interface Props {
  workspaceUrl: string;
  onDismiss: () => void;
  onNeverShowAgain: () => void;
}

export function WelcomePanel({ workspaceUrl, onDismiss, onNeverShowAgain }: Props) {
  return (
    <div className="welcome-overlay" onClick={onDismiss}>
      <div className="welcome-panel" onClick={(e) => e.stopPropagation()}>
        <h2>Welcome to PrixmaViz</h2>
        <p>
          This is your workspace. Your AI assistant can render diagrams here
          and you can annotate them.
        </p>
        <p>Your workspace URL is:</p>
        <pre className="welcome-url">{workspaceUrl}</pre>
        <p className="welcome-warning">
          <strong>Bookmark it.</strong> Anyone with the URL can see your work.
        </p>
        <div className="welcome-actions">
          <button onClick={onDismiss}>Got it</button>
          <button onClick={onNeverShowAgain}>Don't show again</button>
        </div>
      </div>
    </div>
  );
}
