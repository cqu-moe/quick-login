# CI performance measurement — 2026-11-06

## Scope and measurement

`gh api` captured the latest 50 repository runs before editing: 41 Chrome Web Store schedules, 4 Checks, 4 Extension E2E and 1 Canary workflow. To avoid the scheduled-job bias, also requested the latest 50 Checks and E2E runs (E2E has 42); after deduplication, 134 runs / 277 jobs. Cancelled and failed jobs are retained in the raw dataset but excluded from successful-job medians.

Queue is job `created_at` → `started_at`, so it excludes time blocked by `needs`. Preparation includes checkout, tools, dependency installation, builds, artifact transfer and runner teardown. Execution is the sum of test/typecheck/validation step intervals; publication workflows show their publishing work in this column rather than pretending it is testing. Interleaved steps are summed, not treated as one contiguous block. Composite Checks internals are timed from the timestamped job logs; REST only exposes the composite wrapper.

The original sample’s per-job breakdown is in [before-jobs.csv](ci-performance/2026-11-06-before-jobs.csv). Raw REST responses and composite logs remain in the task’s local `.e2e/ci-optimization/` evidence directory.

## Baseline

Successful job medians within the original 50-run sample (seconds):

| Workflow / job | Samples | Queue | Preparation | Execution | Job total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Checks / verify | 4 | 2.0 | 23.7 | 22.7 | 44.5 |
| Extension E2E / Real MV3 Auth, school cookies and recovery | 2 | 2.0 | 2.5 | 0.0 | 2.5 |
| Extension E2E / Real MV3 journeys (core, desktop) | 3 | 2.0 | 117.0 | 1132.0 | 1249.0 |
| Extension E2E / Real MV3 journeys (core, mobile) | 2 | 2.0 | 132.0 | 1123.0 | 1255.0 |
| Extension E2E / Real MV3 journeys (devices, desktop) | 3 | 2.0 | 133.0 | 876.0 | 1027.0 |
| Extension E2E / Real MV3 journeys (devices, mobile) | 3 | 2.0 | 118.0 | 869.0 | 987.0 |
| Publish Chrome Web Store / publish | 41 | 4.0 | 12.0 | 7.0 | 19.0 |
| Publish canary / publish | 1 | 3.0 | 32.4 | 26.6 | 59.0 |
| Publish canary / select | 1 | 2.0 | 14.0 | 0.0 | 14.0 |

Medians of the individual columns need not add up to the median total.

The latest matching successful main E2E run is [41569340400](https://github.com/cqu-moe/quick-login/actions/runs/41569340400), commit `038468506c54a635754fd933faf900d4a213a0b8`: **1290 s wall time**, **4551 runner-seconds**. The preceding successful PR run took 1297 s / 4524 runner-seconds. Long core jobs spend roughly 1080 s on the two journey rounds, with about 120–140 s preparing. Setup is not the dominant bottleneck here.

## Changes and retained contracts

- Split core into four shards and devices into two, across both existing viewports. Every selected test still runs twice in independent runtime rounds; the rounds and assigned device controls now run concurrently in isolated output/profile/port/container namespaces. Every child process is awaited and any failure fails the job; retries remain zero.
- Keep native MV3, pinned Auth, real school Docker runtime, viewport, cleanup, artifact redaction and all failure controls. Run shared harness controls once per viewport, and require their evidence in aggregate admission.
- Retain required check contexts `verify` and `Real MV3 Auth, school cookies and recovery`. Prose-only changes produce lightweight successful checks; `docs/releases/**` still runs CI because it generates website output. Only Markdown is skipped; non-Markdown assets or executable fixtures under docs still run CI, and diff errors fail closed.
- Cancel superseded runs only for the same PR. Main and manual runs have distinct concurrency groups. Canary and rollback keep the shared publication lock with [`queue: max`](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency) (maximum 100 pending runs).
- Cache npm with both QuickLogin/Auth lockfiles, use pnpm setup’s built-in store cache, and cache only the pinned telemetry-disabled Auth frontend build. Cache the roughly 21 MB of browser system-package downloads as well, while still running apt and installing all fonts/libraries. The measured Azure Ubuntu mirror delivered these files at only 41.5 kB/s, so use the official HTTPS Ubuntu archive. Never cache browser profiles, cookies, D1/DO databases or TLS state.
- E2E typecheck runs once in Checks. All runners were already Ubuntu; there is no Go/Rust tool installation or macOS scheduling bottleneck to remove.

## Local verification

- Extension build: 2.855 s first / 0.383 s second. Website: 0.386 s / 0.409 s. No extra persistent build cache is justified for sub-second rebuilds.
- The pinned Auth Dockerfile copies `requirements.txt` before pip installation and copies application sources last. Chrome is downloaded as a checksummed precompiled archive. Each test’s unique school fixture remains necessary isolation.
- Existing 246 Vitest tests, 30 release Python tests plus the new path-routing test, all three typechecks, package/contract validation and website validation passed.
- actionlint 1.7.12 passes except its outdated schema rejects the documented `queue` key; reran with only that diagnostic excluded. No CI gate has been suppressed.

## Remote verification

The temporary [README-only probe PR #41](https://github.com/cqu-moe/quick-login/pull/41) passed: `verify` 5 s, change routing 5 s, aggregate 5 s; journeys skipped and no dependency install/build/test ran. It is closed without merging. Superseded E2E runs [42156633249](https://github.com/cqu-moe/quick-login/actions/runs/42156633249) and [42156794828](https://github.com/cqu-moe/quick-login/actions/runs/42156794828) were cancelled automatically. The latter exposed the old `always()` aggregate continuing after cancellation; changed failure-evidence steps to [`!cancelled()`](https://docs.github.com/en/actions/reference/workflows-and-actions/expressions). The required aggregate retains `always()` so cancelling the latest run cannot turn its required check into a successful skip; it fails promptly on cancelled dependencies. This small gate can still incur GitHub runner queue time.

The first full-run attempt encountered a 14+ minute queue before its five-second change detector even obtained a runner. Use [`ubuntu-slim`](https://docs.github.com/en/actions/reference/runners/github-hosted-runners#single-cpu-runners) for the routing/aggregate jobs: these only need preinstalled Git, Python and Node, not a full VM. The Docker/browser journeys retain Ubuntu 24.04. Slim jobs use a five-minute timeout (below the platform’s 15-minute limit); this changes no test coverage or concurrency entitlement.

The first complete sharded run [42159008624](https://github.com/cqu-moe/quick-login/actions/runs/42159008624), commit `0d58785fb5705d2c9609f8e2e7b68a2202956d24`, passed all 12 shards and aggregate admission: **1687 s wall time / 6311 runner-seconds**. It was slower overall than baseline: routing queued 90 s, shards queued 182–335 s, and aggregate queued 165 s. Two browser dependency installs also took 514/526 s; logs isolated the delay to 21.1 MB of font downloads, while Chromium itself downloaded in seconds. The matching desktop shard prepared in 119 s versus mobile 638 s; the actual two test rounds took 203 s versus 198 s. These observations motivated the second iteration above rather than treating sharding alone as a successful optimization.

Final second-iteration measurements will be filled after its pushed PR run completes. No merge, release, store upload or real-account acceptance is part of this task.
