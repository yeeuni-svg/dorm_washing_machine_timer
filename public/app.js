(function(){
if(window.__laundryAppLoaded)return;window.__laundryAppLoaded=true;
"use strict";

// A recorded API result, not a live connection. No credentials are stored here.
const recordedWasher = { id: 5, status: "running", remaining: 100, total: 146, progress: 32, course: "무세제 통세척", recorded: true };
const machines = {
  washer: Array.from({ length: 5 }, (_, i) => ({ id: i + 1, status: "unknown" })),
  dryer: Array.from({ length: 5 }, (_, i) => ({ id: i + 1, status: "unknown" }))
};
// Explicitly labelled design examples illustrate every supported visual state.
const examples = {
  washer: [{ id: 1, status: "ready" }, { id: 2, status: "running", remaining: 22, total: 60, progress: 63, course: "표준 세탁" }, { id: 3, status: "ready" }, { id: 4, status: "error" }, { ...recordedWasher, recorded: false }],
  dryer: [{ id: 1, status: "running", remaining: 16, total: 60, progress: 73, course: "표준 건조" }, { id: 2, status: "ready" }, { id: 3, status: "running", remaining: 42, total: 80, progress: 48, course: "이불 건조" }, { id: 4, status: "offline" }, { id: 5, status: "ready" }]
};
const statusLabels = { running: "작동 중", ready: "대기 중", paused: "일시정지", unavailable: "확인 필요", unknown: "연동 전", error: "확인 필요", offline: "오프라인" };
const icons = {
  unknown: '<path d="m8 16-2 2a4 4 0 0 1-5.7-5.6l4-4A4 4 0 0 1 10 8m6 0 2-2a4 4 0 0 1 5.7 5.6l-4 4A4 4 0 0 1 14 16M3 3l18 18"/>',
  ready: '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/>',
  error: '<path d="m8 3 3 3-3 3-3-3a6 6 0 0 0 7 8l6 6a2.1 2.1 0 0 0 3-3l-6-6a6 6 0 0 0-7-8Z"/>',
  offline: '<path d="M3 3l18 18M2 8a17 17 0 0 1 3-1.8M9 5.3A17 17 0 0 1 22 8M5 12a11 11 0 0 1 3-1.6M12 10a11 11 0 0 1 7 2M8.5 15.5a5 5 0 0 1 7 0"/><circle cx="12" cy="19" r="1"/>'
};
const dryerIcon = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M5 3c-3 4 3 5 0 9m6-9c-3 4 3 5 0 9" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>';
const washerIcon = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 7c2-2 4 2 6 0s4 2 6 0M2 11c2-2 4 2 6 0s4 2 6 0" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>';
const vent = '<svg viewBox="0 0 30 9" fill="none" aria-hidden="true"><path d="M1 2h28M1 5h28M1 8h28" stroke="currentColor" stroke-width="1"/></svg>';
icons.paused = '<path d="M8 5v14M16 5v14" stroke-width="3"/>';
icons.unavailable = icons.offline;
icons.running = '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>';
let kind = "washer";
let exampleMode = false;
let returnFocus = null;
let connectionActive = false;
let livePhase = "disconnected";
let lastChecked = null;
let lastDeviceUpdate = null;
let pollTimer;
let requestRunning = false;
const grid = document.getElementById("machines");
const dialog = document.getElementById("detail-dialog");
const toggle = document.getElementById("example-toggle");

function label() { return kind === "washer" ? "세탁기" : "건조기"; }
function data() { return (exampleMode ? examples : machines)[kind]; }
function timed(m) { return m.status === "running" && Number.isFinite(m.remaining); }
function remainingFraction(m) { return Math.min(1,Math.max(0,m.total>0?m.remaining/m.total:Number.isFinite(m.progress)?1-m.progress/100:1)); }
function timeText(minutes) {
  const hours = Math.floor(minutes / 60), mins = minutes % 60;
  return (hours ? `${hours}시간` : "") + (hours && mins ? " " : "") + (mins || !hours ? `${mins}분` : "");
}
function timeMarkup(minutes) {
  const hours = Math.floor(minutes / 60), mins = minutes % 60;
  if (hours) return `<span class="clock-time"><span class="time-row"><span class="number">${hours}</span><span class="unit">시간</span></span>${mins ? `<span class="time-row"><span class="number">${mins}</span><span class="unit">분</span></span>` : ""}</span>`;
  return `<span class="clock-time compact"><span class="number">${mins}</span><span class="unit">분</span></span>`;
}
function clock(machine) {
  const running = timed(machine);
  const fraction = running ? remainingFraction(machine) : 0;
  const ticks = Array.from({ length: 60 }, (_, i) => {
    const angle = i * Math.PI / 30, major = i % 5 === 0, a = major ? 85 : 88, b = 91;
    return `<line class="clock-tick${major ? " major" : ""}" x1="${(100 + Math.sin(angle) * a).toFixed(2)}" y1="${(100 - Math.cos(angle) * a).toFixed(2)}" x2="${(100 + Math.sin(angle) * b).toFixed(2)}" y2="${(100 - Math.cos(angle) * b).toFixed(2)}"/>`;
  }).join("");
  const angle = fraction * Math.PI * 2;
  const ring = running ? `<circle class="clock-progress" cx="100" cy="100" r="76" pathLength="100" stroke-dasharray="${fraction * 100} 100"/><circle class="clock-pin" cx="${(100 + Math.sin(angle) * 76).toFixed(2)}" cy="${(100 - Math.cos(angle) * 76).toFixed(2)}" r="4.3"/>` : "";
  const caption = machine.status === "unknown" ? "정보 연결 준비 중" : machine.status === "ready" ? "작동하지 않아요" : machine.status === "error" ? "현장 확인이 필요해요" : machine.status === "paused" ? "기기가 잠시 멈췄어요" : machine.status === "running" ? "남은 시간 확인 중" : "최신 정보 확인 필요";
  const content = running ? `${timeMarkup(machine.remaining)}<span class="remaining-label">남음</span>` : `<svg class="door-icon" viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[machine.status]}</svg><span class="empty-title">${statusLabels[machine.status]}</span><span class="empty-caption">${caption}</span>`;
  return `<div class="door-wrap" aria-hidden="true"><svg class="clock-face" viewBox="0 0 200 200">${ticks}<circle class="clock-track" cx="100" cy="100" r="76"/>${ring}</svg><div class="clock-content">${content}</div></div>`;
}
function renderMachine(m) {
  const running = m.status === "running";
  const course = running ? m.course : m.status === "unknown" ? "남은 시간 확인 준비 중" : m.status === "ready" ? "새로운 세탁을 기다리는 중" : m.status === "error" ? "기기 점검이 필요해요" : "기기 정보 수신이 안 돼요";
  const actualCourse = kind === "dryer" && m.status === "ready" ? "새로운 건조를 기다리는 중" : course;
  const caption = running ? `${Number.isFinite(m.progress)?`진행률 <strong>${m.progress}%</strong> <span aria-hidden="true">·</span> `:""}${m.live ? "실제 조회" : m.recorded ? "조회 기록" : "상태 예시"}` : m.live ? "실제 조회" : m.status === "unknown" ? "연결 후 상태가 표시돼요" : "상태 예시";
  const accessible = `${label()} ${m.id}번, ${statusLabels[m.status]}${timed(m) ? `, ${timeText(m.remaining)} 남음` : ""}. ${m.live ? "삼성 API 조회" : exampleMode ? "디자인 예시" : m.recorded ? "테스트 조회 기록" : "기기 미연동"}. 자세히 보기`;
  return `<article class="machine-unit" data-status="${m.status}"><div class="machine-label"><h3 class="machine-number">${label()} ${m.id}번</h3><span class="state-chip"><span class="status-dot" aria-hidden="true"></span>${statusLabels[m.status]}</span></div><button class="appliance" type="button" data-id="${m.id}" aria-label="${accessible}"><span class="control-panel" aria-hidden="true"><span class="dispenser"><i></i><i></i></span><span class="panel-right"><i class="dial-knob"></i><i class="power-light"></i></span></span><div class="machine-body">${clock(m)}<p class="machine-course">${actualCourse}</p><span class="machine-bottom" aria-hidden="true"><span class="model-type">${kind === "dryer" ? dryerIcon : washerIcon}${kind === "dryer" ? "DRYER" : "WASHER"}</span>${vent}</span></div></button><p class="machine-caption">${caption}</p></article>`;
}
function renderSummary() {
  const summary = document.getElementById("status-summary");
  const counts = data().reduce((acc, m) => (acc[m.status] = (acc[m.status] || 0) + 1, acc), {});
  summary.innerHTML = ["ready", "running", "paused", "unavailable", "error", "offline", "unknown"].filter(s => counts[s]).map(s => `<span class="summary-item"><span class="status-dot dot-${s}" aria-hidden="true"></span>${statusLabels[s]} <strong>${counts[s]}대</strong></span>`).join("") + `<span class="summary-mode">${exampleMode ? "상태별 예시" : connectionActive ? "10초 간격 확인" : "미연결"}</span>`;
}
function renderQuickLook() {
  const running = data().filter(timed).sort((a, b) => a.remaining - b.remaining)[0];
  const connectedMachine = !exampleMode && kind === "washer" && connectionActive ? machines.washer[4] : null;
  document.getElementById("quick-record").textContent = exampleMode ? "상태 예시" : connectionActive ? "실제 조회" : "연결 전";
  document.getElementById("quick-name").textContent = running ? `${label()} ${running.id}번` : connectedMachine ? "세탁기 5번" : label();
  document.getElementById("quick-time").innerHTML = running ? `${timeText(running.remaining)}<span>남음</span>` : connectedMachine ? statusLabels[connectedMachine.status] : "아직 연동 전";
  document.getElementById("quick-caption").textContent = running ? `${running.course}${Number.isFinite(running.progress)?` · 진행률 ${running.progress}%`:""}` : connectedMachine ? connectedMachine.course || "남은 시간은 작동 중에 표시돼요" : "연결 후 기기별 남은 시간이 표시돼요";
  document.getElementById("quick-ring").setAttribute("stroke-dasharray", `${running ? remainingFraction(running) * 100 : 0} 100`);
}
function render() {
  document.getElementById("section-title").textContent = `${label()} 현황`;
  grid.setAttribute("aria-labelledby", `${kind}-tab`);
  grid.innerHTML = data().map(renderMachine).join("");
  renderSummary();
  renderQuickLook();
}
function selectTab(nextKind, focus = false) {
  kind = nextKind;
  document.querySelectorAll(".tab").forEach(tab => {
    const selected = tab.dataset.kind === kind;
    tab.classList.toggle("selected", selected);
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (focus && selected) tab.focus();
  });
  render();
}
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => selectTab(tab.dataset.kind));
  tab.addEventListener("keydown", event => {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      selectTab(event.key === "Home" ? "washer" : event.key === "End" ? "dryer" : kind === "washer" ? "dryer" : "washer", true);
    }
  });
});
toggle.addEventListener("click", () => {
  exampleMode = !exampleMode;
  toggle.setAttribute("aria-pressed", String(exampleMode));
  toggle.querySelector("span").textContent = exampleMode ? "조회 기록으로 돌아가기" : "상태별 예시 보기";
  document.getElementById("preview-copy").innerHTML = exampleMode ? "<strong>상태별 디자인 예시를 보고 있어요.</strong> 아래의 기기 상태와 시간은 실제 현황이 아닙니다." : "<strong>실시간 현황이 아닌 화면 시안이에요.</strong> 5번 세탁기의 테스트 조회 기록을 표시합니다.";
  render();
});
grid.addEventListener("click", event => {
  const button = event.target.closest("button[data-id]");
  if (!button) return;
  const m = data().find(item => item.id === Number(button.dataset.id));
  returnFocus = button;
  const facts = [["위치", "율곡관 지하 1층"], ["작동 상태", statusLabels[m.status]]];
  if (m.status === "running") facts.push(["남은 시간", timed(m)?timeText(m.remaining):"확인 중"], ["진행률", Number.isFinite(m.progress)?`${m.progress}%`:"확인 중"], ["현재 과정", m.course]);
  facts.push(["정보 구분", m.live ? "SmartThings API 실제 조회" : exampleMode ? "디자인 예시" : m.recorded ? "11월 6일 테스트 조회 기록" : "아직 연결되지 않은 기기"]);
  if(m.checkedAt) facts.push(["마지막 확인", koreanTime(m.checkedAt)]);
  if(m.updatedAt) facts.push(["기기 값 갱신", koreanTime(m.updatedAt)]);
  const note = m.live && ["offline","unavailable"].includes(m.status) ? "최신 상태를 확인하지 못해 남은 시간을 표시하지 않습니다. 연결이 복구되면 다시 확인합니다." : m.status === "unknown" ? "기기를 연결하면 작동 상태와 남은 시간을 확인할 수 있어요." : m.status === "ready" ? "대기 중은 기기가 작동하지 않는다는 뜻이에요. 안에 세탁물이 남아 있는지는 현장에서 확인해 주세요." : m.status === "running" ? "색이 있는 원은 전체 예상 시간 중 남은 비율이에요. 기기가 안내하는 예상 시간은 작동 중 달라질 수 있어요." : "이 상태는 화면 구성을 보여주기 위한 예시예요. 실제 고장이나 연결 상태를 나타내지 않아요.";
  document.getElementById("detail-content").innerHTML = `<h2 id="detail-title">${label()} ${m.id}번</h2><p class="detail-status"><span class="status-dot dot-${m.status}" aria-hidden="true"></span>${statusLabels[m.status]}</p><div class="detail-clock machine-unit" data-status="${m.status}">${clock(m)}</div><dl class="detail-facts">${facts.map(([key, val]) => `<div><dt>${key}</dt><dd>${val}</dd></div>`).join("")}</dl><p class="detail-note">${note}</p>`;
  dialog.showModal();
  document.body.style.overflow = "hidden";
});
document.getElementById("close-dialog").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
dialog.addEventListener("close", () => { document.body.style.overflow = ""; if (returnFocus?.isConnected) returnFocus.focus(); });
render();

