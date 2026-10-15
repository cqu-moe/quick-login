# QUICKLOGIN-02: real school Cookie recovery and acknowledgement

## Reviewable source

Executable source: **`e1fde7ddf48c48fb3bc06250aadd568be46e1c93`**. Fixed Auth dependency: **`870933794326b9d280dcf07f392c80c127fd7233`**. Integration baseline `2baf0ccbae15fc7d431138daddf4f7ebe3b4fc2c` is an ancestor. This report/evidence follow-up changes no executable source. No integration merge, push, main merge, deployment, tag creation, canary promotion or store action was performed for this ticket.

The extension version is 0.4.8. Only `src/background/sync.ts` changes product behavior: if a school login form changes auxiliary cookies while TGC remains, retain the tuple already rejected by the school so an old export cannot navigate the page. If TGC is genuinely missing, retain the existing ability to reapply it. Existing missing-TGC unit coverage still passes.

Implementation commits, all signed with the unchanged configured identity:

- `a2cd13e372f53c757e0f8cc8b44ca2f0034c070b`: ten native school scenarios, actual runtime integration, product repair and version notes.
- `b453791345c6f6853671ab23f8923c3f1c2a3ac6`: actual proxy cleanup helper and visible popup/content ACK assertions.
- `b7d224f79d158adbcc677d714d8eb5d87e3ff086`: Auth870/pre-dispose capture and truthful aggregate timestamps/exitCode.
- `e6512e4cf7873828c31615243a010d800a4d6647`: force safe Chromium flags inside the external school fixture and observe actual `/proc` launch flags.
- `2e78e3b504e50b3b504f0ef6c0ad2b95aeb84e2d`: distinguish pre-dispose activity from final resource absence.
- `e1fde7ddf48c48fb3bc06250aadd568be46e1c93`: retain redacted transport path/error context; 500s remain fatal with no automatic retry.

## Actual boundary and contract ownership

The journey runs the built MV3 extension, genuine OAuth/PKCE, real Auth Worker/frontend, D1/DO/Workflow, native Docker/production Python Chromium and native Chrome Cookie API. Only school/mail providers are synthetic. Synthetic accounts, strong-admin quota admission and public school binding APIs prepare prerequisites; no internal Auth response, extension token, Cookie API or ready state is fabricated.

The success owner in `e2e/school.e2e.ts` checks Cookie domain/hostOnly/path/session/SameSite/expiry filtering; observes a real school form; requires a fresh container login/export/write; holds the genuine receipt response and verifies no navigation plus visible popup/content confirmation text; then requires the actual school business heading and independently read Auth receipt/ACK to match. Popup ready is checked before/after recovery, and is absent on the current login form.

Nine guard owners in `e2e/school-guards.e2e.ts` cover foreign host/domain/path cookies surviving sync/disable; real manual input against a late login; sync-off against a late export; once-per-document multi-tab navigation; document replacement; natural 31.5-second export expiry/no write/no receipt request; repeated form stopping after one navigation with manual/retry actions; an actually issued old-generation receipt rejected by real Auth; and native service-worker termination at the actual Cookie-write/journal boundary followed by rollback and recovery. Detailed authoring-gate contracts and framework fallback evidence are in [the E2E guide](../../../e2e/README.md).

CDP only schedules a fault at the actual compiled execution boundary or stops the actual observed worker version. It does not manufacture successful state or invoke lifecycle listeners directly. `chrome.runtime.reload()` was concretely unsuitable for this command-line unpacked extension and is retained as a failed probe, not counted as recovery evidence.

## Fixed-source final verification

| Round | Real tests | Runtime groups | Native groups | Duration | Cleanup |
| --- | --- | --- | --- | --- | --- |
| 1 | 16/16, no skips/retries/interruption | 11 | 10 | 575.312s | passed |
| 2 | 16/16, no skips/retries/interruption | 11 | 10 | 590.504s | passed |

