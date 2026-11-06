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
- Cancel superseded work only for the same PR. E2E uses per-job/per-shard concurrency so a cancelled run’s fail-closed aggregate cannot hold a workflow lock and block the next commit. Main and manual runs have distinct concurrency groups. Canary and rollback keep the shared publication lock with [`queue: max`](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency) (maximum 100 pending runs).
- Cache npm with both QuickLogin/Auth lockfiles, use pnpm setup’s built-in store cache, and cache only the pinned telemetry-disabled Auth frontend build. Cache the roughly 21 MB of browser system-package downloads as well, while still running apt and installing all fonts/libraries. The measured Azure Ubuntu mirror delivered these files at only 41.5 kB/s, so use the official HTTPS Ubuntu archive. Never cache browser profiles, cookies, D1/DO databases or TLS state.
- E2E typecheck runs once in Checks. All runners were already Ubuntu; there is no Go/Rust tool installation or macOS scheduling bottleneck to remove.

## Local verification

- Extension build: 2.855 s first / 0.383 s second. Website: 0.386 s / 0.409 s. No extra persistent build cache is justified for sub-second rebuilds.
- The pinned Auth Dockerfile copies `requirements.txt` before pip installation and copies application sources last. Chrome is downloaded as a checksummed precompiled archive. Each test’s unique school fixture remains necessary isolation.
- Existing 246 Vitest tests, 30 release Python tests plus the new path-routing test, all three typechecks, package/contract validation and website validation passed.
- actionlint 1.7.12 passes except its outdated schema rejects the documented `queue` key; reran with only that diagnostic excluded. No CI gate has been suppressed.

## Remote verification

The temporary [README-only probe PR #41](https://github.com/cqu-moe/quick-login/pull/41) passed: `verify` 5 s, change routing 5 s, aggregate 5 s; journeys skipped and no dependency install/build/test ran. It is closed without merging. Superseded E2E runs [42156633249](https://github.com/cqu-moe/quick-login/actions/runs/42156633249) and [42156794828](https://github.com/cqu-moe/quick-login/actions/runs/42156794828) were cancelled automatically. The latter exposed the old `always()` aggregate continuing after cancellation; changed failure-evidence steps to [`!cancelled()`](https://docs.github.com/en/actions/reference/workflows-and-actions/expressions). The required aggregate retains `always()` so cancelling the latest run cannot turn its required check into a successful skip; it fails promptly on cancelled dependencies. This small gate can still incur GitHub runner queue time. A subsequent push showed it also held the workflow concurrency lock while queued, blocking the latest run; moving E2E cancellation to the change-detector and individual shard jobs removes that dependency while retaining the fail-closed required aggregate.

The first full-run attempt encountered a 14+ minute queue before its five-second change detector even obtained a runner. Use [`ubuntu-slim`](https://docs.github.com/en/actions/reference/runners/github-hosted-runners#single-cpu-runners) for the routing/aggregate jobs: these only need preinstalled Git, Python and Node, not a full VM. The Docker/browser journeys retain Ubuntu 24.04. Slim jobs use a five-minute timeout (below the platform’s 15-minute limit); this changes no test coverage or concurrency entitlement.

The first complete sharded run [42159008624](https://github.com/cqu-moe/quick-login/actions/runs/42159008624), commit `0d58785fb5705d2c9609f8e2e7b68a2202956d24`, passed all 12 shards and aggregate admission: **1687 s wall time / 6311 runner-seconds**. It was slower overall than baseline: routing queued 90 s, shards queued 182–335 s, and aggregate queued 165 s. Two browser dependency installs also took 514/526 s; logs isolated the delay to 21.1 MB of font downloads, while Chromium itself downloaded in seconds. The matching desktop shard prepared in 119 s versus mobile 638 s; the actual two test rounds took 203 s versus 198 s. These observations motivated the second iteration above rather than treating sharding alone as a successful optimization.

The second iteration exposed an ordering assumption in the device control: starting before either round created `.e2e/` caused `ENOENT`, while both actual journey rounds passed and cleaned up. Explicitly create the common parent before launching children. A clean-directory shell regression failed before this fix; all 16 exit/assignment combinations passed afterward. The failed run is retained as [42162139364](https://github.com/cqu-moe/quick-login/actions/runs/42162139364), not counted as a successful performance sample. Its cold official-mirror fetch took less than one second for the same 21.1 MB; full browser/dependency installation was 20 seconds, and the archive cache was saved.

## Corrected complete-run comparison

The final implementation passed [E2E 42164490941](https://github.com/cqu-moe/quick-login/actions/runs/42164490941) and [Checks 42164490963](https://github.com/cqu-moe/quick-login/actions/runs/42164490963), head `5209f8f54477ef8f25eff081426f5c4cef27030e`. GitHub tested merge commit `2206d0201bfe0abc62c4386c239e6ded4468b974`, whose parent is that head. The downloaded 12 shard admissions independently verified **96 journey executions, 24 distinct round IDs, all assigned controls and zero admission problems**. Both three-runtime device-control shards passed; their logs contain no OOM markers.

| Metric | Baseline | Corrected run | Change |
| --- | ---: | ---: | ---: |
| E2E wall time, including queues | 21m 30s | 20m 07s | −6.4% |
| Longest E2E job, including preparation | 21m 23s | 6m 34s | −69.3% |
| Longest job's execution phase | 18m 58s | 4m 57s | −73.9% |
| Median journey preparation | 2m 09s | 1m 26s | −33.3% |
| Total E2E runner occupancy | 75m 51s | 54m 59s | −27.5% |
| Median journey queue | 2s | 10m 55.5s | increased |
| Checks / verify job | 46s | 40s | −13.0% |

These are two actual complete runs, not a guaranteed long-term latency distribution. The optimized shards queued **305–893 seconds**; the last-starting light core shard determined completion, rather than the longest test. The measured end-to-end improvement is therefore 6.4%, not 69.3%. A no-queue path computed from these job durations would be roughly 6m 48s, but that is an estimate, not an observed workflow result. The official GitHub status page reported Actions operational during measurement, so no specific incident is asserted as the cause.

The per-job queue/preparation/execution data for the first complete experiment and corrected run, plus corrected Checks, is in [after-jobs.csv](ci-performance/2026-11-06-after-jobs.csv). The full browser/dependency step took **16–25 s** (median 20 s), archive cache restore 0–2 s, and the two device-control logs confirmed `Need to get 0 B/21.1 MB of archives`. All libraries and fonts were still installed. The cache listing totaled **732,841,043 bytes / 698.9 MiB across seven entries**; the new APT cache was 21,103,331 bytes and the pinned frontend cache 486,727 bytes. This is comfortably below 10 GB. The aggregate cache-usage endpoint was delayed, so these sizes are summed from the actual entries.

Twelve shards balance the longest journeys against repeated preparation and hosted-runner queuing. Further splitting would add more dependency/Docker setup and queue entries; it is not justified by this queue-constrained sample. Browser binaries download in seconds and are not separately cached. Canary keeps its independent verification for tag/manual publication paths; no new cross-workflow release-artifact trust mechanism was introduced merely to remove that short, infrequent gate.

The final documentation commit changes no CI/test implementation. Its same-code confirmation run is recorded in PR #40 rather than recursively committing each new run ID and triggering another full run. No merge, release, store upload or real-account acceptance is part of this task.
