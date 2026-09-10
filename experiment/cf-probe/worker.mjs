import {TOKEN, EXPIRES} from './private.mjs';
const SESSION='quicklogin-cross-ip-20260909';
export default {
 async fetch(req,env){
  const path=new URL(req.url).pathname;
  if(Date.now()>EXPIRES || req.headers.get('Authorization')!==`Bearer ${TOKEN}`)return new Response('Forbidden',{status:403});
  if(!['/health','/run','/code','/code-permit'].includes(path))return new Response('Not found',{status:404});
  const headers={'content-type':'application/json','cache-control':'no-store'};
  const stub=env.CQU_LOGIN.getByName(SESSION);
  try{
   let body;
   if(path!='/health'){
    if(req.method!=='POST')return new Response('Method not allowed',{status:405});
    body=await req.json();
    if(path==='/run' && body.studentId!=='30208415')return new Response('Forbidden',{status:403});
    body.session=SESSION;
   }
   const bh=req.headers.get('X-Cqu-Expected-Boot-Id');
   const upstream=await stub.fetch(new Request(`http://cqu-login.internal${path}`,{method:path==='/health'?'GET':'POST',headers:{'content-type':'application/json',...(bh?{'X-Cqu-Expected-Boot-Id':bh}:{})},...(body?{body:JSON.stringify(body)}:{})}));
   const result=await upstream.json();
   if(path==='/run' && result.ok){
    const cookies=result.state.cookies.filter(c=>['sso.cqu.edu.cn','.sso.cqu.edu.cn'].includes(c.domain));
    return Response.json({format:'cqu-sso-cookie-probe-v1',createdAt:Date.now()/1000,source:'Cloudflare APAC CquLoginContainer',cookies},{headers});
   }
   return Response.json(result,{status:upstream.status,headers});
  }catch{return Response.json({ok:false,error:'PROBE_UPSTREAM_FAILED'},{status:502,headers});}
 }
};
