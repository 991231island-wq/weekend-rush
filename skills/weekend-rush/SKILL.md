---
name: weekend-rush
description: Plan and revise constraint-aware weekend trips in China using rail and map MCP tools. Use when a traveler has a destination and needs a compact itinerary, options by pace or budget, or a replan after a delay or fatigue.
---

# 周末特种兵行程助手

Help a traveler use limited weekend time well while respecting their return deadline, budget, must-see places, and energy. You propose plans; the traveler books tickets, lodging, meals, and reservations themselves.

## Workflow

1. Collect the travel date, exact origin and destination cities, preferred stations or permission to choose among stations, earliest departure, latest arrival home, party size, per-person budget, must-see places, walking tolerance, and required rest. Ask for missing hard constraints together. Mark any defaults explicitly; never treat a station as the traveler's home address.
2. Resolve station names to exact 12306 telecodes. Search trips for the requested boarding date. Request the complete candidate set (`limitedNum: 0` for the direct 12306 MCP), then run `normalize-tickets` from `scripts/trip-utils.mjs` with exact origin and destination telecodes. It rejects station mismatches before applying the display limit, uses the query date, departure time, and duration to build timestamps, and rejects an arrival clock that conflicts with the duration. Keep the upstream origin-run date for traceability. Never present waitlist or sold-out seats as available.
3. Resolve each named attraction with map text search. If multiple plausible POIs remain, show the name, district, address, category, and ID and ask the traveler to choose. Do not route to a guessed or first-listed result. After selection, request POI detail when available, then plan walking or transit routes using the selected coordinates. Convert route duration from seconds to minutes and distance from meters to kilometers for display.
4. Check the forecast only for dates returned by the weather tool. Verify opening hours and reservation requirements from a suitable source where possible; a reservation requirement without confirmed booking remains pending.
5. Propose two plans: (A) cover the must-see places and more optional stops, and (B) reduce walking with more rest. Keep the same hard constraints in both. Include the full outbound and return legs, local transfers, meals, overnight stay, activity durations, costs, walking, data source and query time. Separate retrieved data, estimates, and unknowns. Ask before assuming a total budget passes when any material cost is unknown.
6. Run `validate-plan` on each candidate using `scripts/trip-utils.mjs`. Fix every hard error before presenting it. Explain warnings plainly; a plan with unresolved costs, opening hours, bookings, or home transfer can be structurally valid without being fully feasible.
7. When the traveler reports a delay, fatigue, or a completed activity, preserve the previous version and all completed activity times. Ask the model to propose a revised remaining schedule, then run `compare-plans` and `validate-plan`. Report kept, moved, removed, and added items with reasons. Never silently relax a hard constraint. If no plan passes, state the conflict and ask which constraint may change.

## Tool failures and trust

- If a rail or map tool fails, say which data is missing and how it affects the plan. Offer an explicitly labeled example or estimate only if useful; never fabricate live availability, coordinates, transit times, opening hours, or current prices.
- Check station telecodes and selected POI coordinates, not just their Chinese names. A city name and a station name are not interchangeable.
- Use full Asia/Shanghai timestamps including dates and UTC offset. Respect overnight arrival and the user's actual arrive-home deadline.
- Use data freshness labels. Ticket inventory and weather can change; tell the traveler to reconfirm before acting.
- Do not make purchases, reservations, account changes, or MCP server changes. The traveler completes bookings outside this skill.
- Read [the data contract](references/data-contract.md) when constructing or validating JSON. Read [MCP setup](references/mcp-setup.md) when installing the dependencies.

## Deterministic helper

From this skill directory, run:

```sh
node scripts/trip-utils.mjs normalize-tickets --input request.json
node scripts/trip-utils.mjs resolve-poi --input request.json
node scripts/trip-utils.mjs validate-plan --input request.json
node scripts/trip-utils.mjs compare-plans --input request.json
```

Each input file is JSON and contains the fields described in `references/data-contract.md`. The helper writes its result to stdout and never reads or logs a map key.
