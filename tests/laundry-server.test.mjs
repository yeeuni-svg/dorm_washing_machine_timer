import {test} from "node:test";
import assert from "node:assert/strict";
import {handleLaundryRequest,sealSession,openSession,normalizeStatus} from "../lib/laundry-server.mjs";
const env={LAUNDRY_SESSION_KEY:"a".repeat(64)};
const deviceId="0b3ccce9-6d58-fbc3-52ab-5dae2abb1ff4";
const token="test-token-for-local-checks-only-000";
const raw={components:{main:{"samsungce.washerOperatingState":{operatingState:{value:"running"},remainingTime:{value:100,timestamp:"2026-11-06T12:35:00Z"},operationTime:{value:146},progress:{value:32},washerJobPhase:{value:"drumCleaning"}}}}};
function request(path,method="GET",body,cookie,user="owner",origin="https://laundry.test"){
 const headers={};if(user)headers["oai-authenticated-user-id"]=user;if(cookie)headers.cookie=cookie;
 if(method==="POST"){headers.origin=origin;headers["content-type"]="application/json";}
 return new Request(`https://laundry.test/api/laundry/${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
}
const upstream=async(url,options)=>{assert.equal(options.method,"GET");assert.equal(options.redirect,"manual");assert.equal(options.headers.Authorization,`Bearer ${token}`);assert.ok(url.startsWith(`https://api.smartthings.com/v1/devices/${deviceId}/`));return Response.json(url.endsWith("/health")?{state:"ONLINE"}:raw);};

test("missing identity and cross-origin mutations are rejected before upstream calls",async()=>{
 const fail=()=>{throw new Error("must not contact Samsung");};
 assert.equal((await handleLaundryRequest(request("session","GET",undefined,undefined,null),env,fail)).status,401);
 assert.equal((await handleLaundryRequest(request("connect","POST",{token},undefined,"owner","https://elsewhere.test"),env,fail)).status,403);
 assert.equal((await handleLaundryRequest(request("connect","POST",{token:"bad"}),env,fail)).status,400);
});
test("connected credentials are encrypted, user-bound, expire, and never appear in JSON",async()=>{
 const response=await handleLaundryRequest(request("connect","POST",{token}),env,upstream);
 assert.equal(response.status,200);
 const cookie=response.headers.get("set-cookie");
 assert.ok(cookie.includes("HttpOnly; Secure; SameSite=Strict"));assert.ok(!cookie.includes(token));
 const text=await response.text();assert.ok(!text.includes(token));assert.equal(JSON.parse(text).state.remaining,100);
 const value=cookie.split(";")[0].split("=")[1];
 assert.equal((await openSession(value,env.LAUNDRY_SESSION_KEY,"owner")).token,token);
 assert.equal(await openSession(value,env.LAUNDRY_SESSION_KEY,"someone-else"),null);
 assert.equal(await openSession(value,"b".repeat(64),"owner"),null);
 assert.equal(await openSession(value,env.LAUNDRY_SESSION_KEY,"owner",Date.now()+25*3600000),null);
 const req=request("status","GET",undefined,cookie.split(";")[0]);
 const status=await handleLaundryRequest(req,env,upstream);assert.equal((await status.json()).state.remaining,100);
});
test("server returns fresh upstream remaining values, not an invented countdown",async()=>{
 const value=await sealSession({id:crypto.randomUUID(),userId:"owner",token,deviceId,expiresAt:Date.now()+60000},env.LAUNDRY_SESSION_KEY);
 const mock=async(url,options)=>Response.json(url.endsWith("/health")?{state:"ONLINE"}:{components:{main:{"samsungce.washerOperatingState":{...raw.components.main["samsungce.washerOperatingState"],remainingTime:{value:96}}}}});
 const response=await handleLaundryRequest(request("status","GET",undefined,`__Host-laundry-session=${value}`),env,mock);
 assert.equal((await response.json()).state.remaining,96);
});
test("offline, pause, and missing remaining time are not displayed as zero or running",()=>{
 assert.equal(normalizeStatus(raw,{state:"OFFLINE"}).remaining,null);
 assert.equal(normalizeStatus(raw,{state:"OFFLINE"}).status,"offline");
 const paused=structuredClone(raw);paused.components.main["samsungce.washerOperatingState"].operatingState.value="paused";paused.components.main.washerOperatingState={machineState:{value:"run"}};
 assert.equal(normalizeStatus(paused,null).status,"paused");assert.equal(normalizeStatus(paused,null).remaining,null);
 const missing=structuredClone(raw);delete missing.components.main["samsungce.washerOperatingState"].remainingTime;
 assert.equal(normalizeStatus(missing,null).remaining,null);
});
test("token expiry clears the protected cookie and rate limits return a backoff",async()=>{
 for(const status of [401,429]){
  const value=await sealSession({id:crypto.randomUUID(),userId:"owner",token,deviceId,expiresAt:Date.now()+60000},env.LAUNDRY_SESSION_KEY);
  const response=await handleLaundryRequest(request("status","GET",undefined,`__Host-laundry-session=${value}`),env,async()=>new Response("upstream error",{status,headers:{"retry-after":"40"}}));
  assert.equal(response.status,status);
  if(status===401)assert.ok(response.headers.get("set-cookie").includes("Max-Age=0"));
  else assert.equal((await response.json()).retryAfter,40);
 }
});
test("disconnect clears browser credentials without modifying Samsung devices",async()=>{
 const result=await handleLaundryRequest(request("disconnect","POST",{}),env,()=>{throw new Error("must not modify devices");});
 assert.equal(result.status,200);assert.ok(result.headers.get("set-cookie").includes("Max-Age=0"));
});
test("redirects are rejected without forwarding credentials or saving a session",async()=>{
 const calls=[];
 const response=await handleLaundryRequest(request("connect","POST",{token}),env,async function(url,options){
  assert.equal(this,globalThis);assert.equal(options.redirect,"manual");calls.push(url);
  return new Response(null,{status:302,headers:{Location:"https://untrusted.example/"}});
 });
 assert.equal(response.status,503);assert.equal(response.headers.get("set-cookie"),null);
 assert.ok(calls.every(url=>url.startsWith("https://api.smartthings.com/")));
});