UTC run intervals: 2026-10-15T17:21:46.653Z → 2026-10-15T17:31:21.965Z; 2026-10-15T17:31:21.999Z → 2026-10-15T17:41:12.503Z. Both commands exit0. Independent readback confirms **40 business IDs, 40 proxy IDs and 20 unique image tags absent**, and no task-owned host Chromium process remains. All32 framework attempts have cleanup=complete and no secondary errors; unexpectedDeniedEgress=[]. Every recorded native browser operation is successful. There are88 safe native launch observations. The second round preserves two pre-dispose active snapshots; final resource absence is independently proven.

Every final child uses clean source e1fde7d, Auth870 and background SHA256 `3899dfb28ac0f83f35e6d161563bf0bdad58c670215555eb8eb29435e9288ac5`. Six authorization tests share one fresh runtime; each of ten school tests has its own Worker/D1/DO/Workflow, image, profile and ports. Framework-discovered IDs equal selected/executed IDs, with zero retries. Aggregate times cover all child groups and cleanup; aggregate exitCode matches the actual process result.

Actual commands (worker checkout, unless named otherwise):

```sh
npm run typecheck
npm test
npm run test:release
npm run typecheck:e2e
npm run build
npm run check:package
node e2e/self-check.mjs
node e2e/zero-check.mjs
node e2e/lifecycle-check.mjs
QUICKLOGIN_E2E_OUTPUT=.e2e/quick02-reviewed-final-round1 node e2e/run.mjs
QUICKLOGIN_E2E_OUTPUT=.e2e/quick02-reviewed-final-round2 node e2e/run.mjs
QUICKLOGIN_E2E_PUBLISH_DIR=.e2e/quick02-final-published node e2e/prepare-ci-artifacts.mjs quick02-reviewed-final-round1 quick02-reviewed-final-round2
python3 .e2e/verify-final.py
```

All commands above exit 0. Unit tests: 23 files/171 tests; release tools: 10 tests; package: 14 files, protocol digest `d08b76f3df71879dcedb754b6df0f01eb0da912a5c1f00495283f3512a21cec1`. Website type/build/six-page checks passed before these support-only follow-ups; website source is unchanged. Shell/Python/Node syntax and `git diff --check` pass.

## Failure controls and product RED

Standard negative assertion returns runner/wrapper1 for its exact expected assertion; zero-selection returns runner2/NO_TESTS; all four lifecycle controls verify missing Auth, profile cleanup failure after passing business, simultaneous primary/cleanup failures, and provider failure after actual resources were removed. The framework's passed/exit0 provider-cleanup anomaly is rejected by the wrapper's attempt cleanup/secondary-error inspection.

The extra real CLI aggregate-startup control selects two school tests with an absent Auth checkout. It exits1, aggregate report exitCode1, selected2/executed0, real invocation timestamps, original startup error retained in the child runtime, cleanup passed and no native resources started. Its invoked CLI is:

```sh
QUICKLOGIN_E2E_AUTH_PATH="$PWD/.e2e/missing-auth-source" QUICKLOGIN_E2E_OUTPUT=.e2e/aggregate-metadata-e1fde7d node e2e/run.mjs --grep '^QUICKLOGIN-02 (foreign cookies|actual manual typing)'
```

Current-owner RED runs in the separate `QUICKLOGIN-02-regression` checkout at the same e1fde7d test/harness/Auth870. Only `src/background/sync.ts` is restored byte-for-byte from 2baf (SHA256 `80fe6d7c1496cd56e21ba3fc30a69de448d38ddf3c4b7921ca064aa007556849`). Actual command:

```sh
npm run build
QUICKLOGIN_E2E_OUTPUT=.e2e/owner-regression-final node e2e/run.mjs --grep '^QUICKLOGIN-02 real binding'
```

Build exits0; native E2E exits1, selected/executed/failed1, precisely `Recovery navigated an old session before a fresh school login completed`. Cleanup passes with two actual removed proxies. The final unchanged test passes on repaired product source in both full rounds. The expected failure is not an Auth mock or unrelated guard denial.

## Browser safety and complete cleanup

Both browser layers force headless/basic/mock-keychain and disposable profiles. The host provider creates only new task profiles. Quick's school fixture appends one COPY to the exact pinned Auth Dockerfile, replacing only its Chromium executable wrapper; it unsets DISPLAY and forces the same safe parameters without changing production Python or the Auth checkout. Native `/proc` observations retain only PID and four safe-argument booleans. All final native groups have nonempty safe observations. No user profile/keychain access occurred.

