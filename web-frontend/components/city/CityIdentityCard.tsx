//web-frontend/components/city/CityIdentityCard.tsx

import type { CSSProperties } from "react";
import type { MeProfile } from "../../lib/api";
import { getRegionDisplayName } from "../worldResponse/worldResponseUi";

interface CityIdentityCardProps {
  me: MeProfile;
  cardStyle: (extra?: CSSProperties) => CSSProperties;
}

type Tone = "calm" | "watch" | "danger";

interface DigestItem {
  label: string;
  value: string;
  hint: string;
  tone: Tone;
}

const toneStyles: Record<Tone, CSSProperties> = {
  calm: { borderColor: "#355d45", background: "rgba(30,70,40,0.16)" },
  watch: { borderColor: "#77603a", background: "rgba(90,70,30,0.16)" },
  danger: { borderColor: "#7a3d3d", background: "rgba(100,30,30,0.16)" },
};

function getStressTone(stage: MeProfile["cityStress"]["stage"]): Tone {
  switch (stage) {
    case "lockdown":
    case "crisis":
      return "danger";
    case "strained":
      return "watch";
    default:
      return "calm";
  }
}

function getSlotTone(used: number, max: number): Tone {
  if (max <= 0) return "danger";
  const ratio = used / max;
  if (ratio >= 0.9) return "danger";
  if (ratio >= 0.7) return "watch";
  return "calm";
}

function getLaneBannerStyle(city: NonNullable<MeProfile["city"]>): CSSProperties {
  return city.settlementLane === "black_market"
    ? {
        border: "1px solid #7a3d3d",
        background: "rgba(80,24,32,0.18)",
        color: "#f4d8d8",
      }
    : {
        border: "1px solid #355d45",
        background: "rgba(25,60,42,0.16)",
        color: "#d9f0df",
      };
}

export function CityIdentityCard({ me, cardStyle }: CityIdentityCardProps) {
  const city = me.city ?? null;
  const stressTone = getStressTone(me.cityStress.stage);
  const slotTone: Tone = city ? getSlotTone(city.buildingSlotsUsed, city.buildingSlotsMax) : "watch";
  const specializationLabel = city?.specializationId
    ? `${city.specializationId.replace(/_/g, " ")} ★${city.specializationStars}`
    : "Unspecialized";

  const digestItems: DigestItem[] = city
    ? [
        {
          label: "Region",
          value: getRegionDisplayName(city.regionId),
          hint: city.regionId,
          tone: "calm",
        },
        {
          label: "City stress",
          value: `${me.cityStress.stage}`,
          hint: `total ${me.cityStress.total} • burden ${me.cityStress.recoveryBurden}`,
          tone: stressTone,
        },
        {
          label: "Development",
          value: `Tier ${city.tier}`,
          hint: specializationLabel,
          tone: city.specializationId ? "calm" : "watch",
        },
        {
          label: "Build slots",
          value: `${city.buildingSlotsUsed}/${city.buildingSlotsMax}`,
          hint:
            city.buildingSlotsUsed >= city.buildingSlotsMax
              ? "construction capacity is capped"
              : "room for expansion remains",
          tone: slotTone,
        },
      ]
    : [];

  return (
    <div style={cardStyle({ gap: 12 })}>
      <div style={{ display: "grid", gap: 4 }}>
        <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, opacity: 0.72 }}>
          Ruler&apos;s desk
        </div>
        <div style={{ fontSize: 20, fontWeight: 700 }}>{city ? city.name : "No city founded yet"}</div>
        <div style={{ fontSize: 13, opacity: 0.82 }}>
          <strong>Ruler:</strong> {me.username ?? "(unknown)"}{" "}
          <span style={{ opacity: 0.7 }}>({me.userId ?? "?"})</span>
        </div>
        <div style={{ fontSize: 13, opacity: 0.76 }}>
          {city
            ? "Top-level city posture and pressure markers, without having to spelunk through the rest of the board."
            : "This seat is still unfounded. Claim the city here and the rest of the board wakes up from a planning table into an actual seat of rule."}
        </div>
      </div>

      {city ? (
        <>
          <div
            style={{
              ...getLaneBannerStyle(city),
              borderRadius: 10,
              padding: "10px 12px",
              display: "grid",
              gap: 8,
            }}
          >
            <div style={{ display: "grid", gap: 3 }}>
              <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, opacity: 0.78 }}>
                Settlement lane
              </div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>
                {city.settlementLaneProfile.label} · {city.settlementLaneProfile.posture}
              </div>
              <div style={{ fontSize: 12, opacity: 0.84 }}>
                {city.settlementLane === "black_market"
                  ? "Shadow-founded settlement. Expect illicit throughput, hotter openings, and darker receipts."
                  : "Civic-founded settlement. Expect steadier public support, cleaner recovery, and calmer opening posture."}
              </div>
            </div>

            <div
              style={{
                borderTop: "1px solid rgba(255,255,255,0.16)",
                paddingTop: 8,
                display: "grid",
                gap: 6,
              }}
            >
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, opacity: 0.72 }}>
                Founding receipt
              </div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{city.settlementLaneReceipt.title}</div>
              <div style={{ fontSize: 12, opacity: 0.84 }}>{city.settlementLaneReceipt.summary}</div>
              {city.settlementLaneReceipt.effects.length ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {city.settlementLaneReceipt.effects.slice(0, 3).map((effect) => (
                    <span
                      key={effect}
                      style={{
                        display: "inline-block",
                        padding: "3px 8px",
                        borderRadius: 999,
                        fontSize: 11,
                        background: city.settlementLane === "black_market" ? "rgba(120,45,55,0.24)" : "rgba(45,95,75,0.24)",
                        border: "1px solid rgba(255,255,255,0.14)",
                      }}
                    >
                      {effect}
                    </span>
                  ))}
                </div>
              ) : null}
              {city.settlementLaneLatestReceipt.message !== city.settlementLaneReceipt.summary ? (
                <div style={{ fontSize: 12, opacity: 0.78 }}>
                  <strong>{city.settlementLaneLatestReceipt.title}:</strong> {city.settlementLaneLatestReceipt.message}
                </div>
              ) : null}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
            {digestItems.map((item) => {
              const toneStyle = toneStyles[item.tone];

              return (
                <div
                  key={item.label}
                  style={{
                    border: `1px solid ${typeof toneStyle.borderColor === "string" ? toneStyle.borderColor : "#555"}`,
                    background: typeof toneStyle.background === "string" ? toneStyle.background : undefined,
                    borderRadius: 10,
                    padding: 10,
                    display: "grid",
                    gap: 3,
                  }}
                >
                  <div style={{ fontSize: 12, opacity: 0.72 }}>{item.label}</div>
                  <div
                    style={{
                      fontSize: 18,
                      fontWeight: 700,
                      textTransform: item.label === "City stress" ? "capitalize" : undefined,
                    }}
                  >
                    {item.value}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.76 }}>{item.hint}</div>
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}
