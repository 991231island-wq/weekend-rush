const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = cents => cents == null ? '待确认' : `¥${(cents / 100).toFixed(0)}`;
const time = value => value ? value.slice(11, 16) : '时间待确认';
const localTime = value => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '查询时间未返回';
const kinds = { train: '城际交通', visit: '游览', transfer: '交通衔接', rest: '吃饭 / 休息', stay: '住宿参考' };
const issueLabels = { 'must-visit-missing': '有必去点未排入', 'budget-exceeded': '已知车票与预留已超过预算', 'home-deadline-missed': '预计到家晚于你的时间要求', 'event-overlap': '活动时间出现重叠', 'cost-unknown': '还有费用未知', 'cost-estimated': '部分费用使用预算预留', 'booking-unconfirmed': '住宿或预约尚未确认', 'opening-hours-unknown': '营业时间未按出行日核实', 'budget-not-fully-verifiable': '部分花费未知，预算无法完整核实', 'rail-not-on-sale': '车票尚未开售；城际时段按 3 小时估算，开售后需重查' };

const state = { authenticated: false, trip: null, displayedVersion: null, selectedVariant: null, pending: null, busy: false, toastTimer: null };

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) }, signal: AbortSignal.timeout(options.timeoutMs ?? 20000) });
  let body; try { body = await response.json(); } catch { body = {}; }
  if (!response.ok) throw new Error(body.error || `请求未完成（${response.status}）`);
  return body;
}
function toast(message) { const node = $('toast'); node.textContent = message; node.classList.add('show'); clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => node.classList.remove('show'), 2600); }
function fillIntent(intent = {}) {
  for (const id of ['originCity', 'destinationCity', 'departureDate', 'returnDate', 'earliestLeaveTime', 'latestHomeTime', 'budgetCny']) {
    if (intent[id] != null && String(intent[id]) !== '') $(id).value = String(intent[id]);
  }
}
function fields() { return Object.fromEntries(['originCity', 'destinationCity', 'departureDate', 'returnDate', 'earliestLeaveTime', 'latestHomeTime', 'budgetCny'].map(id => [id, $(id).value])); }
function requireCode(action) {
  state.pending = action;
  $('accessGate').classList.remove('hidden');
  $('gateMessage').textContent = '这是受体验码保护的真实查询。固定示例仍可直接打开。';
  $('accessGate').scrollIntoView({ behavior: 'smooth', block: 'center' });
  $('accessCode').focus();
}
function showProgress(text = '正在整理需求') { $('progress').classList.remove('hidden'); $('progressTitle').textContent = text; $('generate').disabled = true; state.busy = true; }
function hideProgress() { $('progress').classList.add('hidden'); $('generate').disabled = false; state.busy = false; }

async function submit(action) {
  if (state.busy) return;
  if (!state.authenticated) { requireCode(action); return; }
  const isNew = action.type === 'new';
  const text = isNew ? $('message').value.trim() : action.text;
  if (isNew && !text) { $('formMessage').textContent = '先简单说说想从哪出发、去哪里。'; $('message').focus(); return; }
  if (!isNew && !text && !action.eventId) return;
  $('formMessage').textContent = ''; $('gateMessage').textContent = '';
  showProgress(isNew ? '正在整理你的出行意向…' : '正在处理你的调整…');
  $('progressBody').textContent = isNew ? '正在查铁路、地点和周边信息，再校验时间与预算。' : '旧版本会保留；如果新安排查不到，当前行程不会被覆盖。';
  try {
    const payload = isNew ? { message: text, fields: fields() } : { message: text || '标记为已完成', tripId: state.trip.id, baseVersion: state.trip.currentVersion, eventId: action.eventId };
    const accepted = await api('/api/chat', { method: 'POST', body: JSON.stringify(payload) });
    await followJob(accepted.jobId);
  } catch (error) {
    hideProgress();
    if (/体验码/.test(error.message)) { state.authenticated = false; requireCode(action); }
    else { $('formMessage').textContent = error.message; toast(error.message); }
  }
}

