#!/usr/bin/env python3
"""Owner-run, hidden terminal entry. Never reads any previous credential file."""
import getpass
import json
import os
from pathlib import Path
import re
import sys
import warnings


def configure(directory, read_secret=getpass.getpass):
    directory = Path(directory)
    if not directory.is_absolute() or directory.parent.resolve() != directory.parent:
        raise ValueError('Use a canonical absolute parent directory')
    # A fresh directory prevents accidental reuse of an old source or session.
    directory.mkdir(mode=0o700)
    try:
        values = {}
        for key in ('GOOGLE_API_KEY', 'GRAPHHOPPER_API_KEY'):
            value = read_secret(key + ' (hidden): ')
            if not re.fullmatch(r'[A-Za-z0-9_-]{16,512}', value):
                raise ValueError('Invalid key format; nothing saved')
            values[key] = value
        destination = directory / 'provider.env'
        fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w') as output:
            output.write('AI_PROVIDER=google\n')
            for key, value in values.items():
                output.write(key + '=' + json.dumps(value) + '\n')
            output.flush()
            os.fsync(output.fileno())
        return destination
    except BaseException:
        # Leave any created artifact for the owner to inspect; never overwrite/reuse it.
        raise


if __name__ == '__main__':
    if len(sys.argv) != 2 or not sys.stdin.isatty():
        sys.exit('Run in your own terminal with a fresh absolute directory path.')
    warnings.simplefilter('error', getpass.GetPassWarning)
    try:
        destination = configure(sys.argv[1])
        print('Server-only credential file created: ' + str(destination))
        print('Values were not displayed. Do not send them in chat.')
    except (Exception, KeyboardInterrupt):
        sys.exit('Credential setup stopped. No secret details were printed.')
