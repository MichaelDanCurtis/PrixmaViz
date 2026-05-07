import { useAppStore } from "../store";

export function ErrorPanel({ message }: { message: string }) {
  const setError = useAppStore((s) => s.setError);
  return (
    <div className="error">
      <pre>{message}</pre>
      <button onClick={() => setError(null)}>Dismiss</button>
    </div>
  );
}
