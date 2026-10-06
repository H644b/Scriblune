"""Run personally in macOS Terminal after approving the configuration handoff."""
from pathlib import Path
import base64
import re
import shlex
import subprocess
import sys

REPO = Path('/Users/timurradjabov/DesktopPls/Scriblune')


def connection():
    # Only routing fields; never evaluate or print the deployment environment.
    wanted = {'DEPLOY_HOST', 'DEPLOY_DIR', 'DEPLOY_SSH_KEY'}
    values = {}
    with (REPO / '.env.deploy.local').open() as file:
        for line in file:
            name, separator, value = line.partition('=')
            if separator and name.strip() in wanted:
                value = value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in '\"\'':
                    value = value[1:-1]
                values[name.strip()] = value
    host = values.get('DEPLOY_HOST', '')
    if not re.fullmatch(r'[A-Za-z0-9_.-]+@[A-Za-z0-9_.:-]+', host):
        raise ValueError('Expected the existing SSH destination; no connection made.')
    if values.get('DEPLOY_DIR') != '/home/opc/scriblune':
        raise ValueError('Deployment directory changed; obtain an updated review.')
    args = ['ssh', '-t', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15',
            '-o', 'ConnectionAttempts=1', '-o', 'ForwardAgent=no',
            '-o', 'ClearAllForwardings=yes', '-o', 'PermitLocalCommand=no']
    if values.get('DEPLOY_SSH_KEY'):
        key_file = Path(values['DEPLOY_SSH_KEY']).expanduser()
        if not key_file.is_absolute():
            key_file = REPO / key_file
        args.extend(['-i', str(key_file)])
    args.append(host)
    return args


def main():
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        raise ValueError('Run personally in an interactive Terminal. Do not run through chat or a logging tool.')
    if sys.argv[1:] not in (['--approved'], ['--verify']):
        raise ValueError('Use --approved only after specific approval, or --verify. Never pass a key as an argument.')
    source = Path(__file__).with_name('proxycheck-key-remote.py').read_bytes()
    code = "import base64;exec(compile(base64.b64decode(" + repr(base64.b64encode(source).decode('ascii')) + "),'<user-operated-setup>','exec'))"
    command = 'python3 -c ' + shlex.quote(code) + ' ' + sys.argv[1]
    # Only non-secret helper code travels in the command. Key entry is remote and hidden.
    return subprocess.run([*connection(), command], check=False).returncode


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        print('Setup could not start. No key was requested; check the existing SSH setup privately.', file=sys.stderr)
        sys.exit(1)