Before disposal, the mail pump is stopped/waited, school observations are read and `helper.capture()` runs in finally. Actual native DO IDs are tracked before fixture fetch. After disposal, the reviewed Auth helper restricts cleanup to this unique image and exact observed business/DO proxy names, validates interceptor image/no mounts, removes those exact IDs, then independently queries business/proxy absence. Each native group must report proxyObjectsRemoved=true and actual nonempty removedProxyIds. Final independent exact-ID Docker inspection and task-profile process lookup are read-only and scoped to returned IDs/owned profile paths.

`preDisposeProfiles`/`preDisposeChromeProcesses` deliberately preserve activity before shutdown; they are not reported as final zeros. Final proof is actual container/proxy disappearance, unique-image removal and host profile/TLS/runtime deletion. The container profile directory is inside the removed container; the pinned Dockerfile declares no VOLUME and this harness configures no host mount. Historical 255 stopped proxies and the disputed active-port object were never selected or mutated, and are not claimed deleted.

Committed evidence is under [evidence/QUICKLOGIN-02](evidence/QUICKLOGIN-02/). The actual collector exits0 with **146 copied files, problems=[]**; all62 collector JSON files parse after redaction. Negative/zero/lifecycle directories are negative-1792084888301, zero-1792084892254, lifecycle-1792084894864. Supplemental evidence has25 whitelisted text/JSON files plus its manifest, including the clean intended owner RED, actual aggregate failure, retained transport500, retained wrong-time cleanup assertion, focused diagnostic and package/check logs. No private DB/DO bundle/TLS/profile/raw HAR or diagnostic screenshot is copied. Host launch samples and final exact-ID/image/process absence are separate JSON records. The exact read-only verification script is also retained as evidence/QUICKLOGIN-02/verify-final.py, and source-signatures.json records all six signatures. Committed text copies only normalize line-ending/EOF whitespace for Git; original raw/collector outputs remain unchanged, and whitespace-normalization.json records original/committed hashes. A publication-manifest.json records final file hashes; this is local evidence, not a remote publication.

## Retained failures and limits

- Earlier Auth134/b453791 full round1 passed16/16; its next round was deliberately drained10/16 before consuming Auth870. They remain separate business evidence, not final cleanup proof.
- e6512e4 safe-browser round stopped13/16 because a newly added guard incorrectly treated a pre-dispose live profile/process snapshot as final residue. Actual resources were removed. The snapshot fields/gate were corrected at2e78e3b; the original failure is retained.
- 2e78e3b round stopped9/16 after a real private transport500 retained by the mail pump, although the delayed-export business test and actual resource removal succeeded. The old generic error did not retain its body. A focused diagnostic rerun passed1/1 with full cleanup. e1fde7d adds redacted path/body context without retries or ignoring500. This intermittent prior error has no proven root cause/fix; the two final clean rounds do not establish that it can never recur. Earlier RED's first attempt also had a transport500 and is retained locally separately from its clean expected-failure rerun.
- The parent-requested Docker hold was respected: only in-flight cases finished, schedulers stopped between groups, no broad prune/restart occurred, and native runs resumed only after explicit permission.

This proves synthetic-school business/ACK behavior with actual internal services. It does not prove real university login, a user-installed/store extension, native permission UI, all QUICKLOGIN-03 alarm/revocation journeys, remote QUICKLOGIN-02 CI, or production deployment. Independent merger review and integration/push remain parent-owned.

## Local package only

Latest proof candidate: `.e2e/local-candidates/QUICKLOGIN-02-e1fde7d/cqu-quicklogin-0.4.8-canary.zip`, **142522 bytes**, SHA256 **`62602b9765a78fe5dbf55a392bad1111b0a5186b4dbeb7d8c5956b3f336a6194`**. CRC,14 files, manifest0.4.8, embedded source e1fde7d and every ZIP/dist file byte comparison pass. Older versioned archives were preserved. The record's publishedAt is a local candidate format field, not publication evidence.
