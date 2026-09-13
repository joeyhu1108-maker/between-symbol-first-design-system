"""Create an isolated, portable environment for the application and artwork tools."""
import pathlib
import subprocess
import sys
import venv

ROOT = pathlib.Path(__file__).resolve().parents[1]
if not (3, 9) <= sys.version_info[:2] <= (3, 12):
    raise SystemExit('Use Python 3.9–3.12; Python 3.11 or 3.12 is recommended.')
env = ROOT / '.venv'
venv.EnvBuilder(with_pip=True).create(env)
python = env / ('Scripts/python.exe' if sys.platform == 'win32' else 'bin/python')
subprocess.check_call([str(python), '-m', 'pip', 'install', '-r', str(ROOT / 'requirements.txt')])
print('Environment ready. Start with:', python, 'printer/server.py')
