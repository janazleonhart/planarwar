//web-frontend/components/city/CityWorkshopTechSection.tsx

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
        <strong>Workshop</strong>
        <div style={{ fontSize: 12, opacity: 0.75 }}>
          Craft quote: {formatLevy(quoteMap.get("workshop_craft")?.levy)} / +{quoteMap.get("workshop_craft")?.queueMinutes ?? 0}m
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {(["valor_charm", "scouting_cloak", "arcane_focus"] as const).map((kind) => (
            <button
              key={kind}
              style={buttonStyle(disabled)}
              disabled={disabled}
              onClick={() => void handleWorkshopCraft(kind)}
            >
              Craft {kind}
            </button>
          ))}
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          {me.workshopJobs.map((job) => (
            <div key={job.id} style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div>
                <div><strong>{job.attachmentKind}</strong></div>
                <div style={{ opacity: 0.8, fontSize: 13 }}>Finishes: {new Date(job.finishesAt).toLocaleString()} • {job.completed ? "completed" : "in progress"}</div>
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
        <strong>Tech</strong>
        <div style={{ fontSize: 12, opacity: 0.75 }}>
          Research quote: {formatLevy(quoteMap.get("tech_research")?.levy)} / +{quoteMap.get("tech_research")?.queueMinutes ?? 0}m
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {techOptions.map((tech) => (
            <button
              key={tech.id}
              style={buttonStyle(disabled)}
              disabled={disabled}
              onClick={() => void handleStartTech(tech.id)}
              title={tech.description ?? tech.id}
            >
              Start: {tech.name}
            </button>
          ))}
          {!techOptions.length ? <span style={{ opacity: 0.7, fontSize: 13 }}>No tech options (yet).</span> : null}
        </div>
        {me.activeResearch ? <div style={{ fontSize: 13, opacity: 0.85 }}>Active research: {me.activeResearch.name} ({me.activeResearch.progress}/{me.activeResearch.cost})</div> : null}
      </div>
    </>
  );
}
