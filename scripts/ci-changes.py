"""Skip prose-only changes while retaining release-note build validation."""
import os
import subprocess
from pathlib import PurePosixPath


def requires_ci(paths):
    # Release notes are inputs to the shipped website, even though they are Markdown.
    return any(
        path.startswith('docs/releases/')
        or not (path.startswith('docs/') or PurePosixPath(path).suffix == '.md')
        for path in paths
    )


if __name__ == '__main__':
    base = os.environ.get('CI_BASE', '')
    if os.environ['CI_EVENT'] == 'workflow_dispatch' or not base or set(base) == {'0'}:
        required = True
    else:
        subprocess.run(['git', 'fetch', '--no-tags', '--depth=1', 'origin', base], check=True)
        paths = subprocess.check_output(['git', 'diff', '--name-only', '--no-renames', '-z', base, 'HEAD']).decode().split('\0')
        required = requires_ci(path for path in paths if path)
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write(f'required={str(required).lower()}\n')
    print('Run CI' if required else 'Prose-only change: skip expensive checks')