async function followJob(jobId) {
  let done = false;
  while (!done) {
    const job = await api(`/api/jobs/${encodeURIComponent(jobId)}`);
    $('progressTitle').textContent = job.stage || '正在安排';
    if (job.status === 'complete') {
      done = true; hideProgress();
      if (job.result?.kind === 'need-input') {
        fillIntent(job.result.intent); $('formMessage').textContent = job.result.question || '请补充缺少的出行条件。'; $('message').focus();
      } else if (job.result?.trip) { state.trip = job.result.trip; state.displayedVersion = state.trip.currentVersion; state.selectedVariant = state.trip.current?.recommendedVariant || 'coverage'; $('resultSection').classList.remove('hidden'); renderTrip(); $('resultSection').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      return;
    }
    if (['failed', 'cancelled'].includes(job.status)) { done = true; hideProgress(); const message = job.error?.message || '任务未完成。'; $('formMessage').textContent = message; toast(message); return; }
    await new Promise(resolve => setTimeout(resolve, 1200));
  }
}

function versionData() { return state.trip?.versions?.find(row => row.version === Number(state.displayedVersion)) || state.trip?.current; }
function activePlanSet() { return versionData(); }
function renderTrip() {
  const plans = activePlanSet(); if (!plans) return;
  if (!state.selectedVariant || !plans.variants?.some(row => row.id === state.selectedVariant)) state.selectedVariant = plans.recommendedVariant || plans.variants?.[0]?.id;
  const plan = plans.variants?.find(row => row.id === state.selectedVariant) || plans.variants?.[0];
  $('resultTitle').textContent = plans.version === state.trip.currentVersion ? '给你安排好了。' : `行程版本 ${plans.version}`;
  $('resultMeta').textContent = `${plans.intent?.departureDate || ''} → ${plans.intent?.destinationCity || ''} · 生成于 ${localTime(plans.generatedAt)} · ${plans.engine || 'AI 意向整理 + 真实数据 + 规则校验'}`;
  $('versionSelect').innerHTML = (state.trip.versions || []).map(row => `<option value="${row.version}" ${row.version === Number(state.displayedVersion) ? 'selected' : ''}>第 ${row.version} 版${row.changeSummary?.length ? ` · ${esc(row.changeSummary[0])}` : ' · 初始方案'}</option>`).join('');
  $('changeBanner').classList.toggle('hidden', !plans.changeSummary?.length);
  $('changeBanner').textContent = plans.changeSummary?.join(' · ') || '';
  $('planSummary').innerHTML = `<p>${esc(plans.summary || '根据查询到的车次和地点，先为你排出完整参考行程。')}</p><small>按 ${esc(plans.preferences || '均衡体验')} 安排 · 人数 1 人 · 住宿只作位置参考，没有预订或实时房价</small>`;
  $('alternatives').innerHTML = (plans.variants || []).map(row => `<button class="variant-button ${row.id === state.selectedVariant ? 'selected' : ''}" data-variant="${esc(row.id)}"><strong>${esc(row.name)}</strong><small>${row.status === 'draft' ? '时序通过 · 仍有待确认信息' : row.status === 'conflict' ? '有时间或预算冲突，行程仍保留供参考' : esc(row.message)}</small></button>`).join('');
  for (const button of $('alternatives').querySelectorAll('[data-variant]')) button.addEventListener('click', () => { state.selectedVariant = button.dataset.variant; renderTrip(); });
  if (!plan?.events?.length) { $('tripMetrics').innerHTML = ''; $('validationBox').textContent = plan?.message || '尚未生成有效行程。'; $('timeline').innerHTML = ''; }
  else {
    const issues = [...(plan.validation?.errors || []), ...(plan.validation?.warnings || [])];
    const labels = [...new Set(issues.map(issue => issueLabels[issue.code] || issue.message || issue.code))];
    const budgetError = issues.some(issue => issue.code === 'budget-exceeded');
    const walking = Number.isFinite(plan.totalWalkingMeters) ? `${(plan.totalWalkingMeters / 1000).toFixed(1)} km` : '未知';
    $('tripMetrics').innerHTML = `<div class="metric"><b>${money(plan.validation?.knownCostCents)}</b><span>已知车票 + 用户预留，未知项未计全</span></div><div class="metric"><b>${esc(walking)}</b><span>路线步行估算，不含景区与接驳</span></div><div class="metric"><b>${plan.events.filter(row => row.kind === 'visit').length}</b><span>已安排游览点</span></div>`;
    $('validationBox').className = `validation-box ${!budgetError && !issues.some(row => row.code === 'home-deadline-missed') ? 'good' : ''}`;
    $('validationBox').innerHTML = `<h3>${budgetError ? '预算需要留意，完整行程仍为你排好了' : '行程校验与待确认项'}</h3>${labels.length ? `<ul>${labels.map(row => `<li>${esc(row)}</li>`).join('')}</ul>` : '<p>已通过当前时间结构校验。</p>'}<p>预计到家 ${esc(plan.arrivalHomeAt?.slice(0, 16).replace('T', ' ') || '未知')}；预算上限 ${money(plan.budgetCents)}。未知费用没有按零元计算。</p>`;
    $('timeline').innerHTML = renderTimeline(plan.events);
    for (const button of $('timeline').querySelectorAll('[data-complete]')) button.addEventListener('click', () => submit({ type: 'adjust', eventId: button.dataset.complete }));
  }
  $('scheduleStatus').textContent = plan?.status === 'draft' ? '参考安排 · 出发前请确认' : '存在冲突 · 仍保留完整参考计划';
  renderEvidence(plans, plan);
  $('clearSession').classList.toggle('hidden', !state.authenticated);
}

function renderTimeline(events) {
  let date = '';
  return events.map(event => {
    const eventDate = event.startAt?.slice(0, 10) || '日期待确认';
    const heading = date !== eventDate ? `<div class="day-heading">${esc(eventDate)} · ${eventDate === events[0]?.startAt?.slice(0, 10) ? '出发日' : '返程日'}</div>` : '';
    date = eventDate;
    const cost = event.costStatus === 'unknown' || event.costCents == null ? '费用待确认' : event.costStatus === 'estimate' ? `${money(event.costCents)} 预算预留` : event.costCents ? money(event.costCents) : '无单列费用';
    const details = event.placeDetails ? `<div class="event-place"><strong>${esc(event.placeDetails.name)}</strong><p>${esc(event.placeDetails.address || '地址未返回')}${event.placeDetails.businessArea ? ` · ${esc(event.placeDetails.businessArea)}` : ''}</p>${event.placeDetails.referenceConsumption ? `<p>地图参考消费：${esc(event.placeDetails.referenceConsumption)}（非成交价）</p>` : ''}${event.placeDetails.openingText ? `<p>地图营业文本：${esc(event.placeDetails.openingText)}（未按出行日核实）</p>` : ''}</div>` : '';
    const route = event.routeDetails?.segments?.length ? `<p>交通：${esc(event.mode === 'walking' ? '步行' : '公交 / 地铁')}${event.walkingMeters ? ` · 路线步行约 ${esc(event.walkingMeters)} 米` : ''}${event.routeDetails.segments.map(segment => segment.buslines?.length ? ` · ${segment.buslines.map(line => line.name || '线路未知').join(' / ')}` : '').join('')}</p>` : '';
    const reason = event.reason ? `<p>这样安排：${esc(event.reason)}</p>` : '';
    const source = event.evidenceId ? `<p class="event-meta">依据 ${esc(event.evidenceId)} · ${esc(event.source || '来源')} · ${esc(localTime(event.queriedAt))}</p>` : `<p class="event-meta">${esc(event.source || '规则估算')}${event.queriedAt ? ` · ${esc(localTime(event.queriedAt))}` : ''}</p>`;
    const note = event.note ? `<p>${esc(event.note)}</p>` : '';
    const complete = event.kind === 'visit' ? `<button class="complete-button ${event.completed ? 'done' : ''}" data-complete="${esc(event.id)}">${event.completed ? '已完成 ✓' : '已逛完'}</button>` : '';
    return `${heading}<article class="event-card"><div class="event-time">${esc(time(event.startAt))}<span>至 ${esc(event.endAt?.slice(0, 10) !== eventDate ? `${event.endAt?.slice(5, 10)} ` : '' )}${esc(time(event.endAt))}</span></div><div class="event-main"><div class="event-topline"><span class="event-kind">${esc(kinds[event.kind] || '行程')}</span>${complete}</div><h4>${esc(event.title)}</h4><span class="event-cost">${esc(cost)}</span>${reason}${route}${details}${note}${source}</div></article>`;
  }).join('');
}

function renderEvidence(plans, plan) {
  const sourceRows = plans.evidence || [];
  const assumptions = plans.assumptions || [];
  const weather = plans.weather;
  const weatherBlock = weather ? `<h4>天气</h4><ul>${(weather.forecasts || []).map(row => `<li>${esc(row.date)}：${esc(row.dayweather)} / ${esc(row.nightweather)}，${esc(row.nighttemp)}–${esc(row.daytemp)}℃ · ${esc(weather.source)} · ${esc(localTime(weather.queriedAt))}</li>`).join('')}</ul>` : '<p>未取得匹配出行日期的天气预报。</p>';
  $('evidenceContent').innerHTML = `<h4>行程引用的查询依据</h4><ul>${sourceRows.length ? sourceRows.map(row => `<li>${esc(row.id)} · ${esc(row.label || row.source)} · ${esc(row.source)} · ${esc(localTime(row.queriedAt))}${row.tool ? ` · ${esc(row.tool)}` : ''}</li>`).join('') : '<li>本版没有可显示的查询来源。</li>'}</ul><h4>天气与费用边界</h4>${weatherBlock}<ul><li>餐饮和住宿预算来自用户预留，不是商户实时报价。</li><li>地点评分、参考消费、营业文本是地图返回字段，不代表当日营业或预约成功。</li><li>高德周边范围是直线半径；路线时间是常规估算。</li></ul><h4>出发前待办</h4><ul>${assumptions.map(row => `<li>${esc(row)}</li>`).join('')}</ul>`;
}

function renderAfterSession(session) {
  state.authenticated = session.authenticated === true;
  $('clearSession').classList.toggle('hidden', !state.authenticated);
  if (!state.authenticated) return;
  $('accessGate').classList.add('hidden');
  if (session.activeTripId) void loadTrip(session.activeTripId);
}
async function loadTrip(id) {
  try { state.trip = await api(`/api/trips/${encodeURIComponent(id)}`); state.displayedVersion = state.trip.currentVersion; state.selectedVariant = state.trip.current?.recommendedVariant || 'coverage'; $('resultSection').classList.remove('hidden'); renderTrip(); }
  catch { state.trip = null; }
}

async function exportTrip() {
  const content = $('resultSection').cloneNode(true);
  content.querySelector('.adjust-card')?.remove(); content.querySelector('.result-actions')?.remove(); content.querySelectorAll('button').forEach(button => button.remove());
  const style = await fetch('/ai.css').then(response => response.text());
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>我的周末行程</title><style>${style}</style></head><body><main>${content.innerHTML}</main><footer>行程查询快照 · 出发前请复核车票、开放时间、房价与预约。</footer></body></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `周末快闪行程-v${state.displayedVersion}.html`; link.click(); URL.revokeObjectURL(url); toast('行程卡已导出到本机。');
}

$('message').addEventListener('input', () => { $('charCount').textContent = `${$('message').value.length} / 1600`; });
$('departureDate').addEventListener('change', () => { if ($('departureDate').value) { const date = new Date(`${$('departureDate').value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + 1); const next = date.toISOString().slice(0, 10); if (!$('returnDate').value || $('returnDate').value <= $('departureDate').value) $('returnDate').value = next; $('returnDate').min = next; } });
$('generate').addEventListener('click', () => submit({ type: 'new' }));
$('accessForm').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.currentTarget.querySelector('button'); button.disabled = true; $('gateMessage').textContent = '正在验证…';
  try { const session = await api('/api/session', { method: 'POST', body: JSON.stringify({ accessCode: $('accessCode').value }) }); $('accessCode').value = ''; $('accessGate').classList.add('hidden'); $('gateMessage').textContent = ''; state.authenticated = session.authenticated; $('clearSession').classList.remove('hidden'); const action = state.pending; state.pending = null; if (action) await submit(action); }
  catch (error) { $('gateMessage').textContent = error.message; }
  finally { button.disabled = false; }
});
for (const button of document.querySelectorAll('[data-adjust]')) button.addEventListener('click', () => submit({ type: 'adjust', text: button.dataset.adjust }));
$('adjustForm').addEventListener('submit', event => { event.preventDefault(); const text = $('adjustMessage').value.trim(); if (!text) return; $('adjustMessage').value = ''; void submit({ type: 'adjust', text }); });
$('versionSelect').addEventListener('change', () => { state.displayedVersion = Number($('versionSelect').value); state.selectedVariant = null; renderTrip(); });
$('exportTrip').addEventListener('click', () => { void exportTrip().catch(error => toast(`导出失败：${error.message}`)); });
$('clearSession').addEventListener('click', async () => { try { await api('/api/session', { method: 'DELETE' }); state.authenticated = false; state.trip = null; state.displayedVersion = null; state.selectedVariant = null; $('resultSection').classList.add('hidden'); $('accessGate').classList.add('hidden'); $('clearSession').classList.add('hidden'); $('message').value = ''; $('charCount').textContent = '0 / 1600'; for (const id of ['originCity', 'destinationCity', 'departureDate', 'returnDate']) $(id).value = ''; $('earliestLeaveTime').value = '06:00'; $('latestHomeTime').value = '22:00'; $('budgetCny').value = '1000'; toast('本机会话与当前行程已清除。'); } catch (error) { toast(error.message); } });
(async function init() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  $('departureDate').min = today; $('returnDate').min = today;
  try { renderAfterSession(await api('/api/session')); }
  catch (error) { $('formMessage').textContent = `服务连接失败：${error.message}`; }
})();
