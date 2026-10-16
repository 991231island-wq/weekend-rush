const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const money = cents => cents == null ? '待确认' : `¥${(cents / 100).toFixed(2)}`;
const clock = value => value?.slice(11, 16) ?? '';
const localTime = value => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '时间未知';
const evidence = value => `${escape(value.source)} · 查询于 ${escape(localTime(value.queriedAt))}${value.cacheHit ? ' · 缓存结果' : ''}`;
function poiExtra(row) {
  if (!row) return '';
  const values = [row.businessArea && `商圈：${row.businessArea}`, row.alias && `别名：${row.alias}`, row.rating && `地图评分：${row.rating}`, row.referenceConsumption && `参考消费（不是已确认餐费）：${row.referenceConsumption}`, row.openingText && `营业文本（未按出行日核实）：${row.openingText}`].filter(Boolean);
  const photos = (row.photos ?? []).map(photo => {
    try { const url = new URL(photo.url); return url.protocol === 'https:' && !url.username && !url.password && !/[?&](?:key|token|secret|api[-_]?key)=/i.test(url.href) ? `<a href="${escape(url.href)}" target="_blank" rel="noreferrer noopener">${escape(photo.title || '查看地点图片')}</a>` : ''; } catch { return ''; }
  }).filter(Boolean);
  return values.length || photos.length ? `${values.map(escape).join('<br>')}${photos.length ? `${values.length ? '<br>' : ''}图片：${photos.join(' · ')}` : ''}` : '';
}
function routeMarkup(route) {
  const details = route?.routeDetails;
  if (!details?.segments?.length) return '<p>仅有路线汇总，未返回逐段指引。</p>';
  const chain = details.segments.map(segment => segment.buslines?.length ? segment.buslines.map(line => line.name || '线路未返回').join(' / ') : segment.railway?.name || (segment.kind === 'walking' || segment.walking ? '步行' : '线路未返回'));
  const rows = details.segments.map((segment, index) => {
    const lines = segment.buslines?.length ? `<p>同段备选线路（择一，不是连续换乘）：</p><ul>${segment.buslines.map(line => {
      const via = line.viaStops?.length ? ` · 途经：${line.viaStops.map(escape).join('、')}` : '';
      const metrics = [Number.isFinite(line.durationMinutes) ? `约 ${line.durationMinutes} 分钟` : '', Number.isFinite(line.distanceMeters) ? `${line.distanceMeters} 米` : ''].filter(Boolean).join(' · ');
      return `<li>${escape(line.name || '线路未返回')} · ${escape(line.departureStop || '上车站未返回')} → ${escape(line.arrivalStop || '下车站未返回')}${via}${metrics ? ` · ${escape(metrics)}` : ''}</li>`;
    }).join('')}</ul>` : segment.kind === 'transit' ? '<p>线路与上下车站未返回。</p>' : '';
    const walking = segment.kind === 'walking' ? segment : segment.walking;
    const walk = walking ? `<p>步行约 ${escape(walking.distanceMeters ?? '未知')} 米，${escape(walking.durationMinutes ?? '未知')} 分钟</p>${walking.steps?.length ? `<ol>${walking.steps.map(step => {
      const details = [step.road && `道路：${step.road}`, step.orientation && `方向：${step.orientation}`, step.action && `动作：${step.action}`, step.assistantAction && `指引：${step.assistantAction}`, Number.isFinite(step.distanceMeters) && `${step.distanceMeters} 米`, Number.isFinite(step.durationMinutes) && `${step.durationMinutes} 分钟`].filter(Boolean).map(escape);
      return `<li>${escape(step.instruction || '步行指引未返回')}${details.length ? ` · ${details.join(' · ')}` : ''}</li>`;
    }).join('')}</ol>` : '<p>详细步行步骤未返回。</p>'}` : '';
    const gates = segment.kind === 'transit' || segment.entrance || segment.exit ? `<p>进站口：${escape(segment.entrance || '未返回')} · 出站口：${escape(segment.exit || '未返回')}</p>` : '';
    return `<li><b>第 ${index + 1} 段</b>${walk}${lines}${gates}</li>`;
  });
  return `<p>乘车链路：${escape(chain.join(' → '))}</p><details><summary>展开逐段指引</summary><ol>${rows.join('')}</ol></details>`;
}
let revision = 0;
let tickets = { outbound: [], return: [] };
let station = null; let lodging = null; let places = [];
let history = []; let historyIndex = 0; let selectedPlan = 0;

