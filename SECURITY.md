# Security policy

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use the repository's private vulnerability reporting feature under **Security → Advisories → Report a vulnerability**.

Include the affected version or commit, reproduction steps, impact, and any suggested mitigation. Do not include real tokens, passwords, private repository contents, or personal data.

## Security model

Ava can modify files beneath configured workspace roots and can provide coding jobs with network and GitHub credentials. Only grant access to folders and repositories you intend the agent to change. Use narrowly scoped GitHub tokens and trusted numeric Telegram user IDs.

Runtime secrets are stored outside the repository with Electron `safeStorage`. PostgreSQL still contains prompts, chat history, memories, approval requests, job results, and audit events; operators are responsible for database access controls, encryption, retention, and backups.
