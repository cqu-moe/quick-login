import datetime
import json
import pathlib
import re
import subprocess

root = pathlib.Path.cwd()
source = 'e1fde7ddf48c48fb3bc06250aadd568be46e1c93'
auth = '870933794326b9d280dcf07f392c80c127fd7233'
images, business, proxies, ids = [], [], [], []
rounds = []
def read(path):
    return json.loads(path.read_text())
def time(value):
    return datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))

for name in ['quick02-reviewed-final-round1', 'quick02-reviewed-final-round2']:
    path = root / '.e2e' / name
    runtime, report = read(path / 'runtime.json'), read(path / 'report.json')
    run = report['run']
    assert run['status'] == 'passed' and run['exitCode'] == 0
    assert run['summary'] == dict(discovered=16, selected=16, executed=16, passed=16,
                                  failed=0, interrupted=0, skipped=0, flaky=0)
    assert runtime['cleanup'] == 'passed' and not runtime['primaryFailures'] and not runtime['cleanupFailures']
    assert runtime['completedGroups'] == runtime['expectedGroups'] == 11
    selected = sorted(result['id'] for result in run['results'])
    assert selected == sorted(pair['id'] for pair in read(path / 'discovery.json')['pairs'] if pair['kind'] == 'test' and pair['disposition'] == 'run')
    ids.append(selected)
    launches = 0
    pre_dispose_active_snapshots = 0
    assert sum(bool(group.get("school")) for group in runtime["groups"]) == 10
    for group in runtime['groups']:
        assert group['extensionCommit'] == source and group['authCommit'] == auth
        assert group['sourceDirty'] is False and group['build']['sourceCommit'] == source
        assert group['backgroundSha256'] == runtime['backgroundSha256']
        assert group['runnerExitCode'] == 0 and group['cleanup'] == 'passed' and not group['cleanupFailures'] and not group['primaryFailures']
        assert not group['unexpectedDeniedEgress']
        group_path = path / group['group']
        assert not any((group_path / directory).exists() for directory in ['profiles', 'tls', 'auth-runtime'])
        group_run = read(group_path / 'report.json')['run']
        assert time(run['startedAt']) <= time(group_run['startedAt']) <= time(group_run['finishedAt']) <= time(run['finishedAt'])
        school = group.get('school')
        if school:
            assert school['containerObjectsRemoved'] and school['proxyObjectsRemoved'] and school['imageRemoved']
            assert isinstance(school['removedContainerIds'], list) and school['removedProxyIds']
            assert all(operation['ok'] == 1 for operation in school['browser']), school['browser']
            for observation in school['school']:
                assert observation['preDisposeProfiles'] >= 0 and observation['preDisposeChromeProcesses'] >= 0
                pre_dispose_active_snapshots += int(bool(observation['preDisposeProfiles'] or observation['preDisposeChromeProcesses']))
                assert observation['browserLaunches']
                for launch in observation['browserLaunches']:
                    assert all(launch[key] is True for key in ['headless', 'basicPasswordStore', 'mockKeychain', 'disposableProfile'])
                    launches += 1
            images.append(school['fixtureImage'])
            business.extend(school['removedContainerIds'])
            proxies.extend(school['removedProxyIds'])
    for result in run['results']:
        assert result['status'] == 'passed' and len(result['attempts']) == 1
        attempt = result['attempts'][0]
        assert attempt['cleanup'] == 'complete' and not attempt['secondaryErrors']
    rounds.append(dict(name=name, summary=run['summary'], startedAt=run['startedAt'], finishedAt=run['finishedAt'],
                       durationSeconds=(time(run['finishedAt']) - time(run['startedAt'])).total_seconds(),
                       groups=11, nativeGroups=10, safeLaunches=launches, preDisposeActiveSnapshots=pre_dispose_active_snapshots,
                       backgroundSha256=runtime['backgroundSha256']))
assert ids[0] == ids[1]
assert len(images) == len(set(images)) == 20
assert len(business) == len(set(business))
assert len(proxies) == len(set(proxies)) and len(proxies) >= 20
assert all(re.fullmatch('[0-9a-f]{64}', value) for value in business + proxies)
assert time(rounds[0]['finishedAt']) < time(rounds[1]['startedAt'])
# A second readback queries only exact IDs returned by these runs. It cannot
# stop/remove any object or select historical/shared images.
result = subprocess.run(['docker', 'container', 'inspect', '--format', '{{.Id}}', *business, *proxies], capture_output=True, text=True, timeout=120)
assert result.returncode != 0 and not result.stdout.strip(), result.stdout
assert all('No such container: ' + value in result.stderr or 'No such object: ' + value in result.stderr for value in business + proxies), result.stderr
image_result = subprocess.run(['docker', 'image', 'inspect', '--format', '{{.Id}}', *images], capture_output=True, text=True, timeout=120)
assert image_result.returncode != 0 and not image_result.stdout.strip(), image_result.stdout
assert all(value in image_result.stderr for value in images), image_result.stderr
owned_profiles = [str(root / '.e2e') + '/']
remaining = [line.strip().split(None, 1)[0] for line in subprocess.check_output(['ps', '-axo', 'pid=,args=']).decode().splitlines() if any('--user-data-dir=' + prefix in line for prefix in owned_profiles)]
assert not remaining, remaining
check = dict(status='passed', hostChromiumResiduePids=remaining, sourceCommit=source, authCommit=auth, rounds=rounds,
             uniqueImages=images, removedContainerIds=business, removedProxyIds=proxies,
             independentExactIdAbsence=True, independentExactImageAbsence=True, attemptsHaveCompleteCleanup=True,
             unexpectedDeniedEgress=[], allRecordedNativeOperationsSucceeded=True)
(root / '.e2e/final-verification.json').write_text(json.dumps(check, indent=2) + '\n')
print(json.dumps({key: value for key, value in check.items() if key not in ['uniqueImages', 'removedContainerIds', 'removedProxyIds']}, indent=2))
