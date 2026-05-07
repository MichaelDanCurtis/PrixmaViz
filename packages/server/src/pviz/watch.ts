import { watch, type FSWatcher } from "node:fs";
import { existsSync, mkdirSync } from "node:fs";

export type WatchCallback = () => void;

export class DiagramsWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly dir: string,
    private readonly onChange: WatchCallback,
    private readonly debounceMs: number = 80,
  ) {}

  start(): void {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    this.watcher = watch(this.dir, () => this.fire());
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }

  private fire(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.onChange();
    }, this.debounceMs);
  }
}
