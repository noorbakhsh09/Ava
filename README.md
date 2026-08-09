# Ava Agent

Ava is an Electron control plane for a local coding agent. The desktop app stores configuration,
checks connections, and runs a background worker that connects:

- Telegram for trusted-user commands
- Codex CLI for repository work through a configurable Responses-compatible gateway
- GitHub CLI for authenticated branch, push, issue, release, and pull-request workflows
- PostgreSQL through Prisma for jobs and audit events

Docker is not used or required. PostgreSQL can be any local, hosted, or managed instance reachable
from the Mac running Electron.

> [!WARNING]
> Ava is an experimental local coding agent. It can modify every descendant of an allowed workspace
> root and can use configured GitHub credentials. Review the security model before exposing the bot.

## Run it

Prerequisites: Bun, Codex CLI, GitHub CLI (`gh`), a PostgreSQL database URL, and a Telegram bot token.

```bash
bun install
bun run db:generate
bun run dev
```

On the first Electron launch:

1. Paste the PostgreSQL connection URL and save.
2. Click **Apply migrations**. This runs only the migrations committed under `prisma/migrations`.
3. Add the Telegram bot token and numeric trusted administrator IDs.
4. Replace the example Codex gateway URL/provider with your own Responses-compatible endpoint and
   add its auth token if the existing Codex login is not used.
5. Add a fine-grained GitHub token, or authenticate the local CLI with `gh auth login`.
6. Add one or more absolute repository or parent-folder paths under **Workspace safety**. Every
   descendant project is available to coding jobs.
7. Save. The connection status cards should become green.

The desktop interface has four tabs:

- **Settings** contains connection status and all runtime configuration.
- **Chat** is a persistent conversation with Ava. It always runs as a trusted administrator, so
  memory and coding actions do not require Telegram approval.
- **Activity** lists all persisted user and assistant messages newest-first with server-side
  pagination and 10, 30, 50, or 100 rows per page (50 by default).
- **Memories** lists global memory records and lets the desktop administrator delete individual
  memories, including operational Telegram response rules.

Secrets are encrypted using Electron `safeStorage` (macOS Keychain) and written to Ava's Electron
`userData/settings.json`. Secrets are not returned to the renderer after saving. A blank secret field
means “keep the existing value.”

## Telegram commands

Numeric IDs in **Trusted administrator Telegram IDs** can chat and execute memory, coding, and
GitHub actions directly. Everyone else gets chat-only access: their normal messages are answered,
but memory or coding/GitHub actions become pending approval requests instead of executing.

### Groups, channels, and forum topics

Ava supports private groups, supergroups, channel posts, linked channel discussion groups, and
forum topics. By default, every message reaches Ava and receives a response. Replies stay in the
same forum topic. Chat history, coding-conversation selection, job progress, and approval delivery
also remain in that topic.

When a trusted administrator mentions Ava while replying to somebody else's message, requests such
as “answer this” include the replied-to author and text in Ava's context. A channel post does not
reveal the human administrator's Telegram user ID, so identity-sensitive administrator actions
should be sent from the linked discussion group or a normal group topic.

A trusted administrator can change the response rule naturally in any group or topic:

```text
@ava_bot only respond to my messages in this topic
@ava_bot only respond to mentions and replies in this topic
@ava_bot respond to everyone again
```

The restriction is stored in the existing global `Memory` model. Its value contains the chat ID,
topic ID, response mode (`owner_only` or `mentions_only`), and administrator ID. Restoring everyone
deletes that operational memory; no separate response-policy table is used. Each topic has its own
memory entry, so one topic's rule does not affect another topic.

Add Ava to a group normally. To process every group message, disable privacy mode for the bot with
BotFather (`/setprivacy` → select the bot → **Disable**) or make the bot a group administrator.
To process broadcast channel posts, add her as a channel administrator with permission to post.

Each pending request is stored in PostgreSQL and sent to every trusted administrator with
**Approve** and **Deny** buttons. The requester is told that Ava alerted the administrator and is
waiting for approval. Approval executes the action exactly once. For approved coding jobs, the
requester receives only an approval notice while progress and the final result are delivered to the
administrator who approved the request. The administrator's completed result includes **Send to
requester** and **Don't send** buttons. Either choice is stored atomically and removes the buttons;
the result is shared only when the administrator chooses to send it. Denial notifies the requester
without changing memory or starting a job.

Ordinary messages do not need a command. Ava handles them as a conversation using
`gpt-5.6-terra` with medium reasoning. Per-chat conversation history and shared global memories are
stored in PostgreSQL. Every user receives the same saved memories. Replies are converted from agent
Markdown to Telegram HTML, including headings, bold,
lists, inline code, code blocks, links, and quotes.

Natural-language actions are routed through a constrained tool-call contract:

