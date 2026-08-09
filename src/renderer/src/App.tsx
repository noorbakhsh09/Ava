import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  Activity as ActivityIcon,
  Bot,
  Brain,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Database,
  FolderLock,
  GitPullRequest,
  MessageCircle,
  RefreshCw,
  Send as SendIcon,
  Settings as SettingsIcon,
  ShieldCheck,
  Trash2,
  UserRound,
  type LucideIcon,
} from "lucide-react";

type Tab = "settings" | "chat" | "activity" | "memories";

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

const activityPageSizes = [10, 30, 50, 100] as const;

const tabs: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "settings", label: "Settings", icon: SettingsIcon },
  { id: "chat", label: "Chat", icon: MessageCircle },
  { id: "activity", label: "Activity", icon: ActivityIcon },
  { id: "memories", label: "Memories", icon: Brain },
];

function StatusCard({ name, status, icon: Icon }: {
  name: string;
  status?: ServiceStatus;
  icon: LucideIcon;
}) {
  const state = status?.state ?? "checking";
  return (
    <article className={`status-card ${state}`}>
      <div className="status-heading">
        <span className="status-dot" />
        <Icon className="status-icon" aria-hidden="true" />
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

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>("chat");
  const [bootstrap, setBootstrap] = useState<Bootstrap>();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const [chatMessages, setChatMessages] = useState<ChatMessageRow[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState("");
  const messageListRef = useRef<HTMLDivElement>(null);

  const [activity, setActivity] = useState<ActivityPage>({
    rows: [],
    page: 1,
    pageSize: 50,
    total: 0,
    totalPages: 0,
  });
  const [activityPage, setActivityPage] = useState(1);
  const [activityPageSize, setActivityPageSize] = useState(50);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState("");
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [memoriesLoading, setMemoriesLoading] = useState(false);
  const [memoriesError, setMemoriesError] = useState("");
  const [memoriesNotice, setMemoriesNotice] = useState("");

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

  const loadChat = useCallback(async () => {
    if (!window.ava) return;
    try {
      setChatMessages(await window.ava.chatHistory(150));
      setChatError("");
    } catch (reason) {
      setChatError(reason instanceof Error ? reason.message : String(reason));
    }
  }, []);

  useEffect(() => {
    if (activeTab !== "chat") return;
    void loadChat();
    const timer = window.setInterval(() => void loadChat(), 4_000);
    return () => window.clearInterval(timer);
  }, [activeTab, loadChat]);

  useEffect(() => {
    if (activeTab !== "chat") return;
    const list = messageListRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [activeTab, chatMessages.length, chatBusy]);

  const loadActivity = useCallback(async () => {
    if (!window.ava) return;
    setActivityLoading(true);
    try {
      const result = await window.ava.activity(activityPage, activityPageSize);
      setActivity(result);
      setActivityPage(result.page);
      setActivityError("");
    } catch (reason) {
      setActivityError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setActivityLoading(false);
    }
  }, [activityPage, activityPageSize]);

  useEffect(() => {
    if (activeTab === "activity") void loadActivity();
  }, [activeTab, loadActivity]);

  const loadMemories = useCallback(async () => {
    if (!window.ava) return;
    setMemoriesLoading(true);
    try {
      setMemories(await window.ava.memories());
      setMemoriesError("");
    } catch (reason) {
      setMemoriesError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setMemoriesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "memories") void loadMemories();
  }, [activeTab, loadMemories]);

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

  async function sendChat(event?: FormEvent) {
    event?.preventDefault();
    if (!window.ava || chatBusy || !chatInput.trim()) return;
    const content = chatInput.trim();
    const optimistic: ChatMessageRow = {
      id: `optimistic-${Date.now()}`,
      telegramUserId: "electron:admin",
      telegramChatId: "electron:admin",
      telegramMessageThreadId: null,
      role: "USER",
      content,
      createdAt: new Date().toISOString(),
    };
    setChatMessages((current) => [...current, optimistic]);
    setChatInput("");
    setChatBusy(true);
    setChatError("");
    try {
      await window.ava.sendChat(content);
      await loadChat();
    } catch (reason) {
      setChatError(reason instanceof Error ? reason.message : String(reason));
      await loadChat();
    } finally {
      setChatBusy(false);
    }
  }

  function chatKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendChat();
    }
  }

  async function deleteMemory(memory: MemoryRow) {
    if (!window.ava || !window.confirm(`Delete memory “${memory.key}”?`)) return;
    setMemoriesError("");
    setMemoriesNotice("");
    try {
      await window.ava.deleteMemory(memory.id);
      setMemories((current) => current.filter((item) => item.id !== memory.id));
      setMemoriesNotice(`Deleted memory: ${memory.key}`);
    } catch (reason) {
      setMemoriesError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  const settings = bootstrap?.settings;
  const status = bootstrap?.status;
  const chatReady = status?.database.state === "connected" && status.codex.state === "connected";

  return (
    <main className={`${activeTab}-view`}>
      <header>
        <img className="brand-mark" src="/ava-icon.png" alt="Ava" />
        <div>
          <p className="eyebrow">LOCAL AGENT CONTROL PLANE</p>
          <h1>Ava Agent</h1>
          <p className="subtitle">Manage, chat, and review Ava from one secure desktop.</p>
        </div>
        <div className="header-actions">
          <div className={`agent-pill ${status?.agentReady ? "ready" : "waiting"}`}>
            <span /> {status?.agentReady ? "Agent ready" : "Setup required"}
          </div>
          <button className="secondary recheck-button" type="button" onClick={recheck} disabled={busy}>
            <RefreshCw aria-hidden="true" /> Recheck connections
          </button>
        </div>
      </header>

      <section className="status-grid" aria-label="Connection status">
        <StatusCard name="PostgreSQL" status={status?.database} icon={Database} />
        <StatusCard name="Telegram" status={status?.telegram} icon={SendIcon} />
        <StatusCard name="Codex gateway" status={status?.codex} icon={Cpu} />
        <StatusCard name="GitHub CLI" status={status?.github} icon={GitPullRequest} />
      </section>

      <nav className="tab-bar" aria-label="Ava sections">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={activeTab === id ? "active" : ""}
            onClick={() => setActiveTab(id)}
          >
            <Icon aria-hidden="true" /> {label}
          </button>
        ))}
      </nav>

      {activeTab === "settings" && (
        <section className="tab-content">
          <div className="toolbar">
            <div>
              {notice && <p className="notice">{notice}</p>}
              {error && <p className="error-message">{error}</p>}
            </div>
          </div>

          <form onSubmit={save}>
            <section className="panel">
              <div className="panel-title">
                <div><span><Database aria-hidden="true" /></span><h2>PostgreSQL</h2></div>
                <button className="ghost" type="button" onClick={migrate} disabled={busy || !settings?.hasPostgresUrl}>
                  <Database aria-hidden="true" /> Apply migrations
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
              <div className="panel-title"><div><span><SendIcon aria-hidden="true" /></span><h2>Telegram</h2></div></div>
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
              <div className="panel-title"><div><span><Cpu aria-hidden="true" /></span><h2>Codex gateway</h2></div></div>
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
              <div className="panel-title"><div><span><GitPullRequest aria-hidden="true" /></span><h2>GitHub CLI</h2></div></div>
              <SecretInput
                label="GitHub token"
                configured={Boolean(settings?.hasGithubToken)}
                value={form.githubToken}
                onChange={(value) => update("githubToken", value)}
                hint="Use a fine-grained token with repository Contents and Pull requests permissions. Ava also supports an existing gh auth login session."
              />
            </section>

            <section className="panel">
              <div className="panel-title"><div><span><FolderLock aria-hidden="true" /></span><h2>Workspace safety</h2></div></div>
              <label>
                <span>Allowed code parent folders — one absolute path per line</span>
                <textarea
                  value={form.workspaces}
                  onChange={(event) => update("workspaces", event.target.value)}
                  rows={4}
                  placeholder="/path/to/projects"
                />
                <small>Each listed folder and all descendants are available to coding jobs. Network access is enabled only for coding jobs.</small>
              </label>
            </section>

            <footer className="save-bar">
              <p>Secrets are encrypted with macOS Keychain through Electron safeStorage.</p>
              <button className="primary" type="submit" disabled={busy}>
                <SettingsIcon aria-hidden="true" /> {busy ? "Working…" : "Save & restart services"}
              </button>
            </footer>
          </form>
        </section>
      )}

      {activeTab === "chat" && (
        <section className="tab-content chat-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">TRUSTED DESKTOP SESSION</p>
              <h2 className="heading-with-icon"><MessageCircle aria-hidden="true" /> Chat with Ava</h2>
              <p>Desktop chat always has administrator access to memory and coding actions.</p>
            </div>
            <span className="admin-badge"><ShieldCheck aria-hidden="true" /> Admin</span>
          </div>

          <div className="message-list" aria-live="polite" ref={messageListRef}>
            {chatMessages.length === 0 && (
              <div className="empty-state">
                <strong>Start a conversation</strong>
                <span>Ask a question, update memory, or request coding work.</span>
              </div>
            )}
            {chatMessages.map((message) => (
              <article key={message.id} className={`chat-message ${message.role.toLowerCase()}`}>
                <div className="message-meta">
                  <strong>
                    {message.role === "USER"
                      ? <><UserRound aria-hidden="true" /> You</>
                      : <><Bot aria-hidden="true" /> Ava</>}
                  </strong>
                  <time>{formatTimestamp(message.createdAt)}</time>
                </div>
                <p>{message.content}</p>
              </article>
            ))}
            {chatBusy && <div className="typing-indicator"><span /><span /><span /> Ava is thinking</div>}
          </div>

          {chatError && <p className="error-message chat-error">{chatError}</p>}
          <form className="chat-composer" onSubmit={sendChat}>
            <textarea
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              onKeyDown={chatKeyDown}
              rows={1}
              placeholder={chatReady ? "Message Ava…" : "Connect PostgreSQL and Codex to chat"}
              disabled={!chatReady || chatBusy}
            />
            <button className="primary" type="submit" disabled={!chatReady || chatBusy || !chatInput.trim()}>
              <SendIcon aria-hidden="true" /> {chatBusy ? "Thinking…" : "Send"}
            </button>
          </form>
        </section>
      )}

      {activeTab === "activity" && (
        <section className="tab-content activity-panel">
          <div className="section-heading activity-heading">
            <div>
              <p className="eyebrow">MESSAGE AUDIT</p>
              <h2 className="heading-with-icon"><ActivityIcon aria-hidden="true" /> Activity</h2>
              <p>All persisted user messages and Ava responses, newest first.</p>
            </div>
            <button className="secondary" type="button" onClick={() => void loadActivity()} disabled={activityLoading}>
              <RefreshCw aria-hidden="true" /> {activityLoading ? "Loading…" : "Refresh"}
            </button>
          </div>

          <div className="activity-controls">
            <span>{activity.total.toLocaleString()} messages</span>
            <label>
              Rows
              <select
                value={activityPageSize}
                onChange={(event) => {
                  setActivityPageSize(Number(event.target.value));
                  setActivityPage(1);
                }}
              >
                {activityPageSizes.map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
            </label>
          </div>

          {activityError && <p className="error-message activity-error">{activityError}</p>}
          <div className="activity-table-wrap">
            <table className="activity-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Role</th>
                  <th>User / chat</th>
                  <th>Topic</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {activity.rows.map((row) => (
                  <tr key={row.id}>
                    <td><time>{formatTimestamp(row.createdAt)}</time></td>
                    <td><span className={`role-badge ${row.role.toLowerCase()}`}>{row.role}</span></td>
                    <td><strong>{row.telegramUserId}</strong><small>{row.telegramChatId}</small></td>
                    <td>{row.telegramMessageThreadId ?? "—"}</td>
                    <td><p>{row.content}</p></td>
                  </tr>
                ))}
                {!activityLoading && activity.rows.length === 0 && (
                  <tr><td colSpan={5}><div className="empty-state">No messages yet.</div></td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="pagination">
            <button
              className="secondary"
              type="button"
              disabled={activity.page <= 1 || activityLoading}
              onClick={() => setActivityPage((page) => Math.max(1, page - 1))}
            >
              <ChevronLeft aria-hidden="true" /> Previous
            </button>
            <span>Page {activity.page} of {Math.max(activity.totalPages, 1)}</span>
            <button
              className="secondary"
              type="button"
              disabled={activity.page >= activity.totalPages || activityLoading}
              onClick={() => setActivityPage((page) => page + 1)}
            >
              Next <ChevronRight aria-hidden="true" />
            </button>
          </div>
        </section>
      )}

      {activeTab === "memories" && (
        <section className="tab-content memories-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">GLOBAL MEMORY</p>
              <h2 className="heading-with-icon"><Brain aria-hidden="true" /> Memories</h2>
              <p>Shared preferences, facts, and operational response rules used across Ava.</p>
            </div>
            <button className="secondary" type="button" onClick={() => void loadMemories()} disabled={memoriesLoading}>
              <RefreshCw aria-hidden="true" /> {memoriesLoading ? "Loading…" : "Refresh"}
            </button>
          </div>

          <div className="memory-feedback">
            {memoriesNotice && <p className="notice">{memoriesNotice}</p>}
            {memoriesError && <p className="error-message">{memoriesError}</p>}
          </div>

          <div className="memory-list">
            {memories.map((memory) => (
              <article className="memory-card" key={memory.id}>
                <div className="memory-card-heading">
                  <div>
                    <strong>{memory.key}</strong>
                    <time>Updated {formatTimestamp(memory.updatedAt)}</time>
                  </div>
                  <button className="danger" type="button" onClick={() => void deleteMemory(memory)}>
                    <Trash2 aria-hidden="true" /> Delete
                  </button>
                </div>
                <p>{memory.value}</p>
              </article>
            ))}
            {!memoriesLoading && memories.length === 0 && (
              <div className="empty-state">
                <strong>No memories saved</strong>
                <span>Ask Ava to remember something from Chat or Telegram.</span>
              </div>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
