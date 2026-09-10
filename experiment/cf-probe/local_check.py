import json,time
from pathlib import Path
from urllib.parse import urlsplit,parse_qs
import requests
p=json.loads(Path('/private/tmp/cqu-sso-cloudflare.json').read_text())
s=requests.Session();s.trust_env=False
for c in p['cookies']:s.cookies.set(c['name'],c['value'],domain=c['domain'],path=c['path'],secure=c['secure'])
start=time.monotonic()
r=s.get('https://sso.cqu.edu.cn/login',params={'service':'https://my.cqu.edu.cn/authserver/authentication/cas'},allow_redirects=False,timeout=30)
loc=r.headers.get('Location','');u=urlsplit(loc)
issued=bool(parse_qs(u.query).get('ticket')) and u.hostname=='my.cqu.edu.cn'
result={'source':p['source'],'receiver':'local-direct-HTTP','importedSsoCookies':len(p['cookies']),'ssoStatus':r.status_code,'issuedTicket':issued,'ticketMs':round((time.monotonic()-start)*1000)}
if issued:
 r=s.get(loc,allow_redirects=True,timeout=30)
 result.update(callbackStatus=r.status_code,finalHost=urlsplit(r.url).hostname,finalPath=urlsplit(r.url).path,businessCookieNames=sorted({c.name for c in s.cookies if c.domain.lstrip('.')=='my.cqu.edu.cn'}),returnedToSso=urlsplit(r.url).hostname=='sso.cqu.edu.cn',bodyBytes=len(r.content))
print(json.dumps(result,ensure_ascii=False))
Path('experiment/cf-probe/result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
