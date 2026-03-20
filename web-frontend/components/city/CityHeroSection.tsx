//web-frontend/components/city/CityHeroSection.tsx

import { CityActionQuoteLine } from "./CityActionQuoteLine";
import type { CSSProperties } from "react";
import type { HeroRole, MeProfile, PublicServiceQuote, Resources } from "../../lib/api";

type CityHeroSectionProps = {
  me: MeProfile;
  disabled: boolean;
  quoteMap: Map<string, PublicServiceQuote>;
  formatLevy: (levy: Partial<Resources> | undefined) => string;
  handleRecruitHero: (role: HeroRole) => void | Promise<void>;
  handleEquipHeroAttachment: (heroId: string, kind: "valor_charm" | "scouting_cloak" | "arcane_focus") => void | Promise<void>;
};

const buttonStyle = (disabled: boolean): CSSProperties => ({
  padding: "6px 10px",
  borderRadius: 6,
  border: "1px solid #777",
  background: "#111",
  opacity: disabled ? 0.6 : 1,
});

const statusChipStyle = (status: string): CSSProperties => ({
  border: `1px solid ${status === "ready" ? "#355d45" : "#77603a"}`,
  background: status === "ready" ? "rgba(30,70,40,0.16)" : "rgba(90,70,30,0.16)",
  borderRadius: 999,
  padding: "2px 8px",
  fontSize: 12,
  opacity: 0.9,
});

export function CityHeroSection({
  me,
  disabled,
  quoteMap,
  formatLevy,
  handleRecruitHero,
  handleEquipHeroAttachment,
}: CityHeroSectionProps) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "grid", gap: 2 }}>
        <strong>Hero command</strong>
        <div style={{ fontSize: 12, opacity: 0.76 }}>
          {me.heroes.length === 0
            ? "No heroes are attached yet. Recruit the first officer cadre from here."
            : `${me.heroes.length} hero${me.heroes.length === 1 ? "" : "es"} currently attached to the city.`}
        </div>
      </div>
      <CityActionQuoteLine
        label="Recruit estimate"
        quote={quoteMap.get("hero_recruit")}
        formatLevy={formatLevy}
      />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {(["champion", "scout", "tactician", "mage"] as const).map((role) => (
          <button
            key={role}
            style={buttonStyle(disabled)}
            disabled={disabled}
            onClick={() => void handleRecruitHero(role)}
          >
            Recruit {role}
          </button>
        ))}
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        {me.heroes.map((hero) => (
          <div key={hero.id} style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 6 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <strong>{hero.name}</strong>
              <span style={{ fontSize: 13, opacity: 0.85 }}>{hero.role}</span>
              <span style={statusChipStyle(hero.status)}>{hero.status}</span>
              <span style={{ fontSize: 13, opacity: 0.8 }}>Power {hero.power}</span>
            </div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>Response roles: {hero.responseRoles?.join(", ") || "generalist"}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {(hero.traits ?? []).map((trait) => (
                <span key={trait.id} style={{ border: `1px solid ${trait.polarity === "pro" ? "#2a6" : "#844"}`, borderRadius: 999, padding: "2px 8px", fontSize: 12, opacity: 0.9 }} title={trait.summary}>
                  {trait.polarity === "pro" ? "+" : "−"} {trait.name}
                </span>
              ))}
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontSize: 12, opacity: 0.82 }}>Gear</div>
              {(hero.attachments?.length ?? 0) === 0 ? (
                <div style={{ fontSize: 12, opacity: 0.62 }}>No gear equipped.</div>
              ) : (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {(hero.attachments ?? []).map((attachment) => (
                    <span key={attachment.id} style={{ border: "1px solid #446", borderRadius: 999, padding: "2px 8px", fontSize: 12, opacity: 0.92 }} title={attachment.summary ?? `${attachment.family} gear`}>
                      {attachment.name} • {attachment.slot} • {(attachment.responseTags ?? []).join("/")}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(["valor_charm", "scouting_cloak", "arcane_focus"] as const).map((kind) => (
                <button
                  key={kind}
                  style={buttonStyle(disabled)}
                  disabled={disabled}
                  onClick={() => void handleEquipHeroAttachment(hero.id, kind)}
                  title={kind === "valor_charm" ? "Trinket slot • frontline/recovery" : kind === "scouting_cloak" ? "Utility slot • recon/recovery" : "Focus slot • warding/command"}
                >
                  Equip {kind.replace(/_/g, " ")}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
