import { FormEvent, useEffect, useState } from "react";

type FormState = {
  postgresUrl: string;
  telegramBotToken: string;
  telegramAllowedUserIds: string;
  codexBaseUrl: string;
  codexAuthToken: string;
  codexProvider: string;
  githubToken: string;
  workspaces: string;
};

const emptyForm: FormState = {
  postgresUrl: "",
  telegramBotToken: "",
  telegramAllowedUserIds: "",
  codexBaseUrl: "https://codex-gateway.example.com/v1",
  codexAuthToken: "",
  codexProvider: "custom_gateway",
  githubToken: "",
  workspaces: "",
};

function StatusCard({ name, status }: { name: string; status?: ServiceStatus }) {
  const state = status?.state ?? "checking";
  return (
    <article className={`status-card ${state}`}>
      <div className="status-heading">
        <span className="status-dot" />
        <strong>{name}</strong>
        <span className="status-label">{state}</span>
      </div>
      <p>{status?.message ?? "Loading…"}</p>
    </article>
  );
}

function SecretInput({
  label,
  configured,
  value,
  onChange,
  hint,
}: {
  label: string;
  configured: boolean;
  value: string;
  onChange(value: string): void;
  hint?: string;
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        type="password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={configured ? "Configured — leave blank to keep" : "Not configured"}
        autoComplete="off"
      />
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function App() {
  const [bootstrap, setBootstrap] = useState<Bootstrap>();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!window.ava) {
      setError("The secure Electron bridge is unavailable. Open Ava from the Electron window, not a regular browser tab.");
      return;
    }

    void window.ava
      .bootstrap()
      .then((data) => {
        setBootstrap(data);
        setForm((current) => ({
          ...current,
          telegramAllowedUserIds: data.settings.telegramAllowedUserIds.join(", "),
          codexBaseUrl: data.settings.codexBaseUrl,
          codexProvider: data.settings.codexProvider,
          workspaces: data.settings.workspaces.join("\n"),
        }));
      })
      .catch((reason) => setError(String(reason)));

    const timer = window.setInterval(() => {
      void window.ava.status().then((status) =>
        setBootstrap((current) => (current ? { ...current, status } : current)),
      );
    }, 4_000);
    return () => window.clearInterval(timer);
  }, []);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!window.ava) return;
    setBusy(true);
    setError("");
    setNotice("Saving encrypted settings and restarting services…");
    try {
      const result = await window.ava.saveSettings({
        ...form,
        telegramAllowedUserIds: form.telegramAllowedUserIds
          .split(/[\s,]+/)
          .map((item) => item.trim())
          .filter(Boolean),
        workspaces: form.workspaces
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean),
      });
      setBootstrap(result);
      setForm((current) => ({
        ...current,
        postgresUrl: "",
        telegramBotToken: "",
        codexAuthToken: "",
        githubToken: "",
      }));
      setNotice("Settings saved. Connection checks completed.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setNotice("");
    } finally {
      setBusy(false);
    }
  }

  async function recheck() {
    if (!window.ava) return;
    setBusy(true);
    setError("");
    try {
      const status = await window.ava.recheck();
      setBootstrap((current) => (current ? { ...current, status } : current));
      setNotice("Connections checked.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function migrate() {
    if (!window.ava) return;
    setBusy(true);
    setError("");
    setNotice("Applying committed Prisma migrations…");
    try {
      const result = await window.ava.migrateDatabase();
      setBootstrap((current) => (current ? { ...current, status: result.status } : current));
      setNotice("Database schema is up to date.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setNotice("");
    } finally {
      setBusy(false);
    }
  }

  const settings = bootstrap?.settings;
  const status = bootstrap?.status;

  return (
    <main>
      <header>
        <img className="brand-mark" src="/ava-icon.png" alt="Ava" />
        <div>
          <p className="eyebrow">LOCAL AGENT CONTROL PLANE</p>
          <h1>Ava Agent</h1>
          <p className="subtitle">Control your Codex coding runtime securely through Telegram.</p>
        </div>
        <div className={`agent-pill ${status?.agentReady ? "ready" : "waiting"}`}>
          <span /> {status?.agentReady ? "Agent ready" : "Setup required"}
        </div>
      </header>

      <section className="status-grid" aria-label="Connection status">
        <StatusCard name="PostgreSQL" status={status?.database} />
        <StatusCard name="Telegram" status={status?.telegram} />
        <StatusCard name="Codex gateway" status={status?.codex} />
        <StatusCard name="GitHub CLI" status={status?.github} />
      </section>

      <div className="toolbar">
        <div>
          {notice && <p className="notice">{notice}</p>}
          {error && <p className="error-message">{error}</p>}
        </div>
        <button className="secondary" type="button" onClick={recheck} disabled={busy}>
          Recheck connections
        </button>
      </div>

      <form onSubmit={save}>
        <section className="panel">
          <div className="panel-title">
            <div><span>01</span><h2>PostgreSQL</h2></div>
            <button className="ghost" type="button" onClick={migrate} disabled={busy || !settings?.hasPostgresUrl}>
              Apply migrations
            </button>
          </div>
          <SecretInput
            label="Connection URL"
            configured={Boolean(settings?.hasPostgresUrl)}
            value={form.postgresUrl}
            onChange={(value) => update("postgresUrl", value)}
            hint={settings?.postgresUrlHint || "Use any reachable PostgreSQL instance; Docker is not required."}
          />
        </section>

        <section className="panel">
          <div className="panel-title"><div><span>02</span><h2>Telegram</h2></div></div>
          <div className="two-column">
            <SecretInput
              label="Bot token"
              configured={Boolean(settings?.hasTelegramBotToken)}
              value={form.telegramBotToken}
              onChange={(value) => update("telegramBotToken", value)}
              hint="Create the bot with @BotFather. The token is encrypted at rest."
            />
            <label>
              <span>Trusted administrator Telegram IDs</span>
              <input
                value={form.telegramAllowedUserIds}
                onChange={(event) => update("telegramAllowedUserIds", event.target.value)}
                placeholder="123456789, 987654321"
              />
              <small>Numeric IDs only. Other users get chat-only access; global memory and coding actions require administrator approval.</small>
            </label>
          </div>
        </section>

        <section className="panel">
          <div className="panel-title"><div><span>03</span><h2>Codex gateway</h2></div></div>
          <div className="two-column">
            <label>
              <span>Responses API base URL</span>
              <input value={form.codexBaseUrl} onChange={(event) => update("codexBaseUrl", event.target.value)} />
            </label>
            <label>
              <span>Provider name</span>
              <input value={form.codexProvider} onChange={(event) => update("codexProvider", event.target.value)} />
            </label>
          </div>
          <SecretInput
            label="Gateway auth token"
            configured={Boolean(settings?.hasCodexAuthToken)}
            value={form.codexAuthToken}
            onChange={(value) => update("codexAuthToken", value)}
            hint="Passed only to the Codex child process; never sent to Telegram or PostgreSQL."
          />
        </section>

        <section className="panel">
          <div className="panel-title"><div><span>04</span><h2>GitHub CLI</h2></div></div>
          <SecretInput
            label="GitHub token"
            configured={Boolean(settings?.hasGithubToken)}
            value={form.githubToken}
            onChange={(value) => update("githubToken", value)}
            hint="Use a fine-grained token with repository Contents and Pull requests permissions. Ava also supports an existing gh auth login session."
          />
        </section>

        <section className="panel">
          <div className="panel-title"><div><span>05</span><h2>Workspace safety</h2></div></div>
          <label>
            <span>Allowed code parent folders — one absolute path per line</span>
            <textarea
              value={form.workspaces}
              onChange={(event) => update("workspaces", event.target.value)}
              rows={4}
              placeholder="/path/to/projects"
            />
            <small>Each listed folder and all of its descendants are available to coding jobs. Codex uses workspace-write sandboxing; network access is enabled only for coding jobs so git and gh can reach GitHub.</small>
          </label>
        </section>

        <footer className="save-bar">
          <p>Secrets are encrypted with macOS Keychain through Electron safeStorage.</p>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Working…" : "Save & restart services"}
          </button>
        </footer>
      </form>
    </main>
  );
}
