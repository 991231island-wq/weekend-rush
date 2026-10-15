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

## Compare a revision

Input has `previous`, `next`, and optional `completedIds`. Both plans use the same `events` shape. `next.changeReasons` maps event IDs to a plain-language reason. Completed activities must remain unchanged; output lists kept, moved, changed, removed, and added activities.
