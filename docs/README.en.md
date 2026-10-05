# GEO Web Monitor

A local, extensible GEO monitoring starter built with Node.js, SQLite and Playwright. Capture answers, visible sources, screenshots and execution history from two mainstream Chinese AI web interfaces with your own accounts.

**Windows + Microsoft Edge + Node.js 24** is the validated baseline. Other operating systems have not been fully validated.

```sh
npm install
npm run doctor
npm start
```

Open http://127.0.0.1:8790, create your administrator, add a brand and a question, then manually sign in through the platform account's dedicated Edge window. Create a manual task and choose the questions and accounts for each run. Compare the result with the original page before expanding monitoring.

The repository also includes a pnpm lockfile: `pnpm install --frozen-lockfile`.

Included: brand information, manual questions and rule templates, separate persistent account profiles, manual and scheduled monitoring, raw evidence and basic brand mention metrics. Local members share project data; this is not a multi-tenant app.

This is a starter, not a guarantee of stable access. Web interfaces change, logins expire and human verification may interrupt collection. Search / thinking-mode selection is not automated. Capture success does not establish factual accuracy. Scheduled monitoring requires the computer and service to remain running. Public internet deployment, content generation and publishing are out of scope.

This independent project is not affiliated with or endorsed by the integrated AI platforms. Use only accounts and data you own or are authorized to use, and follow the target platforms' rules. The MIT license covers this project's code; it does not grant permission to access third-party services or use their content.

Promotional screenshots use fictional data and simulated answers. Private databases, browser profiles, results, backups and Git history are excluded from the public export.

[Chinese setup guide](quickstart.md) · [Architecture](architecture.md) · [Privacy](privacy.md) · [MIT License](../LICENSE)

Use the same Windows user and project directory for subsequent launches. Account labels do not verify the actual signed-in platform identity. See the [validation scope](validation.md) for the isolated installation checks and remaining limits.
