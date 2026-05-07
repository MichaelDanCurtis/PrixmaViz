export interface CliArgs {
  port: number;
  projectRoot: string;
  mcpMode: boolean;
  krokiUrl?: string;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    port: 0,
    projectRoot: process.cwd(),
    mcpMode: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--port":
        args.port = Number(argv[++i] ?? "0");
        break;
      case "--project-root":
        args.projectRoot = argv[++i] ?? process.cwd();
        break;
      case "--mcp":
        args.mcpMode = true;
        break;
      case "--kroki-url":
        args.krokiUrl = argv[++i];
        break;
    }
  }
  return args;
}
