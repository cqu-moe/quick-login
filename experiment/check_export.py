"""Check exported SSO cookies in a fresh server browser; print verdict only."""
import argparse
import base64
import json
import shlex
import subprocess
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("file")
args = parser.parse_args()
payload = json.loads(Path(args.file).read_text())
if payload.get("format") != "cqu-sso-cookie-probe-v1":
    raise SystemExit("Unexpected export format")
if any(c.get("domain") not in ("sso.cqu.edu.cn", ".sso.cqu.edu.cn") for c in payload["cookies"]):
    raise SystemExit("Unexpected cookie domain")
program = '''
import asyncio,contextlib,json,logging,os,sys
os.environ["PLAYWRIGHT_BROWSERS_PATH"]="/opt/cqu-login/.cache/ms-playwright"
sys.path.insert(0,"/opt/cqu-login/app")
logging.disable(logging.CRITICAL)
output=sys.stdout
state=json.load(sys.stdin)
async def check():
    import cqu_keepalive
    try:
        result=await asyncio.wait_for(cqu_keepalive.probe_session_browser(state),timeout=120)
        output.write(json.dumps({"status":result["status"],"input":"sso-cookies-only","location":"original-server"})+"\\n")
    except Exception as exc:
        output.write(json.dumps({"status":"unreachable","error":type(exc).__name__})+"\\n")
    output.flush()
with open("/dev/null","w") as silent,contextlib.redirect_stdout(silent),contextlib.redirect_stderr(silent):
    asyncio.run(check())
'''
encoded = base64.b64encode(program.encode()).decode()
command = "sudo -n -u cqulogin /opt/cqu-login/venv/bin/python -u -c " + shlex.quote(f"import base64;exec(base64.b64decode('{encoded}'))")
try:
    result = subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "tencent-cd-cqu-moe", command],
        input=json.dumps({"cookies": payload["cookies"], "origins": []}), text=True,
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=150)
    if result.returncode:
        print(json.dumps({"status": "unreachable", "sshExitCode": result.returncode}))
    else:
        verdict = json.loads(result.stdout)
        print(json.dumps({k: verdict[k] for k in ("status", "input", "location", "error") if k in verdict}))
except Exception as exc:
    print(json.dumps({"status": "unreachable", "error": type(exc).__name__}))
