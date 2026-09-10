"""Throwaway SSH subprocess; protocol output is consumed privately by serve.py."""
import asyncio
import contextlib
import json
import logging
import os
import sys
import time

protocol_output = sys.stdout
sys.path.insert(0, "/opt/cqu-login/app")
os.environ["PLAYWRIGHT_BROWSERS_PATH"] = "/opt/cqu-login/.cache/ms-playwright"
logging.disable(logging.CRITICAL)


def emit(kind, **data):
    protocol_output.write(json.dumps({"kind": kind, **data}) + "\n")
    protocol_output.flush()


async def main():
    import cqu_login
    import cqu_keepalive

    states = {}
    code_queue = asyncio.Queue()
    active = None

    async def code_provider():
        emit("waiting_code")
        return await asyncio.wait_for(code_queue.get(), timeout=570)

    async def login(message):
        label = "A" if not states else "B"
        emit("logging_in", label=label)
        try:
            result = await asyncio.wait_for(cqu_login.run_login(
                message["studentId"], message["password"], cqu_login.DEFAULT_SERVICE,
                method=message["method"], code_provider=code_provider, proxy=None,
            ), timeout=700)
            states[label] = result["state"]
            emit("ready", label=label, mintedAt=time.time(), state=states[label])
        except Exception as exc:
            emit("failed", error=type(exc).__name__)
        finally:
            message.clear()

    async def probe():
        for label in list(states):
            try:
                result = await asyncio.wait_for(cqu_keepalive.probe_session_browser(states[label]), timeout=120)
                emit("probe_result", label=label, status=result["status"])
            except Exception as exc:
                emit("probe_result", label=label, status="unreachable", error=type(exc).__name__)
        emit("probe_done")

    emit("connected")
    while line := await asyncio.to_thread(sys.stdin.readline):
        try:
            message = json.loads(line)
            op = message.get("op")
            if op == "code" and active and not active.done():
                await code_queue.put(message["code"])
            elif op == "login" and (active is None or active.done()) and len(states) < 2:
                while not code_queue.empty():
                    code_queue.get_nowait()
                active = asyncio.create_task(login(message))
            elif op == "probe" and states and (active is None or active.done()):
                active = asyncio.create_task(probe())
            else:
                emit("rejected")
        except Exception as exc:
            emit("failed", error=type(exc).__name__)
    if active and not active.done():
        active.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await active


if __name__ == "__main__":
    with open("/dev/null", "w") as silent, contextlib.redirect_stdout(silent), contextlib.redirect_stderr(silent):
        asyncio.run(main())
