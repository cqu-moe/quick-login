"""Local-only experiment controller. Credentials and SSO state stay in memory."""
import asyncio
import base64
import contextlib
import json
import secrets
import shlex
import time
from pathlib import Path
from aiohttp import web

ROOT = Path(__file__).resolve().parent
TOKEN = secrets.token_urlsafe(32)
PORT = 18746
ORIGIN = f"http://127.0.0.1:{PORT}"
events = []
exports = {}
remote = None
busy = False
waiting_code = False
send_lock = asyncio.Lock()


def event(kind, **data):
    events.append({"time": time.strftime("%H:%M:%S"), "kind": kind, **data})
    del events[:-60]


async def consume_remote():
    global busy, waiting_code
    while line := await remote.stdout.readline():
        try:
            msg = json.loads(line)
        except Exception:
            event("protocol_error")
            continue
        kind = msg.get("kind")
        if kind == "ready":
            state = msg.pop("state")
            cookies = state.get("cookies", [])
            accepted = [c for c in cookies if c.get("domain") in ("sso.cqu.edu.cn", ".sso.cqu.edu.cn")]
            exports[msg["label"]] = {"cookies": accepted, "mintedAt": msg["mintedAt"]}
            msg["ssoCookieCount"] = len(accepted)
            msg["excludedCookieCount"] = len(cookies) - len(accepted)
            msg["localStorageOriginCount"] = len(state.get("origins", []))
            busy = waiting_code = False
        elif kind == "waiting_code":
            waiting_code = True
        elif kind in ("failed", "rejected"):
            busy = waiting_code = False
        elif kind == "probe_done":
            busy = False
        safe = {k: msg[k] for k in ("label", "status", "error", "ssoCookieCount", "excludedCookieCount", "localStorageOriginCount") if k in msg}
        event(kind, **safe)
    busy = waiting_code = False
    event("disconnected")


@web.middleware
async def guard(request, handler):
    if request.host != f"127.0.0.1:{PORT}":
        raise web.HTTPForbidden()
    if request.path.startswith("/api/"):
        if not secrets.compare_digest(request.headers.get("X-Probe-Token", ""), TOKEN):
            raise web.HTTPForbidden()
        if request.headers.get("Origin") not in (None, ORIGIN):
            raise web.HTTPForbidden()
    response = await handler(request)
    response.headers.update({"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'"})
    return response


async def index(request):
    return web.Response(text=(ROOT / "input.html").read_text(), content_type="text/html")


async def script(request):
    return web.Response(text=(ROOT / "input.js").read_text(), content_type="application/javascript")


async def status(request):
    return web.json_response({"events": events, "ready": list(exports), "busy": busy,
        "waitingCode": waiting_code, "connected": remote is not None and remote.returncode is None})


async def send(message):
    if remote is None or remote.returncode is not None:
        raise web.HTTPServiceUnavailable(text="测试进程未连接。")
    async with send_lock:
        remote.stdin.write((json.dumps(message) + "\n").encode())
        await remote.stdin.drain()


async def command(request):
    global busy, waiting_code
    message = await request.json()
    op = message.get("op")
    if op == "login":
        if busy or len(exports) >= 2:
            raise web.HTTPConflict(text="已有任务运行，或本次两次登录额度已用完。")
        sid, password = message.get("studentId"), message.get("password")
        if not isinstance(sid, str) or not sid.isdigit() or not 5 <= len(sid) <= 20:
            raise web.HTTPBadRequest(text="请输入学校账号。")
        if not isinstance(password, str) or not 1 <= len(password) <= 256 or message.get("method") not in ("sms", "mail"):
            raise web.HTTPBadRequest(text="密码或验证方式不正确。")
        busy = True
    elif op == "code":
        code = message.get("code")
        if not waiting_code or not isinstance(code, str) or len(code) != 6 or not code.isdigit():
            raise web.HTTPBadRequest(text="当前未等待验证码，或验证码格式不正确。")
        waiting_code = False
    elif op == "probe":
        if busy or not exports:
            raise web.HTTPConflict(text="当前不能探测。")
        busy = True
    else:
        raise web.HTTPBadRequest()
    try:
        await send(message)
    except Exception:
        busy = False
        raise
    finally:
        message.clear()
    return web.json_response({"accepted": True})


async def export(request):
    state = exports.get(request.match_info["label"])
    if not state:
        raise web.HTTPNotFound()
    return web.json_response({"format": "cqu-sso-cookie-probe-v1", "createdAt": time.time(), **state})


async def lifecycle(app):
    global remote
    encoded = base64.b64encode((ROOT / "remote_probe.py").read_bytes()).decode()
    program = f"import base64;exec(compile(base64.b64decode('{encoded}'),'<sso-probe>','exec'))"
    remote_command = "sudo -n -u cqulogin /opt/cqu-login/venv/bin/python -u -c " + shlex.quote(program)
    remote = await asyncio.create_subprocess_exec("ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10",
        "tencent-cd-cqu-moe", remote_command, stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL, limit=1024*1024)
    task = asyncio.create_task(consume_remote())
    yield
    remote.stdin.close()
    try:
        await asyncio.wait_for(remote.wait(), 20)
    except asyncio.TimeoutError:
        remote.terminate()
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task
    exports.clear()


app = web.Application(middlewares=[guard], client_max_size=4096)
app.cleanup_ctx.append(lifecycle)
app.add_routes([web.get("/", index), web.get("/input.js", script), web.get("/api/status", status),
    web.post("/api/command", command), web.get("/api/export/{label}", export)])

if __name__ == "__main__":
    # This is a local session-control token, not a school credential.
    link = Path("/private/tmp/cqu-sso-probe-local-url")
    import os
    fd = os.open(link, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(f"{ORIGIN}/#{TOKEN}")
    print(f"Local experiment UI: {ORIGIN}/ (session link saved privately)", flush=True)
    web.run_app(app, host="127.0.0.1", port=PORT, access_log=None, print=None)
