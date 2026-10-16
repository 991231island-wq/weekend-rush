import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validatePlan } from './trip-utils.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const money = value => value == null ? '未知' : `¥${(value / 100).toFixed(2)}`;
const time = value => String(value ?? '').slice(0, 16).replace('T', ' ');
const queryTime = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', {timeZone:'Asia/Shanghai',hour12:false}) : String(value ?? '时间未知');
const list = values => `<ul>${(values ?? []).map(value => `<li>${esc(value)}</li>`).join('')}</ul>`;
const labels = {'event-overlap':'活动时间重叠','must-visit-missing':'必去点未排入','budget-exceeded':'已知费用与预留已超预算','home-deadline-missed':'到家时间超过上限','cost-unknown':'存在未知费用','cost-estimated':'存在估算费用','booking-unconfirmed':'预约或预订未确认','opening-hours-unknown':'营业时间未确认','budget-not-fully-verifiable':'费用未计全，预算无法完整验证','home-arrival-unknown':'到家时间未知'};
const safeLink = value => {
  try { const url = new URL(value); const hasCredential = [...url.searchParams.keys()].some(key => /^(?:key|token|secret|api[-_]?key)$/i.test(key)); return url.protocol === 'https:' && !url.username && !url.password && !hasCredential ? url.href : null; } catch { return null; }
};
function placeMarkup(place) {
  if (!place) return '';
  const fields = [place.businessArea && `商圈：${place.businessArea}`, place.alias && `别名：${place.alias}`, place.rating && `地图评分：${place.rating}`, place.referenceConsumption && `参考消费（非已确认价格）：${place.referenceConsumption}`, place.openingText && `地点营业文本（未按出行日期核实）：${place.openingText}`].filter(Boolean);
  const photos = (Array.isArray(place.photos) ? place.photos : []).map(photo => {
    const url = safeLink(photo?.url);
    return url ? `<a href="${esc(url)}" target="_blank" rel="noreferrer noopener">${esc(photo.title || '查看地点图片')}</a>` : '';
  }).filter(Boolean);
  return fields.length || photos.length ? `<div class="poi-info">${fields.map(field => `<p>${esc(field)}</p>`).join('')}${photos.length ? `<p>图片：${photos.join(' · ')}</p>` : ''}</div>` : '';
}
function informationMarkup(lookups) {
  if (!Array.isArray(lookups) || !lookups.length) return '';
  const rows = lookups.flatMap(lookup => Array.isArray(lookup?.items) ? lookup.items.map(item => {
    const link = safeLink(item.sourceUrl);
    const value = item.amountCents == null ? item.text ?? '内容未返回' : `${money(item.amountCents)}${item.text ? ` · ${item.text}` : ''}`;
    return `<li>${esc(item.label ?? '补充信息')}：${esc(value)}${item.variant ? ` · ${esc(item.variant)}` : ''}${item.conditions ? ` · ${esc(item.conditions)}` : ''} · ${esc(item.source ?? '来源未知')} · 适用 ${esc(item.validForDate ?? '日期未知')} · 查询于 ${esc(queryTime(item.queriedAt))}${link ? ` · <a href="${esc(link)}" target="_blank" rel="noreferrer noopener">查看来源</a>` : ''}</li>`;
  }) : []);
  return rows.length ? `<div class="poi-info"><b>补充来源记录</b><ul>${rows.join('')}</ul><p>报价、营业和预约状态须按具体日期与选项复核；来源记录不会自动计入预算或视为已预订。</p></div>` : '';
}
const durationText = value => Number.isFinite(value) ? `${value} 分钟` : '时长未返回';
const distanceText = value => Number.isFinite(value) ? `${value} 米` : '距离未返回';
function routeMarkup(route) {
  if (!route || !Array.isArray(route.segments) || !route.segments.length) return '<p class="route-legacy">仅有路线汇总</p>';
  const segments = route.segments.map((segment, index) => {
    const rows = [];
    if (segment.kind === 'walking' || segment.walking) {
      const walking = segment.walking ?? (segment.kind === 'walking' ? segment : null);
      const steps = (walking.steps ?? []).map(step => [step.instruction, step.road, step.distanceMeters == null ? null : `${step.distanceMeters} 米`].filter(Boolean).join(' · ')).filter(Boolean);
      rows.push(`<p>步行：${esc(distanceText(walking.distanceMeters))} · ${esc(durationText(walking.durationMinutes))}</p>${steps.length ? list(steps) : '<p>详细步行步骤未返回。</p>'}`);
    }
    if (segment.buslines?.length) rows.push(`<p>本段备选线路（同一段择一，不是连续换乘）：</p>${list(segment.buslines.map(line => `${line.name ?? '线路名称未返回'} · ${line.departureStop ?? '上车站未返回'} → ${line.arrivalStop ?? '下车站未返回'}${line.viaStops?.length ? ` · 途经 ${line.viaStops.slice(0, 8).join('、')}${line.viaStops.length > 8 ? '等' : ''}` : ''}${Number.isFinite(line.durationMinutes) ? ` · 约 ${line.durationMinutes} 分钟` : ''}${Number.isFinite(line.distanceMeters) ? ` · ${line.distanceMeters} 米` : ''}`))}`);
    else if (segment.railway) rows.push(`<p>铁路：${esc(segment.railway.name ?? '线路名称未返回')} · ${esc(segment.railway.trip ?? '车次未返回')}</p>`);
    else if (segment.kind === 'transit') rows.push('<p>公交/地铁线路及上下车站未返回。</p>');
    if (segment.entrance || segment.exit || segment.kind === 'transit') rows.push(`<p>进站口：${esc(segment.entrance ?? '未返回')} · 出站口：${esc(segment.exit ?? '未返回')}</p>`);
    return `<li><b>第 ${index + 1} 段</b>${rows.join('')}</li>`;
  });
  const chain = route.segments.map(segment => segment.buslines?.length ? segment.buslines.map(line => line.name ?? '线路名称未返回').join(' / ') : segment.railway?.name ?? (segment.kind === 'walking' || segment.walking ? '步行' : '线路未返回'));
  return `<p class="route-chain">乘车链路：${esc(chain.join(' → '))}</p><details class="route-detail"><summary>展开逐段乘车与步行指引</summary><ol>${segments.join('')}</ol></details>`;
}
function weatherMarkup(weather, dates) {
  if (!weather || !Array.isArray(weather.forecasts)) return '';
  const byDate = new Map(weather.forecasts.map(row => [row.date, row]));
  return `<section class="weather-card"><h2>出行日期天气</h2>${dates.map(date => {
    const row = byDate.get(date);
    if (!row) return `<p>${esc(date)}：超出当前返回的预报日期，天气未知。</p>`;
    const winds = [row.daywind && `白天${row.daywind}`, row.daypower && `风力${row.daypower}`, row.nightwind && `夜间${row.nightwind}`, row.nightpower && `风力${row.nightpower}`].filter(Boolean).join(' · ');
    return `<p><b>${esc(date)}</b> · ${esc(row.dayweather ?? '白天天气未返回')} / ${esc(row.nightweather ?? '夜间天气未返回')} · ${esc(row.nighttemp ?? '?')}–${esc(row.daytemp ?? '?')}℃${winds ? ` · ${esc(winds)}` : ''}</p>`;
  }).join('')}<p class="muted">${esc(weather.source ?? '天气来源未标注')} · 查询于 ${esc(queryTime(weather.queriedAt))}。预报日期外不作推断。</p></section>`;
}

