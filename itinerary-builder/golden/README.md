# Golden set

Each case is a draft plus the findings a human expects from it. `eval` runs the checker over every case and reports recall (every expected finding caught) and precision (nothing flagged that a human would not) per case and overall.

| Case | Role | What it proves |
|---|---|---|
| `faulty-japan` | faulty | Every rule class has one planted fault and the checker catches each. |
| `profile-violations` | faulty | Nothing breaks a venue rule; every fault is against what the client said or did. |
| `reference-japan` | reference | An advisor-approved draft for the same brief. Only the fixed month remains. Its `reference_final` is the bar the agent's finalize is scored against, and its venue set is the overlap baseline. |

## How a case gets added

The loop runs through the advisor's dispositions. When a finding is marked `rejected` in `out/dispositions.jsonl`, the draft it came from becomes a candidate case with that finding removed from `expected_findings`, and the rule that produced it gets fixed or narrowed. When the advisor catches something the checker missed, the draft becomes a case with the miss added. Precision per class comes from the dispositions; recall comes from the cases.

## Case shape

```
{
  "case_id": "...", "role": "faulty | reference", "purpose": "...",
  "expected_findings": [ { "class": "closure", "item_contains": "Toyosu" }, ... ],
  "expected_questions": [ "regex", ... ],          reference only
  "reference_final":   { rationale_by_day, open_findings, questions_for_advisor },   reference only
  "itinerary":         { trip, days }
}
```
