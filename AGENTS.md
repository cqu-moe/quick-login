# QuickLogin project instructions

## Versioning and release

- Treat user-visible extension changes and QuickLogin service behavior changes as releases. Bump the patch version for fixes, UI copy or motion changes, and retry-policy changes; bump the minor version for backward-compatible features; reserve major versions for incompatible protocol or storage changes.
- When commit and deployment are already authorized, apply the necessary version bump without asking again.
- Keep the root versions in `package.json`, `package-lock.json`, and `public/manifest.json` identical.
- Build versioned canary archives as `releases/cqu-quicklogin-<version>-canary.zip`. Package only the contents of `dist/`, and never overwrite an older versioned archive.
- Before release, run `npm run typecheck`, `npm test`, `npm run build`, and `npm run check:package`. Verify the ZIP contents, embedded manifest version, archive integrity, and SHA-256.
- Update `docs/operations/quicklogin-release.md` and `docs/operations/quicklogin-handoff.md` with the extension commit, package name and SHA-256. For Auth changes, also record the Auth commit and deployed Worker version.
- Keep release evidence separate: a Git push, local canary ZIP, unpacked-extension reload, Cloudflare Worker deployment, and Chrome Web Store publication are different states. Chrome Web Store upload or publication always requires an explicit request naming the store action.

## Repository boundaries

- Extension code lives in this repository. Auth service code lives in `/Users/uu/Developer/cqu-moe/auth`; modify it only when the task explicitly includes backend behavior.
- Do not touch unrelated dirty worktrees. Use the existing isolated QuickLogin Auth worktree when it is present and clean.