export function assessItinerary(document) {
  if (!document || !Array.isArray(document.plans) || !document.plans.length || document.plans.length > 2) throw new Error('行程卡须包含 1–2 份方案。');
  if (!Number.isFinite(Date.parse(document.generatedAt))) throw new Error('请提供生成时间 generatedAt。');
  return document.plans.map(plan => {
    if (!Array.isArray(plan.events) || !plan.events.length || plan.events.length > 100 || plan.events.some(event => !event.title || !event.id)) throw new Error('每份方案需有 1–100 项带 ID 和标题的活动。');
    const validation = validatePlan(plan, document.constraints ?? {});
    const completeness = [];
    const dates = [...new Set(plan.events.filter(event => event.kind === 'visit').map(event => event.startAt.slice(0,10)))];
    if (dates.length < 2) completeness.push('尚未覆盖两天游览，请检查是否有未解释的整天空白。');
    for (const date of dates) if (!plan.events.some(event => event.kind === 'meal' && event.startAt.startsWith(date))) completeness.push(`${date} 尚未单独安排用餐。`);
    if (!plan.events.some(event => event.kind === 'stay')) completeness.push('尚未给出住宿参考点与时间。');
    if (!plan.events.some(event => event.kind === 'rest')) completeness.push('尚未单独预留休息或机动时间。');
    if (plan.events.some(event => !event.source)) completeness.push('部分活动缺少数据来源或估算依据。');
    return { plan, validation, completeness };
  });
}

