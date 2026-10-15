# Data contract

All trip times use ISO 8601 timestamps with the Asia/Shanghai UTC offset, such as `2026-10-17T09:30:00+08:00`. Costs are integer CNY cents. Distances are meters in tool payloads; the display layer may also show kilometers. Keep source and retrieval time alongside live data.

## Normalize 12306 tickets

Input to `normalize-tickets --input file.json`:

```json
{
  "raw": [{
    "start_train_code": "G269",
    "train_no": "5l0000G26900",
    "start_date": "2026-10-17",
    "start_time": "15:00",
    "arrive_time": "15:45",
    "lishi": "00:45",
    "from_station": "上海虹桥",
    "to_station": "杭州东",
    "from_station_telecode": "AOH",
    "to_station_telecode": "HGH",
    "prices": [{ "seat_name": "二等座", "num": "有", "price": 87 }]
  }],
  "query": {
    "date": "2026-10-18",
    "fromStationCode": "AOH",
    "toStationCode": "HGH",
    "earliestStartTime": "14:00",
    "latestStartTime": "18:00",
    "queriedAt": "2026-10-15T20:00:00+08:00"
  },
  "limit": 10
}
```

The query date defines the boarding date. `start_date` is kept as `upstreamOriginRunDate` for traceability but does not override it. Arrival date is derived from query date + departure time + duration, including midnight and year boundaries. When the upstream arrival clock is present, it must agree with that duration or the candidate is rejected. Exact telecodes are mandatory. Filtering occurs before sorting and limiting.

## Resolve a POI

Input fields: `result` contains a map search result (`pois`) or geocode result (`return`); optional `selector` can contain a stable `poiId`, `district`, and/or `typecode`. The output status is `resolved`, `ambiguous`, or `not-found`. Route only with a resolved candidate whose `location` passes `parseCoordinates`.

## Validate an itinerary

Input to `validate-plan --input file.json`:

```json
{
  "plan": {
    "events": [{
      "id": "museum",
      "placeId": "shanghai-museum",
      "startAt": "2026-10-17T09:30:00+08:00",
      "endAt": "2026-10-17T11:00:00+08:00",
      "costCents": 0,
      "costStatus": "known",
      "bookingStatus": "not-required",
      "openingStatus": "verified"
    }],
    "arrivalHomeAt": "2026-10-18T19:00:00+08:00"
  },
  "constraints": {
    "mustVisitIds": ["shanghai-museum"],
    "budgetCents": 100000,
    "latestHomeAt": "2026-10-18T20:00:00+08:00"
  }
}
```

Each event has a unique `id`, start/end times, and `costCents` plus `costStatus` (`known`, `estimate`, or `unknown`). Optional `bookingStatus` is `not-required`, `confirmed`, `required-unconfirmed`, or `unknown`; `openingStatus` is `verified` or `unknown`. The validator reports overlaps, missed must-see places, budget excess, missed home deadline, and missing/uncertain cost or booking data. `valid` means no hard errors; `feasible` additionally requires no warnings.

Set `kind` to `visit`, `meal`, `stay`, `rest`, `train`, or `transfer`. A transfer passing a POI does not satisfy a must-visit requirement. Use stable activity IDs across revisions, even if times or optional venues change; add an ID only for a genuinely new activity.

## Compare a revision

Input has `previous`, `next`, and optional `completedIds`. Both plans use the same `events` shape. `next.changeReasons` maps event IDs to a plain-language reason. Completed activities must remain unchanged; output lists kept, moved, changed, removed, and added activities.

## Render a complete itinerary card

`node scripts/render-trip.mjs --input itinerary.json --output itinerary-v1.html`

The renderer will not overwrite an existing file: choose a new version filename. Input shape:

```json
{
  "title": "上海两天一晚 · 建筑与美食",
  "version": "v1",
  "generatedAt": "2026-10-15T22:00:00+08:00",
  "summary": "按片区串联，保留休息与返程缓冲。",
  "preferences": "建筑、当地美食；避免长时间连续步行",
  "assumptions": ["单人，公共交通；住所接驳采用用户估时，尚未查证"],
  "constraints": { "budgetCents": 100000, "latestHomeAt": "2026-10-18T21:00:00+08:00", "mustVisitIds": [] },
  "plans": [{ "id": "recommended", "name": "推荐方案", "reason": "符合兴趣且减少跨区折返", "arrivalHomeAt": "2026-10-18T19:00:00+08:00", "events": [] }],
  "predeparture": ["核实营业和预约，确认车票与住宿"],
  "notices": ["餐宿费用为预留，未购票未预订"],
  "changeSummary": []
}
```

Populate `events` using the full event schema above; the empty array illustrates the wrapper only and will be rejected by the renderer. Optional event fields `title`, `address`, `description`, `reason`, `alternative`, `note`, `mode`, `walkingMeters`, `source`, `sourceUrl`, `queriedAt` supply human-readable detail. `source` must distinguish retrieved information from a user estimate or planning assumption; a source URL is optional and must not contain credentials.

The renderer runs the shared validator and highlights hard conflicts/unknowns. It additionally warns when the itinerary lacks two days of visits, per-day meals, a stay, rest, or sources. These are completeness checks, not proof that recommendations fit a user, a venue is open, or all costs are verified. Default quick-adjust prompts are copy-only requests for the host model. Supply optional `adjustments` strings to customize them; actual revisions must be queried and validated in the AI client before producing the next card.
