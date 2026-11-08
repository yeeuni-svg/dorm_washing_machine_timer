const DEVICE_ID = "0b3ccce9-6d58-fbc3-52ab-5dae2abb1ff4";
const COOKIE = "__Host-laundry-session";
const SESSION_MS = 24 * 60 * 60 * 1000;
const cache = new Map();
const encoder = new TextEncoder();
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {status, headers: {"Content-Type":"application/json; charset=utf-8", "Cache-Control":"no-store, private", "Pragma":"no-cache", "X-Content-Type-Options":"nosniff", ...extra}});
const clearCookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

function encode(bytes) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,""); }
function decode(value) { const base = value.replace(/-/g,"+").replace(/_/g,"/"); return Uint8Array.from(atob(base + "=".repeat((4-base.length%4)%4)), c=>c.charCodeAt(0)); }
async function keyFor(secret) {
  if(typeof secret !== "string" || !/^[0-9a-f]{64}$/.test(secret)) throw new Error("SERVER_SETUP");
  return crypto.subtle.importKey("raw", Uint8Array.from(secret.match(/../g), h=>parseInt(h,16)), "AES-GCM", false, ["encrypt","decrypt"]);
}
export async function sealSession(session, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:encoder.encode(COOKIE)}, await keyFor(secret), encoder.encode(JSON.stringify(session))));
  return `${encode(iv)}.${encode(bytes)}`;
}
export async function openSession(value, secret, userId, now=Date.now()) {
  try {
    if(!value || value.length > 3800) return null;
    const [iv,cipher,...rest] = value.split(".");
    if(rest.length || !iv || !cipher) return null;
    const bytes = await crypto.subtle.decrypt({name:"AES-GCM",iv:decode(iv),additionalData:encoder.encode(COOKIE)},await keyFor(secret),decode(cipher));
    const session = JSON.parse(new TextDecoder().decode(bytes));
    return session.userId===userId && session.expiresAt>now && session.deviceId===DEVICE_ID && typeof session.token==="string" ? session : null;
  } catch { return null; }
}
function cookieValue(request) {
  const prefix = `${COOKIE}=`;
  return (request.headers.get("cookie")||"").split(";").map(s=>s.trim()).find(s=>s.startsWith(prefix))?.slice(prefix.length);
}
class UpstreamError extends Error { constructor(status, retry=30) {super("UPSTREAM"); this.status=status; this.retry=retry;} }
function retrySeconds(response) {
  const ms=Number(response.headers.get("x-ratelimit-reset"));
  const seconds=Number(response.headers.get("retry-after"));
  return Math.max(10,Math.min(300,seconds>0?seconds:ms>0?Math.ceil(ms/1000):30));
}
async function samsungGet(path, token, fetcher) {
  let response;
  try {response=await fetcher.call(globalThis,`https://api.smartthings.com/v1/devices/${DEVICE_ID}${path}`,{method:"GET",headers:{Authorization:`Bearer ${token}`,Accept:"application/json"},signal:AbortSignal.timeout(8000),redirect:"manual"});}
  catch {throw new UpstreamError(503);}
  // Never forward a device credential to a redirect destination.
  if(response.status>=300 && response.status<400)throw new UpstreamError(502);
  if(!response.ok)throw new UpstreamError(response.status,retrySeconds(response));
  try{return await response.json();}catch{throw new UpstreamError(502);}
}
export function normalizeStatus(raw, health, checkedAt=new Date().toISOString()) {
  const main=raw?.components?.main||{};
  const modern=main["samsungce.washerOperatingState"]||{};
  const standard=main.washerOperatingState||{};
  const op=modern.operatingState?.value;
  const legacy=standard.machineState?.value;
  const online=health?.state!=="OFFLINE";
  const modernStates={running:"running",paused:"paused",ready:"ready"};
  const legacyStates={run:"running",pause:"paused",stop:"ready",idle:"ready"};
  const status=!online?"offline":modernStates[op]||legacyStates[legacy]||"unavailable";
  const value=modern.remainingTime?.value;
  const remaining=status==="running"&&value!==null&&value!==undefined&&Number.isFinite(Number(value))&&Number(value)>=0?Math.round(Number(value)):null;
  const progress=Number(modern.progress?.value);
  const duration=Number(modern.operationTime?.value);
  const phase=modern.washerJobPhase?.value||modern.washerJobState?.value||standard.washerJobState?.value;
  const courses={drumCleaning:"무세제 통세척",wash:"세탁",washing:"세탁",rinse:"헹굼",rinsing:"헹굼",spin:"탈수",spinning:"탈수",finish:"완료",finished:"완료",none:"대기"};
  return {id:5,status,remaining,total:Number.isFinite(duration)&&duration>0?duration:null,progress:Number.isFinite(progress)?Math.min(100,Math.max(0,progress)):null,course:courses[phase]||(status==="running"?"세탁 중":status==="paused"?"일시정지":status==="ready"?"작동하지 않음":"상태 확인 필요"),online,healthKnown:typeof health?.state==="string",checkedAt,updatedAt:modern.remainingTime?.timestamp||modern.operatingState?.timestamp||standard.machineState?.timestamp||null,completionTime:standard.completionTime?.value||null,recorded:false,live:true};
}
async function readStatus(token, fetcher) {
  const [raw,health] = await Promise.all([samsungGet("/status",token,fetcher),samsungGet("/health",token,fetcher).catch(()=>null)]);
  return normalizeStatus(raw,health);
}
function safeError(error) {
  const status=error instanceof UpstreamError?error.status:503;
  if(status===401)return json({code:"TOKEN_EXPIRED",message:"토큰이 만료되었거나 유효하지 않아요. 새 토큰으로 다시 연결해 주세요."},401,{"Set-Cookie":clearCookie});
  if(status===403)return json({code:"PERMISSION",message:"이 세탁기를 조회할 권한이 없어요. 같은 삼성 계정과 디바이스 보기 권한을 확인해 주세요."},403);
  if(status===404)return json({code:"DEVICE_NOT_FOUND",message:"5번 세탁기를 찾지 못했어요. 등록한 삼성 계정과 기기 연결을 확인해 주세요."},404);
  if(status===402)return json({code:"PLAN_REQUIRED",message:"삼성에서 API 이용 조건 또는 사용량 확인을 요청했어요. 자동 조회를 중지했습니다."},402);
  if(status===429)return json({code:"RATE_LIMIT",message:"조회 요청이 잠시 제한됐어요. 잠시 후 다시 확인합니다.",retryAfter:error.retry},429,{"Retry-After":String(error.retry)});
  return json({code:"UPSTREAM_UNAVAILABLE",message:"삼성에서 최신 상태를 받지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.",retryAfter:30},503);
}
export async function handleLaundryRequest(request, env, fetcher=fetch) {
  const url=new URL(request.url), path=url.pathname;
  if(!path.startsWith("/api/laundry/"))return null;
  // This read-only probe is protected by the owner-private Site's access gate.
  // It never uses a PAT, accepts no target URL, and returns no Samsung payload.
  if(path==="/api/laundry/diagnostics" && request.method==="GET"){
    const results={};
    for(const mode of ["unbound","bound"]){
      const started=Date.now();
      try{
        const options={method:"GET",headers:{Accept:"application/json"},signal:AbortSignal.timeout(6000),redirect:"manual"};
        const target=`https://api.smartthings.com/v1/devices/${DEVICE_ID}/status`;
        const response=mode==="bound"?await fetcher.call(globalThis,target,options):await fetcher(target,options);
        results[mode]={status:response.status,milliseconds:Date.now()-started};
      }catch(error){results[mode]={name:error?.name||"Error",message:String(error?.message||"request failed").slice(0,200),milliseconds:Date.now()-started};}
    }
    return json({probe:"no-credentials",results});
  }
  const userId=request.headers.get("oai-authenticated-user-id");
  if(!userId)return json({code:"SIGN_IN_REQUIRED",message:"사이트를 소유한 ChatGPT 계정으로 로그인해 주세요."},401);
  if(!env.LAUNDRY_SESSION_KEY)return json({code:"SERVER_SETUP",message:"서버 연결 설정이 준비되지 않았어요."},503);
  if(request.method==="POST"){
    if(request.headers.get("origin")!==url.origin)return json({code:"ORIGIN_REJECTED",message:"사이트에서 직접 연결해 주세요."},403);
    if(!request.headers.get("content-type")?.startsWith("application/json"))return json({code:"CONTENT_TYPE",message:"올바르지 않은 요청이에요."},415);
  }
  if(path==="/api/laundry/connect" && request.method==="POST"){
    let token;
    try{const text=await request.text();if(text.length>4096)throw new Error();const body=JSON.parse(text);token=String(body.token||"").trim().replace(/^Bearer\s+/i,"");if(!/^[A-Za-z0-9._~-]{20,2048}$/.test(token))throw new Error();}
    catch{return json({code:"BAD_TOKEN",message:"발급받은 토큰 문자열을 확인해 주세요."},400);}
    try{
      const state=await readStatus(token,fetcher);
      const session={id:crypto.randomUUID(),userId,token,deviceId:DEVICE_ID,expiresAt:Date.now()+SESSION_MS};
      const value=await sealSession(session,env.LAUNDRY_SESSION_KEY);
      cache.set(session.id,{state,until:Date.now()+8000});
      return json({connected:true,state,pollIntervalMs:10000},200,{"Set-Cookie":`${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`});
    }catch(error){return safeError(error);}
  }
  const session=await openSession(cookieValue(request),env.LAUNDRY_SESSION_KEY,userId);
  if(path==="/api/laundry/session" && request.method==="GET")return json({connected:!!session,deviceId:session?DEVICE_ID:null,pollIntervalMs:10000});
  if(path==="/api/laundry/disconnect" && request.method==="POST"){
    if(session)cache.delete(session.id);
    return json({connected:false},200,{"Set-Cookie":clearCookie});
  }
  if(path==="/api/laundry/status" && request.method==="GET"){
    if(!session)return json({code:"NOT_CONNECTED",message:"SmartThings 연결에서 토큰을 입력해 주세요."},401,{"Set-Cookie":clearCookie});
    try{
      if(cache.size>100)for(const [id,entry]of cache)if(entry.until<Date.now())cache.delete(id);
      let entry=cache.get(session.id);
      if(!entry || entry.until<Date.now()){
        if(!entry?.pending){entry={pending:readStatus(session.token,fetcher),until:0};cache.set(session.id,entry);}
        const state=await entry.pending;
        entry={state,until:Date.now()+8000};cache.set(session.id,entry);
      }
      return json({connected:true,state:entry.state,pollIntervalMs:10000});
    }catch(error){cache.delete(session.id);return safeError(error);}
  }
  return json({code:"NOT_FOUND",message:"존재하지 않는 요청이에요."},404);
}