export function renderTrip(document) {
  const assessed = assessItinerary(document);
  const adjustments = document.adjustments ?? ['第二天轻松一点，少走路，保留必去点和返程约束。','把这个不喜欢的活动替换成同片区更适合我的体验；先确认我指的是哪一项。','我晚一小时出发，检查去程能否赶上并重排后续，保留原版。','想多安排一些当地美食，保持预算上限和最晚到家时间。'];
  const plans = assessed.map(({plan,validation,completeness},index) => {
    const issues = [...new Set([...validation.errors,...validation.warnings].map(issue => labels[issue.code] ?? issue.code))];
    const days = [...new Set(plan.events.map(event => event.startAt.slice(0,10)))];
    const timeline = days.map(date => `<h3 class="date">${esc(date)}</h3>${plan.events.filter(event => event.startAt.startsWith(date)).map(event => {
      const sourceLink = safeLink(event.sourceUrl);
      const cost = event.costCents == null || event.costStatus === 'unknown' ? '费用待确认' : event.costCents === 0 ? '无单列费用；以事项说明为准' : `${money(event.costCents)}${event.costStatus === 'estimate' ? '（预留/估算）' : ''}`;
      return `<article class="event"><div class="clock">${esc(time(event.startAt))}<span>至 ${esc(time(event.endAt))}</span></div><div><span class="kind">${esc({visit:'游览',meal:'吃饭',stay:'住宿参考',rest:'休息/缓冲',train:'城际交通',transfer:'接驳'}[event.kind] ?? '活动')}</span><h4>${esc(event.title)}</h4>${event.placeDetails?.address || event.address ? `<p>${esc(event.placeDetails?.address ?? event.address)}</p>` : ''}${event.description ? `<p>${esc(event.description)}</p>` : ''}${event.reason ? `<p><b>这样安排：</b>${esc(event.reason)}</p>` : ''}${event.mode ? `<p>交通：${esc({transit:'公交/地铁',walking:'步行'}[event.mode] ?? event.mode)}${event.walkingMeters ? ` · 路线步行 ${esc(event.walkingMeters)} 米` : ''}${event.distanceMeters == null && event.mode === 'transit' ? ' · 全程距离未可靠返回' : ''}</p>` : ''}${event.mode && !event.routeDetails ? '<p class="route-legacy">仅有路线汇总</p>' : ''}${event.routeDetails ? routeMarkup(event.routeDetails) : ''}${placeMarkup(event.placeDetails)}${informationMarkup(event.informationEvidence)}<p class="cost">${cost}</p>${event.alternative ? `<p>可替换：${esc(event.alternative)}</p>` : ''}${event.note ? `<p>${esc(event.note)}</p>` : ''}<p class="source">${esc(event.source ?? '来源待补充')}${event.queriedAt ? ` · 查询于 ${esc(queryTime(event.queriedAt))}` : ''}${sourceLink ? ` · <a href="${esc(sourceLink)}" target="_blank" rel="noreferrer noopener">查看依据</a>` : ''}</p></div></article>`;
    }).join('')}`).join('');
    return `<details class="plan" ${index === 0 ? 'open' : ''}><summary>${esc(plan.name ?? `方案 ${index+1}`)}<span class="${validation.valid ? 'pending' : 'error'}">${validation.valid ? '结构通过，仍需核实' : '存在硬约束冲突，不可直接采用'}</span></summary><p>${esc(plan.reason ?? '')}</p><div class="metrics"><div><b>${money(validation.knownCostCents)}</b><small>已知费用＋估算预留小计</small></div><div><b>${money(document.constraints?.budgetCents)}</b><small>预算上限（未知时不保证满足）</small></div><div><b>${esc(time(plan.arrivalHomeAt) || '待确认')}</b><small>预计到家</small></div></div><div class="notice ${validation.valid ? '' : 'error'}"><b>${validation.valid ? '采用前还需确认' : '先解决以下冲突'}</b>${list([...issues,...completeness])}<p>未知费用不计入小计；结构通过不代表全部约束已满足。</p></div>${timeline}${plan.omitted?.length ? `<h3>未安排的内容与原因</h3>${list(plan.omitted.map(row=>`${row.name}：${row.reason}`))}` : ''}${plan.walkingNotice ? `<p class="source">${esc(plan.walkingNotice)}</p>` : ''}</details>`;
  }).join('');
  const itineraryDates = [...new Set(assessed.flatMap(({plan}) => plan.events.map(event => event.startAt.slice(0,10))))].sort();
  const weather = weatherMarkup(document.weather, itineraryDates);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>${esc(document.title ?? '我的周末行程')}</title><style>
  :root{font-family:"Microsoft YaHei",system-ui,sans-serif;color:#293329;background:#f5f2eb;line-height:1.8}*{box-sizing:border-box}body{max-width:1000px;margin:auto;padding:26px}h1{font-size:32px;line-height:1.4;margin:10px 0}h2{font-size:21px}p{margin:7px 0}.eyebrow{color:#af5336;letter-spacing:.12em;font-size:11px}.muted,.source{font-size:12px;color:#77766a;overflow-wrap:anywhere}.notice{padding:16px 20px;background:#eeebdc;border-left:3px solid #bda56a;margin:18px 0}.error{color:#a23c29}.notice.error{background:#f8e5dc}.pending{color:#8a713c}.plan{border:1px solid #ded7c8;border-radius:8px;padding:24px;background:#fffefa;margin:25px 0}.plan>summary{font-size:21px;font-weight:bold;cursor:pointer}.plan>summary span{display:block;font-size:12px;font-weight:normal}.metrics{display:flex;flex-wrap:wrap;gap:25px;margin:22px 0}.metrics b,.metrics small{display:block}.metrics small{font-size:11px;color:#8a8473}.date{margin:26px 0 16px;color:#a35439}.event{display:grid;grid-template-columns:155px 1fr;gap:22px;border-top:1px solid #e9e4d9;padding:19px 0}.clock{font-size:12px;color:#777363}.clock span{display:block}.event h4{font-size:18px;line-height:1.5;margin:2px 0 8px}.event p{font-size:13px}.kind{font-size:11px;color:#73866a}.cost{font-weight:bold;color:#a35439}.adjust{display:flex;gap:10px;flex-wrap:wrap}button{background:#b65c3e;color:#fff;border:0;border-radius:5px;padding:11px 16px;cursor:pointer;font:inherit;font-size:12px}button:focus-visible{outline:3px solid #558b6c;outline-offset:2px}textarea{display:block;width:100%;margin-top:12px;min-height:65px;padding:12px;border:1px solid #ccc;border-radius:5px;font:inherit;font-size:13px}.sr{font-size:12px;color:#687760}.footer{padding:20px 0;color:#8b8372;font-size:12px}a{color:#a35439}@media(max-width:600px){body{padding:18px}h1{font-size:27px}.plan{padding:17px}.event{grid-template-columns:1fr;gap:6px}.clock span{display:inline;margin-left:8px}.metrics{gap:15px}.metrics b{font-size:15px}}@media print{.adjust-box{display:none}.plan{break-inside:auto}.event{break-inside:avoid}}
  </style><style>.route-chain{font-weight:600}.route-detail,.poi-info,.weather-card{padding:8px 12px;margin:8px 0;background:#f4f2ea;border-radius:5px;font-size:12px}.route-detail summary{cursor:pointer}.route-detail ol{padding-left:20px}.route-detail li{margin:12px 0}.route-detail li p,.poi-info p,.weather-card p{font-size:12px}.route-legacy{color:#8a806e;font-size:11px}.weather-card{padding:14px 18px}.weather-card h2{font-size:17px}</style></head><body><header><p class="eyebrow">WEEKEND RUSH · 说个大概，安排明白</p><h1>${esc(document.title ?? '我的周末行程')}</h1><p>${esc(document.summary ?? '')}</p><p class="muted">${esc(document.version ?? 'v1')} · 生成于 ${esc(queryTime(document.generatedAt))} · 生成时的查询快照，出发前需复核</p></header>${document.preferences ? `<p>本次偏好：${esc(document.preferences)}</p>` : ''}${document.assumptions?.length ? `<div class="notice"><b>可修改的假设</b>${list(document.assumptions)}</div>` : ''}${weather}${document.changeSummary?.length ? `<section><h2>这一版改了什么</h2>${list(document.changeSummary)}</section>` : ''}${plans}<section class="adjust-box"><h2>想改哪里，说一句就好</h2><p class="muted">以下按钮复制调整请求，发回 AI 客户端后重新查询与规划；本卡片不会自行调用模型。</p><div class="adjust">${adjustments.map((prompt,index)=>`<button type="button" data-adjust="${esc(prompt)}">${esc(['少走路','换个活动','晚一小时','多吃一点'][index] ?? `调整 ${index+1}`)}</button>`).join('')}</div><textarea id="adjustText" aria-label="调整请求" placeholder="也可以直接在 AI 对话中说你的修改意向"></textarea><p id="copyStatus" class="sr" role="status" aria-live="polite"></p></section><section><h2>出发前与待确认</h2>${list([...(document.predeparture ?? []),...(document.notices ?? [])])}</section><p class="footer">只提供查询与计划；未购票、未预订、未确认预约。酒店/餐饮预留不是实时成交价格。</p><script>for(const button of document.querySelectorAll('[data-adjust]'))button.addEventListener('click',async()=>{const text=document.getElementById('adjustText');text.value=button.dataset.adjust;try{await navigator.clipboard.writeText(text.value);document.getElementById('copyStatus').textContent='已复制，发回 AI 客户端即可调整。';}catch{text.focus();text.select();document.getElementById('copyStatus').textContent='请复制上方文字，或直接在 AI 对话中描述修改。';}});</script></body></html>`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const argument = name => { const index=process.argv.indexOf(name); if(index<0||!process.argv[index+1])throw new Error(`缺少 ${name}`);return resolve(process.argv[index+1]); };
    const input=argument('--input');const output=argument('--output');
    if(input===output)throw new Error('输入与输出路径不能相同。');
    const raw=await readFile(input,'utf8');if(Buffer.byteLength(raw)>1000000)throw new Error('行程输入不能超过 1 MB。');
    await writeFile(output,renderTrip(JSON.parse(raw)),{encoding:'utf8',flag:'wx'});
    console.log(`行程卡已生成：${output}`);
  } catch(error) { console.error(error.code==='EEXIST'?'输出文件已存在，请用新版本文件名保留历史。':`行程卡未生成：${error.message}`);process.exitCode=1; }
}