// Live requests use an HttpOnly encrypted server session; no PAT in storage or source.
const connectionDialog = document.getElementById("connection-dialog");
const feedback = document.getElementById("connection-feedback");
const connectSubmit = document.getElementById("connect-submit");
const disconnectButton = document.getElementById("disconnect-button");
function koreanTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "확인 중" : date.toLocaleTimeString("ko-KR", {timeZone:"Asia/Seoul",hour12:false,hour:"2-digit",minute:"2-digit",second:"2-digit"});
}
function showFeedback(message, success=false) { feedback.textContent=message; feedback.classList.toggle("success",success); }
function syncConnectionUI(message) {
  const badge=document.getElementById("connection-badge");
  badge.classList.toggle("connected",connectionActive && livePhase==="connected");
  badge.classList.toggle("error",["error","expired"].includes(livePhase));
  badge.innerHTML=`<span></span>${connectionActive ? livePhase==="connected"?"연결됨":"확인 필요" : livePhase==="expired"?"토큰 만료":"미연결"}`;
  document.getElementById("open-connection").textContent=connectionActive ? "연결 관리" : "SmartThings 연결";
  disconnectButton.hidden=!connectionActive;
  toggle.hidden=connectionActive;
  if(connectionActive){
    document.getElementById("preview-copy").textContent=message || (livePhase==="connected" ? "5번 세탁기를 삼성 서버에서 10초마다 확인하고 있어요. 나머지 기기는 아직 연동 전이에요." : "최신 정보를 받지 못해 남은 시간 표시를 멈췄어요. 다시 연결되면 갱신됩니다.");
  } else if(!exampleMode) {
    document.getElementById("preview-copy").textContent=message || "실시간 연결 전이에요. SmartThings 연결에서 조회용 토큰을 입력해 주세요.";
  }
  const sync=document.getElementById("live-sync");
  sync.textContent=connectionActive ? `10초마다 확인 · 마지막 성공 ${lastChecked?koreanTime(lastChecked):"확인 중"}${lastDeviceUpdate?` · 기기 값 갱신 ${koreanTime(lastDeviceUpdate)}`:""}${document.hidden?" · 화면을 다시 열면 확인을 재개해요":""}` : "SmartThings 연결 후 실제 상태를 표시합니다. 토큰은 발급 후 24시간 동안 유효해요.";
}
async function api(path, options={}) {
  let response;
  try{response=await fetch(`/api/laundry/${path}`,{cache:"no-store",credentials:"same-origin",...options,signal:AbortSignal.timeout(18000)});}catch{throw {code:"NETWORK",message:"서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.",retryAfter:30};}
  let body;
  try{body=await response.json();}catch{throw {code:"SIGN_IN_REQUIRED",message:"로그인이 필요하거나 서버 응답이 늦어지고 있어요. 페이지를 새로고침한 뒤 다시 시도해 주세요."};}
  if(!response.ok) throw body;
  return body;
}
function applyLive(state) {
  exampleMode=false;
  toggle.setAttribute("aria-pressed","false");
  toggle.querySelector("span").textContent="상태별 예시 보기";
  connectionActive=true;
  livePhase="connected";
  machines.washer[4]={...state,id:5,live:true,recorded:false};
  lastChecked=state.checkedAt;
  lastDeviceUpdate=state.updatedAt;
  render();
  syncConnectionUI();
}
function schedulePoll(delay=10000) {clearTimeout(pollTimer);if(connectionActive && !document.hidden)pollTimer=setTimeout(pollLive,delay);}
async function pollLive() {
  if(requestRunning || !connectionActive || document.hidden)return;
  requestRunning=true;
  let delay=10000;
  try{const body=await api("status");applyLive(body.state);}
  catch(error){
    livePhase="error";
    machines.washer[4]={id:5,status:"unavailable",course:"최신 정보를 확인하지 못했어요",live:true};
    if(["TOKEN_EXPIRED","NOT_CONNECTED"].includes(error.code)){connectionActive=false;livePhase="expired";}
    if(["SIGN_IN_REQUIRED","PLAN_REQUIRED","PERMISSION"].includes(error.code)){connectionActive=false;}
    delay=Math.max(10000,Math.min(300000,(error.retryAfter||30)*1000));
    render();syncConnectionUI(error.message);showFeedback(error.message);
  }finally{requestRunning=false;schedulePoll(delay);}
}
document.getElementById("open-connection").addEventListener("click",()=>{showFeedback(connectionActive?"이 브라우저에서는 연결된 상태예요.": "");connectionDialog.showModal();});
document.getElementById("close-connection").addEventListener("click",()=>connectionDialog.close());
document.getElementById("connection-form").addEventListener("submit",async event=>{
  event.preventDefault();
  const input=document.getElementById("samsung-token");
  const token=input.value.trim();
  if(!token){showFeedback("토큰을 입력해 주세요.");return;}
  connectSubmit.disabled=true;connectSubmit.textContent="삼성에서 상태 확인 중…";showFeedback("");
  clearTimeout(pollTimer);
  try{
    const body=await api("connect",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token})});
    input.value="";applyLive(body.state);showFeedback("5번 세탁기 연결을 확인했어요. 이제 10초마다 실제 상태를 확인합니다.",true);schedulePoll();
  }catch(error){showFeedback(error.message||"연결하지 못했어요. 다시 시도해 주세요.");schedulePoll();}
  finally{input.value="";connectSubmit.disabled=false;connectSubmit.textContent="5번 세탁기 연결";}
});
disconnectButton.addEventListener("click",async()=>{
  disconnectButton.disabled=true;
  try{await api("disconnect",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});clearTimeout(pollTimer);connectionActive=false;livePhase="disconnected";lastChecked=null;lastDeviceUpdate=null;machines.washer[4]={id:5,status:"unknown"};render();syncConnectionUI();showFeedback("이 브라우저의 연결을 해제했어요. 삼성 기기 등록은 그대로 유지됩니다.",true);}
  catch(error){showFeedback(error.message||"연결 해제를 완료하지 못했어요.");}
  finally{disconnectButton.disabled=false;}
});
document.addEventListener("visibilitychange",()=>{clearTimeout(pollTimer);if(connectionActive&&!document.hidden)pollLive();syncConnectionUI();});
async function initializeConnection(){
  syncConnectionUI();
  try{const session=await api("session");if(session.connected){connectionActive=true;await pollLive();}}
  catch(error){if(error.code==="SERVER_SETUP")syncConnectionUI(error.message);}
}
initializeConnection();

})();