- For trusted administrators, “Always answer me in Persian” calls `memory_upsert`, “Forget my
  language preference” calls `memory_delete`, and “Fix the login bug and add tests” calls
  `create_job`.
- Changing a saved preference calls `memory_update`, which replaces the existing value under the
  same key. Asking Ava to forget it calls `memory_delete`.
- Ava asks the chat model to render confirmed system events, so approval, lock/unlock, memory, and
  queue confirmations follow saved language and style preferences too.
- Chat-only users receive only `request_approval`; direct memory and coding tools are absent from
  their model schema.

The model cannot use these calls to select an arbitrary filesystem path or execute a raw shell command.
The command interface remains available for explicit control:

```text
/status
/conversation
/conversation new Project name
/ask describe the coding change
/jobs
```

Telegram's command menu is registered only for trusted administrator chats. Typing `/` shows these
suggestions to administrators; chat-only users do not receive a command menu.

`/conversation` displays the saved coding conversations as Telegram buttons. Selecting one makes it
the active project for that administrator's chat. `/conversation new Project name` creates and
selects a new one. The first natural-language coding task also creates a conversation automatically
when none is selected. Each conversation stores its Codex thread ID, so later tasks use
`codex exec resume` and continue with the same project context instead of starting over.

`/ask` queues a durable turn in the selected conversation and launches `codex exec --json` without a shell. Codex runs in
`workspace-write` sandbox mode using `gpt-5.6-sol` with high reasoning. Every configured workspace
root is passed to the sandbox, so a root may contain many child repositories. The result is sent back to the same Telegram chat and stored in PostgreSQL with
its audit events. When a chat-only user's job is approved, that result is sent to the approving
administrator instead of the requester.

While Codex works, Ava sends one temporary progress message. Command execution, tool activity,
file changes, reasoning summaries, and agent updates are appended by editing that same message at a
rate-limited interval. When the turn finishes, Ava removes the progress message and sends the final
result normally.

## GitHub CLI

Coding jobs can use `git` and `gh` to create branches and commits, push changes, work with issues
and releases, and open pull requests. Natural requests such as “put the current fix on a branch and
open a PR” are routed to the coding worker without requiring a Telegram command.

Ava checks both the installed `gh` binary and its active `github.com` authentication. A token entered
in Electron is encrypted with `safeStorage` and passed only to coding-job child processes as
`GH_TOKEN`/`GITHUB_TOKEN`. Prefer a fine-grained token limited to the required repositories with
**Contents** and **Pull requests** permissions; add Issues or Workflows permissions only when needed.

Network access, the narrow GitHub credential environment, and write access to the selected
repository's Git metadata are enabled only for coding jobs. Ava's job policy requires explicit user
intent before force-pushing, deleting branches, merging or closing pull requests, or changing
repository settings.

## Codex gateway

The values below are examples only. Replace both the provider name and URL in the Electron UI with
the values for your own Responses-compatible gateway. Each Codex process receives equivalent
overrides to:

```toml
model_provider = "custom_gateway"

[model_providers.custom_gateway]
name = "openai"
base_url = "https://codex-gateway.example.com/v1"
wire_api = "responses"
supports_websockets = true
requires_openai_auth = true
```

`example.com` is intentionally non-operational; Ava does not ship with a private or hosted gateway.
The gateway must expose the model identifiers configured by the application. The encrypted gateway
token, when supplied, is exposed only to the Codex child process as `OPENAI_API_KEY`. With no token
in Ava, Codex uses its existing local login.
The Codex status check performs a short, ephemeral, read-only request and expects `AVA_OK`, so it
verifies the gateway rather than merely checking that the binary exists.

## Development checks

```bash
bun run typecheck
bun test
bun run build
```

## Build a macOS DMG

On macOS, install dependencies and run:

```bash
bun run dist:mac
```

The native packaging script uses Electron's installed app template plus `sips`, `codesign`, and
`hdiutil`. It writes an architecture-specific image such as
`release/Ava-Agent-<version>-<architecture>.dmg`. The local build uses ad-hoc signing so it can be tested without
an Apple Developer account.

For a public download without Gatekeeper warnings, sign the `.app` with a **Developer ID
Application** certificate before creating the DMG, then notarize and staple it with Apple's
`notarytool`. Never commit signing certificates, App Store Connect keys, or their passwords.

The app intentionally does not provide arbitrary shell commands, arbitrary filesystem paths, or
Telegram username-based authorization. Destructive GitHub operations still require explicit user
intent even after an administrator approves the requested job.

## Contributing and security

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request and
use the private process in [SECURITY.md](SECURITY.md) for vulnerabilities. See [NOTICE.md](NOTICE.md)
for third-party trademark and artwork notes.

## License

Released under the [MIT License](LICENSE).