async function api(path, data) {
  const response = await fetch(`/api/${path}`, { method: data === undefined ? 'GET' : 'POST', headers: data === undefined ? {} : { 'content-type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(240000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '查询未成功，请稍后重试。');
  return result;
}
async function busy(button, status, task) {
  if ($(button).disabled) return;
  $(button).disabled = true;
  try { await task(); } catch (error) { $(status).textContent = error.name === 'TimeoutError' ? '查询超时，请稍后重试。' : error.message; }
  finally { $(button).disabled = false; }
}
function changed() {
  revision++;
  if (history.length) { $('planStatus').className = 'notice'; $('planStatus').textContent = '条件已修改。下方保留的是上一轮结果，请重新生成后再采用。'; }
}
function resetTickets() {
  tickets = { outbound: [], return: [] };
  for (const id of ['outboundTicket', 'returnTicket']) $(id).innerHTML = '<option value="">请重新查询车次</option>';
  $('railDetails').innerHTML = ''; $('weather').innerHTML = ''; changed();
}
for (const id of ['originCity', 'destinationCity']) $(id).addEventListener('input', () => {
  for (const target of ['fromStation', 'toStation']) $(target).innerHTML = '<option value="">请重新读取车站</option>';
  if (id === 'destinationCity') { station = null; lodging = null; places = []; $('placeCandidates').innerHTML = ''; renderPlaces(); }
  resetTickets();
});
for (const id of ['departureDate', 'returnDate', 'fromStation', 'toStation']) $(id).addEventListener('input', () => { if (id === 'toStation') { station = null; renderPlaces(); } resetTickets(); });
for (const id of ['earliestLeaveTime', 'latestHomeTime', 'homeTransferMinutes', 'budgetCny', 'foodDailyCny', 'hotelCny', 'transitDailyCny', 'outboundTicket', 'returnTicket']) $(id).addEventListener('input', changed);

$('loadStations').addEventListener('click', () => busy('loadStations', 'stationStatus', async () => {
  const version = revision;
  $('stationStatus').textContent = '正在读取 12306 城市车站…';
  const rows = await Promise.all([api('stations', { city: $('originCity').value }), api('stations', { city: $('destinationCity').value })]);
  if (version !== revision) return;
  for (const [index, id, preferred] of [[0, 'fromStation', '杭州东'], [1, 'toStation', '上海虹桥']]) {
    $(id).innerHTML = '<option value="">请选择车站</option>' + rows[index].stations.map(row => `<option value="${escape(row.code)}">${escape(row.name)} (${escape(row.code)})</option>`).join('');
    const match = rows[index].stations.find(row => row.name === preferred);
    if (match) $(id).value = match.code;
  }
  resetTickets(); $('stationStatus').textContent = `已读取真实车站 · ${localTime(rows[0].queriedAt)}`;
}));
function railQuery(reverse = false) {
  return { date: $(reverse ? 'returnDate' : 'departureDate').value, fromCity: $(reverse ? 'destinationCity' : 'originCity').value, toCity: $(reverse ? 'originCity' : 'destinationCity').value, fromStationCode: $(reverse ? 'toStation' : 'fromStation').value, toStationCode: $(reverse ? 'fromStation' : 'toStation').value };
}
function railRows(result, key) {
  tickets[key] = [];
  const options = [];
  for (const ticket of result.tickets) for (const seat of ticket.seats) {
    if (seat.status !== 'available' || seat.priceCny == null) continue;
    const index = tickets[key].push({ ticket, seat }) - 1;
    options.push(`<option value="${index}">${escape(ticket.trainCode)} ${clock(ticket.departureAt)}→${ticket.arrivalAt.slice(0, 10)} ${clock(ticket.arrivalAt)} · ${escape(seat.name)} ¥${escape(seat.priceCny)}</option>`);
  }
  $(key === 'outbound' ? 'outboundTicket' : 'returnTicket').innerHTML = '<option value="">请选择查询时有票的席别</option>' + options.join('');
  const labels = { available: '有票', waitlist: '候补', 'sold-out': '无票', unknown: '未知' };
  return `<details class="rail-evidence"><summary>${key === 'outbound' ? '去程' : '返程'} ${escape(result.from.name)} → ${escape(result.to.name)} · ${result.tickets.length} 趟精确匹配 · 排除 ${result.rejectedCount} 条异常记录</summary><p class="muted">${evidence(result)}。仅展示前 60 条明细；选择框包含全部可选席别。未购买车票。</p><div class="rail-table"><table><thead><tr><th>车次</th><th>出发</th><th>到达</th><th>席别、票价与余票</th></tr></thead><tbody>${result.tickets.slice(0, 60).map(row => `<tr><td>${escape(row.trainCode)}</td><td>${escape(row.departureAt.slice(0, 16).replace('T', ' '))}</td><td>${escape(row.arrivalAt.slice(0, 16).replace('T', ' '))}</td><td>${row.seats.map(seat => `${escape(seat.name)}：${escape(labels[seat.status] ?? seat.status)} / ${seat.priceCny == null ? '价格未知' : `¥${escape(seat.priceCny)}`}`).join('<br>')}</td></tr>`).join('')}</tbody></table></div></details>`;
}
$('queryTrains').addEventListener('click', () => busy('queryTrains', 'railStatus', async () => {
  resetTickets(); const version = revision;
  $('railStatus').textContent = '正在查询往返车次…';
  const [outbound, inbound, weather] = await Promise.allSettled([api('tickets', railQuery()), api('tickets', railQuery(true)), api('weather', { city: $('destinationCity').value })]);
  if (version !== revision) return;
  const parts = [];
  for (const [result, key] of [[outbound, 'outbound'], [inbound, 'return']]) parts.push(result.status === 'fulfilled' ? railRows(result.value, key) : `<p class="notice error">${key === 'outbound' ? '去程' : '返程'}：${escape(result.reason.message)}</p>`);
  $('railDetails').innerHTML = parts.join('');
  $('railStatus').textContent = outbound.status === 'fulfilled' && inbound.status === 'fulfilled' ? '查询完成，请选择具体车次和席别。' : '部分查询失败，请查看下方原因。';
  if (weather.status === 'fulfilled') {
    const data = weather.value;
    const dates = [$('departureDate').value, $('returnDate').value];
    const forecastByDate = new Map(data.forecasts.map(row => [row.date, row]));
    $('weather').innerHTML = dates.map(date => { const row = forecastByDate.get(date); return row ? `<div class="weather-day"><strong>${escape(row.date)}</strong><span>${escape(row.dayweather)} / ${escape(row.nightweather)} · ${escape(row.nighttemp)}–${escape(row.daytemp)}℃</span><span>白天 ${escape(row.daywind)} ${escape(row.daypower)}级 · 夜间 ${escape(row.nightwind)} ${escape(row.nightpower)}级</span></div>` : `<div class="weather-day"><strong>${escape(date)}</strong><span>超出当前预报日期，天气未知。</span></div>`; }).join('') + `<p class="weather-meta">${evidence(data)} · 仅显示与实际出行日期对应的预报。</p>`;
  } else $('weather').textContent = `天气未取得：${weather.reason.message}`;
}));

$('placeRole').addEventListener('change', () => {
  $('placeCandidates').innerHTML = ''; $('placeStatus').textContent = '用途已更改，请重新搜索对应地点。';
  if ($('placeRole').value === 'station') $('placeKeywords').value = $('toStation').selectedOptions[0]?.textContent.split(' (')[0] || '';
});
$('searchPlaces').addEventListener('click', () => busy('searchPlaces', 'placeStatus', async () => {
  const version = revision; const role = $('placeRole').value; const city = $('destinationCity').value;
  $('placeStatus').textContent = '正在搜索高德地点…'; $('placeCandidates').innerHTML = '';
  const result = await api('places', { city, keywords: $('placeKeywords').value });
  if (version !== revision) return;
  $('placeStatus').textContent = `${result.candidates.length} 个候选 · ${localTime(result.queriedAt)} · 请核对地址与类型后选择。`;
  $('placeCandidates').innerHTML = result.candidates.map((row, index) => `<article class="candidate"><div><strong>${escape(row.name)}</strong><p>${escape(row.address)}<br>POI ${escape(row.id)} · 类型 ${escape(row.typecode)}</p></div><button class="secondary" data-pick="${index}">选择并查详情</button></article>`).join('');
  for (const button of $('placeCandidates').querySelectorAll('[data-pick]')) button.addEventListener('click', async () => {
    if (button.disabled) return; button.disabled = true;
    try {
      const detail = await api('place', { city, id: result.candidates[Number(button.dataset.pick)].id });
      if (city !== $('destinationCity').value) return;
      if (role === 'station') station = detail;
      else if (role === 'lodging') lodging = detail;
      else if (!places.some(row => row.id === detail.id)) {
        if (places.length >= 6) throw new Error('本版最多选择 6 个景点。');
        places.push({ ...detail, required: places.length === 0, durationMinutes: 90, admissionCny: '' });
      }
      changed(); renderPlaces(); $('placeStatus').textContent = `已确认：${detail.name} · ${detail.city} · ${detail.type} · ${detail.location} · ${localTime(detail.queriedAt)}`;
    } catch (error) { $('placeStatus').textContent = error.message; }
    finally { button.disabled = false; }
  });
}));
function renderPlaces() {
  $('stationAnchor').innerHTML = station ? `${escape(station.name)} · ${escape(station.address)}${poiExtra(station)}` : '尚未选择';
  $('lodgingAnchor').innerHTML = lodging ? `${escape(lodging.name)} · ${escape(lodging.address)}${poiExtra(lodging)}` : '尚未选择';
  const anchor = $('aroundAnchor'); const previous = anchor.value;
  const anchors = [station, lodging, ...places].filter(Boolean);
  anchor.innerHTML = anchors.length ? anchors.map(row => `<option value="${escape(row.id)}">${escape(row.name)}</option>`).join('') : '<option value="">请先确认地点</option>';
  if (anchors.some(row => row.id === previous)) anchor.value = previous;
  $('selectedPlaces').innerHTML = places.length ? places.map((row, index) => `<article class="picked-place"><div class="picked-top"><div><strong>${escape(row.name)}</strong><p>${escape(row.address)} · ${escape(row.id)}<br>${evidence(row)}</p></div><button class="remove-place" data-remove="${index}">移除</button></div><div class="picked-fields"><label><input type="checkbox" data-place="${index}" data-field="required" ${row.required ? 'checked' : ''}>必去</label><label>游览分钟<input type="number" min="15" max="240" value="${escape(row.durationMinutes)}" data-place="${index}" data-field="durationMinutes"></label><label>门票预留（元）<input type="number" min="0" placeholder="未知" value="${escape(row.admissionCny)}" data-place="${index}" data-field="admissionCny"></label></div></article>`).join('') : '<p class="empty">请添加 1–6 个具体景点。门票留空会标为待确认。</p>';
  for (const [index, article] of $('selectedPlaces').querySelectorAll('.picked-place').entries()) article.querySelector('.picked-top > div').insertAdjacentHTML('beforeend', poiExtra(places[index]));
  for (const input of $('selectedPlaces').querySelectorAll('[data-field]')) input.addEventListener('input', () => { places[Number(input.dataset.place)][input.dataset.field] = input.dataset.field === 'required' ? input.checked : input.value; changed(); });
  for (const button of $('selectedPlaces').querySelectorAll('[data-remove]')) button.addEventListener('click', () => { places.splice(Number(button.dataset.remove), 1); changed(); renderPlaces(); });
}
$('searchAround').addEventListener('click', () => busy('searchAround', 'aroundStatus', async () => {
  const city = $('destinationCity').value; const anchorId = $('aroundAnchor').value;
  if (!anchorId) throw new Error('请先确认一个景点、车站或住宿参考点。');
  const version = revision; $('aroundStatus').textContent = '正在查询周边并逐一核对地点详情…'; $('aroundCandidates').innerHTML = ''; $('aroundRoute').innerHTML = '';
  const result = await api('around', { city, anchorId, keywords: $('aroundKeywords').value, radius: Number($('aroundRadius').value) });
  if (version !== revision) return;
  $('aroundStatus').textContent = `${result.candidates.length} 个候选 · 已核对 ${result.checkedCount} 个详情 · 排除 ${result.rejectedCount} 个城市/范围不符或资料不完整的点 · ${localTime(result.queriedAt)}。${result.notice}`;
  $('aroundCandidates').innerHTML = result.candidates.length ? result.candidates.map((row, index) => `<article class="candidate"><div><strong>${escape(row.name)}</strong><p>${escape(row.address)}<br>距中心直线约 ${escape(row.distanceMeters)} 米</p>${poiExtra(row)}<p>${evidence(row)}</p></div><button class="secondary" data-around-route="${index}">查实际路线</button></article>`).join('') : '<p class="empty">在本次核对范围内没有合适结果；可以换关键词或扩大范围。</p>';
  for (const button of $('aroundCandidates').querySelectorAll('[data-around-route]')) button.addEventListener('click', async () => {
    if (button.disabled) return; button.disabled = true; $('aroundRoute').textContent = '正在核对公交/步行路线…';
    try {
      const row = result.candidates[Number(button.dataset.aroundRoute)];
      const route = await api('route', { city, originId: anchorId, destinationId: row.id, pace: 'gentle' });
      $('aroundRoute').innerHTML = `<article class="route-result"><h3>${escape(result.anchor.name)} → ${escape(row.name)}</h3><p>${escape(route.mode === 'walking' ? '步行' : '公交/地铁')} · ${escape(route.durationMinutes)} 分钟 · 路线步行 ${escape(route.walkingMeters)} 米 · ${escape(route.distanceMeters == null && route.mode === 'transit' ? '全程距离未可靠返回' : `${route.distanceMeters} 米`)}</p>${routeMarkup(route)}<p class="muted">${evidence(route)}。出行日班次、拥堵与进出站细节可能变化。</p></article>`;
    } catch (error) { $('aroundRoute').textContent = `路线未取得：${error.message}`; }
    finally { button.disabled = false; }
  });
}));

$('generatePlan').addEventListener('click', () => busy('generatePlan', 'planStatus', async () => {
  $('planStatus').className = 'notice';
  const out = tickets.outbound[$('outboundTicket').value]; const back = tickets.return[$('returnTicket').value];
  if (!out || !back || !station || !lodging || !places.length) throw new Error('请先选择往返有票席别、目的地火车站地图点、住宿参考点及至少一个景点。');
  const input = Object.fromEntries(['originCity', 'destinationCity', 'departureDate', 'returnDate', 'earliestLeaveTime', 'latestHomeTime', 'homeTransferMinutes', 'budgetCny', 'foodDailyCny', 'hotelCny', 'transitDailyCny'].map(id => [id, $(id).value]));
  Object.assign(input, { fromStationCode: $('fromStation').value, toStationCode: $('toStation').value, outboundTicketId: out.ticket.id, returnTicketId: back.ticket.id, outboundSeat: out.seat.name, returnSeat: back.seat.name, stationPoiId: station.id, overnightPoiId: lodging.id, places: places.map(({ id, required, durationMinutes, admissionCny }) => ({ id, required, durationMinutes, admissionCny })) });
  const version = revision; $('planStatus').textContent = '正在复核车次、地点并逐段查询真实路线，通常需要数十秒…';
  const result = await api('plan', input);
  if (version !== revision) { $('planStatus').textContent = '查询期间条件已变化，结果未采用。请按新条件重新生成。'; return; }
  history.unshift(result); history = history.slice(0, 3); historyIndex = 0; selectedPlan = 0; renderResult();
  $('planStatus').textContent = '查询完成。请先查看冲突与待核实信息，车票仍未购买。'; $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}));
$('previousResult').addEventListener('click', () => { historyIndex = (historyIndex + 1) % history.length; selectedPlan = 0; renderResult(); });
const issueLabels = { 'must-visit-missing': '必去点未排入', 'budget-exceeded': '已知票价和预留已超过预算', 'home-deadline-missed': '预计到家晚于最晚时间', 'event-overlap': '活动时间重叠', 'cost-unknown': '费用未知', 'cost-estimated': '费用采用预留估算', 'booking-unconfirmed': '预约或预订未确认', 'opening-hours-unknown': '营业时间未确认', 'budget-not-fully-verifiable': '费用未计全，预算无法完整核实' };
function renderResult() {
  const result = history[historyIndex]; $('results').classList.remove('hidden');
  $('generationMeta').textContent = `${historyIndex ? '历史结果' : '最近一轮'} · ${localTime(result.generatedAt)} · ${result.engine}`;
  $('previousResult').classList.toggle('hidden', history.length < 2); $('previousResult').textContent = historyIndex ? '切换其他轮次' : '查看上一轮结果';
  $('planCards').innerHTML = result.variants.map((plan, index) => `<button class="plan-card ${index === selectedPlan ? 'selected' : ''}" data-plan="${index}" aria-pressed="${index === selectedPlan}"><h3>${escape(plan.name)}</h3><span class="plan-status ${plan.status !== 'draft' ? 'conflict' : ''}">${plan.status === 'draft' ? '时间结构通过 · 仍有待核实项' : plan.status === 'conflict' ? '存在硬约束冲突' : '无法生成'}</span>${plan.events ? `<div class="metrics"><div><strong>${money(plan.validation.knownCostCents)}</strong><small>已知票价＋用户预留</small></div><div><strong>${(plan.totalWalkingMeters / 1000).toFixed(1)} km</strong><small>路线步行（未计全）</small></div><div><strong>${plan.events.filter(event => event.kind === 'visit').length}</strong><small>游览地点</small></div></div><p>${escape(plan.costNotice)}</p>` : `<p>${escape(plan.message)}</p>`}</button>`).join('');
  for (const button of $('planCards').querySelectorAll('[data-plan]')) button.addEventListener('click', () => { selectedPlan = Number(button.dataset.plan); renderResult(); });
  const plan = result.variants[selectedPlan];
  $('validation').className = `validation ${plan.status !== 'draft' ? 'conflict' : ''}`;
  if (!plan.events) { $('validation').textContent = plan.message; $('timeline').innerHTML = ''; $('omitted').innerHTML = ''; }
  else {
    const counts = new Map();
    for (const issue of [...plan.validation.errors, ...plan.validation.warnings]) counts.set(issue.code, (counts.get(issue.code) || 0) + 1);
    $('validation').innerHTML = `<h3>${plan.status === 'conflict' ? '请先解决硬约束冲突' : '草案仍需确认以下事项'}</h3><ul>${[...counts].map(([code, count]) => `<li>${escape(issueLabels[code] || code)}${count > 1 ? `（${count} 项）` : ''}</li>`).join('')}</ul><p>预计到家 ${escape(plan.arrivalHomeAt.slice(0, 16).replace('T', ' '))}。该时间包含用户估算的住处接驳。</p>`;
    $('omitted').innerHTML = plan.omitted.length ? `<div class="omitted">${plan.omitted.map(row => `${escape(row.name)}：${escape(row.reason)}`).join('<br>')}</div>` : '';
    let date = '';
    $('timeline').innerHTML = plan.events.map(event => {
      const next = event.startAt.slice(0, 10); const heading = date !== next ? `<h3 class="day-title">${escape(next)}</h3>` : ''; date = next;
      return `${heading}<article class="event ${escape(event.kind)}"><div class="event-time"><span>${clock(event.startAt)}</span><span>${event.endAt.slice(0, 10) !== next ? `${escape(event.endAt.slice(5, 10))} ` : ''}${clock(event.endAt)}</span></div><div class="event-main"><span class="price">${event.costStatus === 'unknown' ? '费用待确认' : event.costCents ? `${money(event.costCents)}${event.costStatus === 'estimate' ? '（预留）' : ''}` : event.costStatus === 'estimate' ? '计入当天预留' : '无单列费用'}</span><h3>${escape(event.title)}</h3>${event.placeDetails?.address ? `<p>${escape(event.placeDetails.address)}</p>${poiExtra(event.placeDetails)}` : ''}${event.mode ? routeMarkup({routeDetails:event.routeDetails}) : ''}${event.note ? `<p>${escape(event.note)}</p>` : ''}${event.walkingMeters ? `<p>路线步行约 ${event.walkingMeters} 米</p>` : ''}<div class="source">${event.queriedAt ? evidence(event) : escape(event.source || '规则规划')}</div></div></article>`;
    }).join('');
  }
  $('dataNotices').innerHTML = result.notices.map(note => `<p>${escape(note)}</p>`).join('');
}
async function init() {
  try {
    const status = await api('status'); $('connectionStatus').textContent = status.mapKeyConfigured ? '本机 Key 已配置 · 查询时验证连接' : '缺少本机高德 Key';
    const addDays = (date, count) => new Date(Date.parse(`${date}T12:00:00Z`) + count * 86400000).toISOString().slice(0, 10);
    const weekday = new Date(`${status.today}T12:00:00Z`).getUTCDay(); const offset = (6 - weekday + 7) % 7 || 7;
    $('departureDate').value = addDays(status.today, offset); $('returnDate').value = addDays(status.today, offset + 1);
    for (const id of ['departureDate', 'returnDate']) { $(id).min = status.today; $(id).max = addDays(status.today, 14); }
  } catch (error) { $('connectionStatus').textContent = `本机服务未连接：${error.message}`; }
}
init();
