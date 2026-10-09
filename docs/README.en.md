# GEO Web Monitor

Observe how a brand appears in saved AI web answers. This local Node.js, SQLite and Playwright project captures page text, displayed sources, screenshots and execution history using your own accounts.

The tested baseline is **Windows, Microsoft Edge and Node.js 24+**. The server listens on localhost by default. The public package uses Platform A / B display labels; target URLs and adapter rules remain in [the source](../src/browser.js). Generic labels do not anonymize the integrations.

## Start

```sh
npm install
npm run doctor
npm start
```

Keep the terminal running and open <http://127.0.0.1:8790>. Create an administrator, add a brand and one question, sign in manually through the account's dedicated Edge window, then create and run a manual task. Compare the saved answer, sources and screenshot with that same original conversation before expanding the batch.

pnpm users can run `pnpm install --frozen-lockfile`. Follow the [setup guide](quickstart.md) for ports, schedules and backups. Use the same Windows user and project directory for later launches; account labels do not verify the actual signed-in identity.

## Features and interpretation

- Brand information, manual questions and rule templates, [question topics](question-topics.md), separate account profiles, manual and scheduled monitoring.
- Saved results and [manual review](answer-review.md). Human labels are team judgments; they do not rewrite the captured answer or establish an overall accuracy score.
- [Historical search](answer-search.md): literal text/URL matching, highlighted excerpts and saved evidence, with independently scrolling panels. It does not search live pages or make AI requests.
- [Reports](analytics-report.md) and a [source library](source-library.md): traceable counts, denominators, saved links and manual source annotations.
- [Institution discovery](institution-discovery.md): review candidate names, merge aliases and compare confirmed peers using common samples. Extraction can miss or misidentify names.
- [Change feed](change-feed.md): adjacent saved answers compared for name presence and source-set differences. Unconfirmed settings are labeled separately and excluded from same-setting trends, streaks and tracking. This is not a full-text diff or evidence of causation.

Mentions are not recommendations or rankings. Displayed links do not prove that sources support every claim. Sentiment uses keywords and needs manual review. Capture success does not establish factual accuracy.

## Limits, privacy and validation

Logins can expire and manual verification may interrupt collection. Search/thinking settings are not selected automatically; unavailable page states remain unknown. Recorded page settings do not prove backend model versions or actual search execution. Scheduled jobs require the computer and service to remain running.

Logged-in members share this instance's project data; there is no project isolation. Public internet deployment, automatic factual verification, content creation and publishing are not implemented. Other operating systems and long-running batches of real accounts have not been fully validated.

The current candidate passed 93 of 107 tests with no failures; 14 optional capture/window tests were skipped. This used isolated data and an existing dependency installation on the same computer. It is not a new-machine installation or current live-provider acceptance test. See [validation scope](validation.md).

Promotional images use fictional data and simulated answers. Private databases, account profiles, screenshots, logs and backups are excluded from the public export. Cookies and browser profiles remain sensitive credentials; see [privacy](privacy.md).

This independent project has no official affiliation with the integrated platforms. Use accounts and data you own or are authorized to use, and follow the target platforms' rules. The [MIT license](../LICENSE) covers this code, not access rights to third-party services or content.

[Architecture](architecture.md) · [Troubleshooting](troubleshooting.md) · [Contributing](../CONTRIBUTING.md) · [Security](../SECURITY.md)
