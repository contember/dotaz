# @dotaz/cli

Command-line access to a running [Dotaz](https://github.com/contember/dotaz) desktop app for humans and coding agents.

The CLI never receives database credentials. Reads run in backend-owned read-only sessions. Writes become proposals that only the user can run in the desktop app.

## Usage

Install [Bun](https://bun.sh/), start the Dotaz desktop app, and enable **Settings → Allow CLI access**. Then run:

```sh
bunx @dotaz/cli status
bunx @dotaz/cli --help
bunx @dotaz/cli rows local/users --limit 20
bunx @dotaz/cli query local "SELECT count(*) FROM users" --json
```

For a persistent `dotaz` command:

```sh
bun add --global @dotaz/cli
dotaz status
```

Use `dotaz <command> --help` for command-specific options. The full contract and exit-code reference live in the [agent CLI documentation](https://github.com/contember/dotaz/blob/main/docs/agent-cli.md).
