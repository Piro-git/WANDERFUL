import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
import sys
sys.dont_write_bytecode = True


def module(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).parents[1] / 'scripts' / (name + '.py'))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


class OperatorTests(unittest.TestCase):
    def test_credential_entry_is_fresh_private_and_rejects_invalid_input(self):
        setup = module('configure-owner-phone-credentials')
        with tempfile.TemporaryDirectory(dir='/private/tmp') as root:
            root = Path(root)
            output = setup.configure(root/'new', lambda _: 'synthetic_offline_value_123')
            self.assertEqual(output.stat().st_mode & 0o777, 0o600)
            self.assertEqual(output.parent.stat().st_mode & 0o777, 0o700)
            with self.assertRaises(FileExistsError):
                setup.configure(output.parent, lambda _: self.fail('must not read again'))
            with self.assertRaises(ValueError):
                setup.configure(root/'bad', lambda _: 'invalid\nkey')
            self.assertFalse((root/'bad'/'provider.env').exists())

    def test_tunnel_pins_one_origin_and_terminates_without_raw_logs(self):
        tunnel = module('run-owner-phone-tunnel')
        import contextlib, io, time
        with tempfile.TemporaryDirectory(dir='/private/tmp') as root:
            root = Path(root)
            binary = root/'fake-client'
            binary.write_text('#!' + sys.executable + '\nimport time\nprint("private-log-marker https://synthetic-only.trycloudflare.com", flush=True)\ntime.sleep(20)\n')
            binary.chmod(0o700)
            captured = io.StringIO()
            start = time.monotonic()
            with contextlib.redirect_stdout(captured): tunnel.run(binary, root/'run', lifetime=1)
            self.assertLess(time.monotonic()-start, 8)
            self.assertNotIn('private-log-marker', captured.getvalue())
            self.assertEqual((root/'run'/'public-origin.txt').read_text(), 'https://synthetic-only.trycloudflare.com/\n')


if __name__ == '__main__': unittest.main()
