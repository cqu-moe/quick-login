"""Operate the experiment's own local API without putting credentials in argv."""
import argparse
import getpass
import json
import os
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

p = argparse.ArgumentParser()
p.add_argument("operation", choices=["status", "login", "code", "probe", "export"])
p.add_argument("--student")
p.add_argument("--method", choices=["sms", "mail"], default="sms")
p.add_argument("--label", choices=["A", "B"], default="A")
p.add_argument("--out")
args = p.parse_args()
link = Path("/private/tmp/cqu-sso-probe-local-url").read_text()
base, token = link.split("#", 1)
headers = {"X-Probe-Token": token, "Content-Type": "application/json"}
body = None
if args.operation == "status":
    path = "api/status"
elif args.operation == "export":
    if not args.out:
        p.error("export requires --out")
    path = "api/export/" + args.label
else:
    path = "api/command"
    body = {"op": args.operation}
    if args.operation == "login":
        if not args.student:
            p.error("login requires --student")
        body.update(studentId=args.student, method=args.method, password=getpass.getpass("学校密码（不回显）: "))
    elif args.operation == "code":
        body["code"] = getpass.getpass("学校验证码（不回显）: ").strip()
try:
    request = Request(base + path, data=json.dumps(body).encode() if body else None, headers=headers)
    with urlopen(request, timeout=15) as response:
        result = json.load(response)
    if args.operation == "export":
        fd = os.open(args.out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as output:
            json.dump(result, output)
        print(json.dumps({"exported": True, "cookieCount": len(result["cookies"]), "label": args.label}))
    else:
        print(json.dumps(result, ensure_ascii=False))
except HTTPError as exc:
    print(json.dumps({"httpStatus": exc.code}))
    raise SystemExit(1)
except Exception as exc:
    print(json.dumps({"error": type(exc).__name__}))
    raise SystemExit(1)
