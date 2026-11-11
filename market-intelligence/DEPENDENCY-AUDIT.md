# Starter dependency inspection — 2026-11-11

This is an inventory only. No starter files, packages, lockfiles, or Git
branches were removed or changed as part of this inspection.

## Market Intelligence runtime

`market-intelligence/package.json` has no external runtime dependencies. Its
local server uses Node's standard library and the public, unauthenticated
Bybit market-data API. It contains no code path for API credentials or order
submission.

## Remaining starter application

The repository root still contains the historical `site-creator-vinext-starter`
Next/Vinext/Cloudflare application and its root `package.json`. It is separate
from the local Market Intelligence start command:

```sh
npm start --prefix market-intelligence
```

It is deliberately retained pending a separate, user-approved migration or
removal decision. This branch does not delete, rename, or modify that starter
application.
