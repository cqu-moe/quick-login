import concurrent.futures,getpass,json,re,time
from pathlib import Path
from urllib.parse import urlsplit,parse_qs
import requests
base=Path(__file__).parent
url='https://cqu-quicklogin-five-probe.user-unauthorized.workers.dev'
token=json.loads(re.search(r'TOKEN=("[^"]+")',(base/'private.mjs').read_text()).group(1))
password=getpass.getpass('School password: ')
exports=[]
with concurrent.futures.ThreadPoolExecutor(1) as pool:
 for slot in range(1,6):
  s=requests.Session();s.headers['Authorization']='Bearer '+token
  def endpoint(path): return url+path+'?slot='+str(slot)
  boot=s.get(endpoint('/health'),timeout=90).json();bid=boot.get('bootId')
  if not bid: raise SystemExit('Health failed')
  s.headers['X-Cqu-Expected-Boot-Id']=bid
  permit=s.post(endpoint('/code-permit'),json={},timeout=30).json()
  if not permit.get('ok'):raise SystemExit('Permit failed')
  body=dict(studentId='30208415',password=password,service='https://my.cqu.edu.cn/authserver/authentication/cas',method='mail',operationTimeoutMs=240000)
  future=pool.submit(s.post,endpoint('/run'),json=body,timeout=270)
  print(json.dumps({'slot':slot,'state':'login-started'}),flush=True)
  while not future.done():
   code=getpass.getpass('OTP (empty checks completion): ')
   if code:
    response=s.post(endpoint('/code'),json={'code':code},timeout=30)
    print(json.dumps({'slot':slot,'codeAccepted':response.json().get('ok',False)}),flush=True)
   if not future.done():time.sleep(1)
  r=future.result();data=r.json();body.clear()
  if data.get('format')!='cqu-sso-cookie-probe-v1':
   print(json.dumps({'slot':slot,'state':'login-failed','http':r.status_code,'error':data.get('error')}),flush=True);break
  exports.append(data); print(json.dumps({'slot':slot,'state':'login-success','cookies':len(data['cookies'])}),flush=True)
password=None
results=[]
for slot,p in enumerate(exports,1):
 s=requests.Session();s.trust_env=False
 for c in p['cookies']:s.cookies.set(c['name'],c['value'],domain=c['domain'],path=c['path'],secure=c['secure'])
 started=time.monotonic()
 try:
  r=s.get('https://sso.cqu.edu.cn/login',params={'service':'https://my.cqu.edu.cn/authserver/authentication/cas'},allow_redirects=False,timeout=30)
  target=urlsplit(r.headers.get('Location',''));issued=target.hostname=='my.cqu.edu.cn' and bool(parse_qs(target.query).get('ticket'))
  result=dict(slot=slot,ssoStatus=r.status_code,issuedTicket=issued,ms=round((time.monotonic()-started)*1000))
 except requests.RequestException as e:result=dict(slot=slot,issuedTicket=False,error=type(e).__name__)
 results.append(result);print(json.dumps(result),flush=True)
summary={'source':'Cloudflare production CquLoginContainer via isolated instances','receiver':'local-direct-HTTP','sessionsCreated':len(exports),'distinctTgcCount':len({c['value'] for p in exports for c in p['cookies'] if c['name']=='SOURCEID_TGC'}),'results':results,'measuredAt':time.strftime('%Y-%m-%dT%H:%M:%S%z')}
(base/'result.json').write_text(json.dumps(summary,indent=2));exports.clear()
