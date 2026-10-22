import { type DataEvidence, EVIDENCE_LABELS } from "@/lib/assistant/evidence";
import { zone, zoneName } from "@/lib/time";

export function DataEvidenceNote({ evidence }: { evidence: DataEvidence }) {
  return (
    <details className="mt-3 rounded-lg border bg-card/40 px-3 py-2 text-[12px]">
      <summary className="cursor-pointer text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
        {EVIDENCE_LABELS[evidence.status]}
        <span className="ml-2 text-[11px]">
          {new Date(evidence.checkedAt).toLocaleString("en-PH", {
            timeZone: zone(),
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}{" "}
          · {zoneName(zone())}
        </span>
      </summary>
      <div className="mt-2 space-y-2 border-t pt-2">
        {evidence.queries.length ? (
          evidence.queries.map((q, i) => (
            <div key={`${q.label}-${i}`}>
              <p className="font-medium text-foreground/85">{q.label}</p>
              <p className="break-words text-muted-foreground">{q.scope}</p>
              {q.matched !== undefined ? (
                <p className="text-muted-foreground">
                  {q.matched} matching {q.matched === 1 ? "record" : "records"}
                  {q.shown !== undefined && q.shown < q.matched ? ` · ${q.shown} returned` : ""}
                </p>
              ) : null}
            </div>
          ))
        ) : (
          <p className="text-muted-foreground">
            The records could not be retrieved. No result has been assumed.
          </p>
        )}
        <p className="text-[11px] text-muted-foreground">Records may have changed since this check.</p>
      </div>
    </details>
  );
}
