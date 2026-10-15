import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('editing visit duration without blurring sends the new value to the planner', async () => {
  class Element {
    value = ''; innerHTML = ''; textContent = ''; listeners = {}; controls = []; disabled = false;
    classList = { toggle() {}, remove() {} };
    addEventListener(name, callback) { this.listeners[name] = callback; }
    scrollIntoView() {}
    async click() { return this.listeners.click?.(); }
    querySelectorAll(selector) {
      const attribute = { '[data-pick]': 'pick', '[data-field]': 'field', '[data-remove]': 'remove', '[data-plan]': 'plan' }[selector];
      if (!attribute) return [];
      const nodes = [...this.innerHTML.matchAll(new RegExp(`<[^>]*data-${attribute}="[^"]+"[^>]*>`, 'g'))].map(match => {
        const node = new Element(); node.dataset = {};
        for (const pair of match[0].matchAll(/data-([a-z]+)="([^"]+)"/g)) node.dataset[pair[1]] = pair[2];
        node.value = match[0].match(/value="([^"]*)"/)?.[1] || ''; node.checked = match[0].includes(' checked');
        return node;
      });
      this.controls = this.controls.filter(row => row.selector !== selector).concat(nodes.map(node => ({ selector, node })));
      return nodes;
    }
  }
  const elements = new Map(); const element = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const html = await readFile(new URL('../live/index.html', import.meta.url), 'utf8');
  for (const row of html.matchAll(/<input[^>]*id="([^"]+)"[^>]*>/g)) element(row[1]).value = row[0].match(/value="([^"]*)"/)?.[1] || '';
  let submitted;
  const sandbox = { document: { getElementById: element }, console, AbortSignal, fetch: async (url, options) => {
    const input = options.body ? JSON.parse(options.body) : {};
    const meta = { source: 'test fixture', queriedAt: '2099-10-15T00:00:00Z' };
    const data = url.endsWith('/status') ? {today:'2099-10-15',mapKeyConfigured:true}
      : url.endsWith('/places') ? {...meta,candidates:[{id:input.keywords,name:input.keywords,address:'测试地址'}]}
      : url.endsWith('/place') ? {...meta,...input,name:input.id,type:'fixture',location:'121.4,31.2'}
      : url.endsWith('/weather') ? {...meta,forecasts:[]}
      : url.endsWith('/tickets') ? {...meta,from:{name:'起站'},to:{name:'终站'},rejectedCount:0,tickets:[{id:'ticket',trainCode:'G1',departureAt:'2099-10-17T08:00:00+08:00',arrivalAt:'2099-10-17T09:00:00+08:00',seats:[{name:'二等座',status:'available',priceCny:87}]}]}
      : (submitted=input,{...meta,generatedAt:meta.queriedAt,engine:'fixture',variants:[{name:'测试',status:'unavailable',message:'仅验证提交数据'}],notices:[]});
    return { ok:true, json:async()=>data };
  }};
  vm.runInNewContext(await readFile(new URL('../live/live.js', import.meta.url), 'utf8'), sandbox);
  await new Promise(resolve => setImmediate(resolve));
  element('fromStation').value='HGH'; element('toStation').value='AOH';
  await element('queryTrains').click(); element('outboundTicket').value='0'; element('returnTicket').value='0';
  for (const role of ['station','lodging','visit']) {
    element('placeRole').value=role; element('placeKeywords').value=role;
    await element('searchPlaces').click(); await element('placeCandidates').controls.find(row=>row.selector==='[data-pick]').node.click();
  }
  const duration = element('selectedPlaces').controls.find(row=>row.node.dataset.field==='durationMinutes').node;
  duration.value='60'; duration.listeners.input(); // Deliberately no blur/change event.
  await element('generatePlan').click();
  assert.equal(submitted.places[0].durationMinutes,'60');
  assert.equal(submitted.stationPoiId,'station'); assert.equal(submitted.overnightPoiId,'lodging');
});
