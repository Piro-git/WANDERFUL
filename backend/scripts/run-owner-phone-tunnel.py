#!/usr/bin/env python3
"""Run only after owner approval. One new Cloudflare Quick Tunnel, no credentials."""
import os
from pathlib import Path
import queue
import re
import signal
import subprocess
import sys
import threading
import time


def run(binary, directory, lifetime=2400):
    binary, directory = Path(binary), Path(directory)
    if not binary.is_absolute() or not binary.is_file() or not directory.is_absolute() or directory.parent.resolve() != directory.parent:
        raise ValueError('invalid paths')
    if lifetime < 1 or lifetime > 2400:
        raise ValueError('invalid lifetime')
    directory.mkdir(mode=0o700)
    configuration = directory / 'empty-config.yml'
    configuration.write_text('{}\n')
    configuration.chmod(0o600)
    args = [str(binary), 'tunnel', '--config', str(configuration), '--no-autoupdate',
            '--origincert', str(directory / 'unused-origin.pem'),
            '--url', 'http://127.0.0.1:48173', '--protocol', 'http2',
            '--metrics', '127.0.0.1:48174']
    stopped = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: stopped.set())
    process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env={'PATH': os.defpath})
    lines = queue.Queue(maxsize=100)
    def consume():
        for line in process.stdout:
            try: lines.put_nowait(line[:4096])
            except queue.Full: pass
    threading.Thread(target=consume, daemon=True).start()
    deadline = time.monotonic() + lifetime
    origin = None
    try:
        while not stopped.is_set() and time.monotonic() < deadline and process.poll() is None:
            try: line = lines.get(timeout=0.5)
            except queue.Empty: continue
            match = re.search(r'https://([a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com)\b', line)
            if match and origin is None:
                origin = 'https://' + match.group(1) + '/'
                destination = directory / 'public-origin.txt'
                with destination.open('x') as output: output.write(origin + '\n')
                destination.chmod(0o600)
                print('Assigned owner-test origin: ' + origin, flush=True)
        if origin is None:
            raise RuntimeError('no tunnel origin')
    finally:
        if process.poll() is None:
            process.terminate()
            try: process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill(); process.wait()
        process.stdout.close()
        print('Owner-test tunnel stopped.', flush=True)


if __name__ == '__main__':
    try:
        if len(sys.argv) != 3: raise ValueError('arguments')
        run(sys.argv[1], sys.argv[2])
    except Exception:
        sys.exit('Tunnel could not complete. No raw service logs or credentials were printed.')
