//web-frontend/components/city/CityWorkshopTechSection.tsx

import { CityActionQuoteLine } from "./CityActionQuoteLine";
import type { CSSProperties } from "react";
import type { MeProfile, PublicServiceQuote, Resources } from "../../lib/api";

type CityWorkshopTechSectionProps = {
  me: MeProfile;
  disabled: boolean;
  techOptions: NonNullable<MeProfile["availableTechs"]>;
  quoteMap: Map<string, PublicServiceQuote>;
  formatLevy: (levy: Partial<Resources> | undefined) => string;
  handleWorkshopCraft: (kind: "valor_charm" | "scouting_cloak" | "arcane_focus") => void | Promise<void>;
  handleWorkshopCollect: (jobId: string) => void | Promise<void>;
  handleStartTech: (techId: string) => void | Promise<void>;
};

const buttonStyle = (disabled: boolean): CSSProperties => ({
  padding: "6px 10px",
  borderRadius: 6,
  border: "1px solid #777",
  background: "#111",
  opacity: disabled ? 0.6 : 1,
});

export function CityWorkshopTechSection({
  me,
  disabled,
  techOptions,
  quoteMap,
  formatLevy,
  handleWorkshopCraft,
  handleWorkshopCollect,
  handleStartTech,
}: CityWorkshopTechSectionProps) {
  return (
    <>
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "grid", gap: 2 }}>
          <strong>Workshop queue</strong>
          <div style={{ fontSize: 12, opacity: 0.76 }}>
            {me.workshopJobs.length === 0
              ? "No workshop jobs are in flight."
              : `${me.workshopJobs.length} crafting job${me.workshopJobs.length === 1 ? "" : "s"} currently tracked.`}
          </div>
        </div>
        <CityActionQuoteLine
          label="Craft estimate"
          quote={quoteMap.get("workshop_craft")}
          formatLevy={formatLevy}
        />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {(["valor_charm", "scouting_cloak", "arcane_focus"] as const).map((kind) => (
            <button
              key={kind}
              style={buttonStyle(disabled)}
              disabled={disabled}
              onClick={() => void handleWorkshopCraft(kind)}
            >
              Craft {kind.replace(/_/g, " ")}
            </button>
          ))}
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          {me.workshopJobs.length === 0 ? (
            <div style={{ border: "1px dashed #666", borderRadius: 8, padding: "10px 12px", fontSize: 13, opacity: 0.76 }}>
              No workshop receipts yet. Once smiths and enchanters start filing jobs, collections and finish times will show up here instead of leaving you to guess.
            </div>
          ) : null}
          {me.workshopJobs.map((job) => (
            <div key={job.id} style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div style={{ display: "grid", gap: 3 }}>
                <div><strong>{job.attachmentKind.replace(/_/g, " ")}</strong></div>
                <div style={{ opacity: 0.8, fontSize: 13 }}>Finishes: {new Date(job.finishesAt).toLocaleString()}</div>
                <div style={{ fontSize: 12, opacity: 0.72 }}>{job.completed ? "Ready for collection." : "Still in progress."}</div>
              </div>
              <button
                style={buttonStyle(disabled)}
                disabled={disabled || !job.completed}
                onClick={() => void handleWorkshopCollect(job.id)}
              >
                Collect
              </button>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "grid", gap: 2 }}>
          <strong>Research desk</strong>
          <div style={{ fontSize: 12, opacity: 0.76 }}>
            Queue long-term city improvements without digging through raw identifiers.
          </div>
        </div>
        <CityActionQuoteLine
          label="Research estimate"
          quote={quoteMap.get("tech_research")}
          formatLevy={formatLevy}
        />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {techOptions.map((tech) => (
            <button
              key={tech.id}
              style={buttonStyle(disabled)}
              disabled={disabled}
              onClick={() => void handleStartTech(tech.id)}
              title={tech.description ?? tech.id}
            >
              Start {tech.name}
            </button>
          ))}
          {!techOptions.length ? (
            <span style={{ opacity: 0.74, fontSize: 13 }}>
              No research paths are open right now. The desk is waiting for the next doctrine or prerequisite to clear.
            </span>
          ) : null}
        </div>
        {me.activeResearch ? <div style={{ fontSize: 13, opacity: 0.85 }}>Active research: {me.activeResearch.name} ({me.activeResearch.progress}/{me.activeResearch.cost})</div> : null}
      </div>
    </>
  );
}
