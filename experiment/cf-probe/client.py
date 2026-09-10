import argparse,getpass,json,re,os
from pathlib import Path
import requests
parser=argparse.ArgumentParser();parser.add_argument('op',choices=['health','run','code','permit']);args=parser.parse_args()
base=Path(__file__).parent
config=json.loads((base/'endpoint.json').read_text())
token=re.search(r'TOKEN=("[^"]+")', (base/'private.mjs').read_text()).group(1)
s=requests.Session();s.headers.update({'Authorization':'Bearer '+json.loads(token)})
if args.op=='health':
 r=s.get(config['url']+'/health',timeout=90);data=r.json()
 if data.get('bootId'):
  f=base/'boot.json';f.write_text(json.dumps(data));f.chmod(0o600)
 print(json.dumps(data));raise SystemExit
boot=json.loads((base/'boot.json').read_text())['bootId'];s.headers['X-Cqu-Expected-Boot-Id']=boot
body={'session':'quicklogin-cross-ip-20260909'}
if args.op=='run':
 body.update(studentId='30208415',password=getpass.getpass('School password: '),service='https://my.cqu.edu.cn/authserver/authentication/cas',method='mail',operationTimeoutMs=660000)
 path='/run'
 fresh=s.get(config['url']+'/health',timeout=90).json()
 boot=fresh['bootId'];s.headers['X-Cqu-Expected-Boot-Id']=boot
 (base/'boot.json').write_text(json.dumps(fresh))
 permit=s.post(config['url']+'/code-permit',json={'session':'quicklogin-cross-ip-20260909'},timeout=30)
 if not permit.json().get('ok'):raise SystemExit('Permit unavailable')
elif args.op=='code':body['code']=getpass.getpass('OTP: ');path='/code'
else:path='/code-permit'
r=s.post(config['url']+path,json=body,timeout=720)
body.clear();data=r.json()
if data.get('format')=='cqu-sso-cookie-probe-v1':
 out=Path('/private/tmp/cqu-sso-cloudflare.json')
 fd=os.open(out,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
 with os.fdopen(fd,'w') as f:json.dump(data,f)
 print(json.dumps({'ok':True,'source':data['source'],'cookieCount':len(data['cookies']),'export':str(out)}))
else:print(json.dumps(data))
