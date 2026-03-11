import * as React from "react";

type Props = {
  playerName: string;
  number: string | number;
  teamName: string;
  teamKey?: string | null;
  size?: number;
  className?: string;
};

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function upper(s: string) {
  return (s ?? "").toUpperCase();
}

function surnameOnly(full: string) {
  const s = String(full ?? "").trim();
  if (!s) return "PLAYER";
  if (s.includes(",")) return s.split(",")[0].trim();
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0];
  return parts[parts.length - 1];
}

function splitTeamTwoLines(teamName: string): [string, string] {
  const t = String(teamName ?? "").trim();
  if (!t) return ["TEAM", ""];
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 2) return [t, ""];
  if (words.length === 2) return [words[0], words[1]];
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
}

function fitFontPx(basePx: number, minPx: number, maxPx: number, text: string, targetChars: number) {
  const t = String(text ?? "").trim();
  if (!t) return clamp(basePx, minPx, maxPx);
  const k = clamp(targetChars / Math.max(targetChars, t.length), 0.42, 1);
  return clamp(Math.round(basePx * k), minPx, maxPx);
}

function textLenForName(text: string) {
  const len = String(text ?? "").trim().length;
  if (len <= 7) return 46;
  if (len <= 9) return 52;
  if (len <= 11) return 58;
  if (len <= 13) return 64;
  if (len <= 16) return 70;
  return 74;
}

function textLenForTeam(text: string) {
  const len = String(text ?? "").trim().length;
  if (len <= 7) return 34;
  if (len <= 9) return 40;
  if (len <= 11) return 46;
  if (len <= 13) return 52;
  if (len <= 16) return 58;
  return 62;
}

type Theme = {
  base: string;
  letters: string;
  stroke: string;
  stripes?: string;
  collar?: string;
  namePlateFill?: string;
  namePlateStroke?: string;
};

function normalizeTeamKey(teamKey?: string | null, teamName?: string): string {
  const k = String(teamKey ?? "").trim().toLowerCase();
  if (k) return k;

  const n = String(teamName ?? "").toLowerCase();

  if (n.includes("olympiacos")) return "olympiacos";
  if (n.includes("panathinaikos")) return "panathinaikos";
  if (n.includes("real madrid")) return "real_madrid";
  if (n.includes("barcelona")) return "fc_barcelona";
  if (n.includes("bayern")) return "fc_bayern";
  if (n.includes("fener")) return "fenerbahce";
  if (n.includes("efes")) return "anadolu_efes";
  if (n.includes("zalgiris")) return "zalgiris";
  if (n.includes("baskonia")) return "baskonia";
  if (n.includes("asvel")) return "asvel";
  if (n.includes("maccabi")) return "maccabi_tel_aviv";
  if (n.includes("crvena")) return "crvena_zvezda";
  if (n.includes("partizan")) return "partizan";
  if (n.includes("paris")) return "paris";
  if (n.includes("monaco")) return "as_monaco";
  if (n.includes("valencia")) return "valencia";
  if (n.includes("virtus")) return "virtus_bologna";
  if (n.includes("milano") || n.includes("armani") || n.includes("olimpia")) return "olimpia_milano";
  if (n.includes("dubai")) return "dubai";
  if (n.includes("hapoel")) return "hapoel_tel_aviv";

  return "";
}

const THEMES: Record<string, Theme> = {
  olympiacos: {
    base: "#D3122B",
    letters: "#FFFFFF",
    stroke: "rgba(0,0,0,0.34)",
    collar: "#FFFFFF",
    namePlateFill: "rgba(255,255,255,0.12)",
    namePlateStroke: "rgba(255,255,255,0.16)",
  },

  panathinaikos: {
    base: "#1C8C4D",
    letters: "#FFFFFF",
    stroke: "rgba(0,0,0,0.34)",
    collar: "#FFFFFF",
    namePlateFill: "rgba(255,255,255,0.12)",
    namePlateStroke: "rgba(255,255,255,0.16)",
  },

  real_madrid: {
    base: "#F7F7F7",
    letters: "#111827",
    stroke: "rgba(255,255,255,0.32)",
    collar: "#111827",
    namePlateFill: "rgba(255,255,255,0.96)",
    namePlateStroke: "rgba(0,0,0,0.12)",
  },

  fc_barcelona: {
    base: "#173A88",
    stripes: "#8C183C",
    letters: "#F2C94C",
    stroke: "rgba(0,0,0,0.8)",
    collar: "#173A88",
    namePlateFill: "rgba(23,58,136,0.9)",
    namePlateStroke: "rgba(242,201,76,0.30)",
  },

  fc_bayern: {
    base: "#D21530",
    letters: "#153A8C",
    stroke: "rgba(255,255,255,0.90)",
    collar: "#FFFFFF",
    namePlateFill: "rgba(255,255,255,0.94)",
    namePlateStroke: "rgba(21,58,140,0.20)",
  },

  fenerbahce: {
    base: "#0F2C6E",
    stripes: "#F4D21F",
    letters: "#FFFFFF",
    stroke: "#000000",
    collar: "#0F2C6E",
    namePlateFill: "rgba(15,44,110,0.92)",
    namePlateStroke: "rgba(255,255,255,0.18)",
  },

  anadolu_efes: {
    base: "#2450C5",
    letters: "#FFFFFF",
    stroke: "rgba(0,0,0,0.34)",
    collar: "#FFFFFF",
    namePlateFill: "rgba(255,255,255,0.12)",
    namePlateStroke: "rgba(255,255,255,0.16)",
  },

  zalgiris: {
    base: "#0D7A43",
    letters: "#FFFFFF",
    stroke: "rgba(0,0,0,0.34)",
    collar: "#FFFFFF",
    namePlateFill: "rgba(255,255,255,0.12)",
    namePlateStroke: "rgba(255,255,255,0.16)",
  },

  baskonia: {
    base: "#132951",
    stripes: "#B02035",
    letters: "#FFFFFF",
    stroke: "rgba(0,0,0,0.84)",
    collar: "#132951",
    namePlateFill: "rgba(19,41,81,0.90)",
    namePlateStroke: "rgba(255,255,255,0.18)",
  },

  asvel: {
    base: "#0B3A6B",
    letters: "#FFFFFF",
    stroke: "rgba(0,0,0,0.34)",
    collar: "#FFFFFF",
    namePlateFill: "rgba(255,255,255,0.12)",
    namePlateStroke: "rgba(255,255,255,0.16)",
  },

  maccabi_tel_aviv: {
    base: "#F2C200",
    letters: "#102B66",
    stroke: "rgba(255,255,255,0.36)",
    collar: "#102B66",
    namePlateFill: "rgba(16,43,102,0.12)",
    namePlateStroke: "rgba(16,43,102,0.20)",
  },

  crvena_zvezda: {
    base: "#FFFFFF",
    stripes: "#D81E2E",
    letters: "#D4AF37",
    stroke: "rgba(60,10,15,0.8)",
    collar: "#FFFFFF",
    namePlateFill: "rgba(255,255,255,0.96)",
    namePlateStroke: "rgba(212,175,55,0.24)",
  },

  partizan: {
    base: "#111827",
    letters: "#FFFFFF",
    stroke: "rgba(0,0,0,0.48)",
    collar: "#FFFFFF",
    namePlateFill: "rgba(255,255,255,0.12)",
    namePlateStroke: "rgba(255,255,255,0.16)",
  },

  paris: {
    base: "#0D3B66",
    letters: "#FFFFFF",
    stroke: "rgba(0,0,0,0.34)",
    collar: "#FFFFFF",
    namePlateFill: "rgba(255,255,255,0.12)",
    namePlateStroke: "rgba(255,255,255,0.16)",
  },

  as_monaco: {
    base: "#FFFFFF",
    letters: "#C31422",
    stroke: "rgba(106,12,24,0.70)",
    collar: "#C31422",
    namePlateFill: "rgba(255,255,255,0.98)",
    namePlateStroke: "rgba(195,20,34,0.22)",
  },

  valencia: {
    base: "#F97316",
    letters: "#111827",
    stroke: "rgba(255,255,255,0.40)",
    collar: "#111827",
    namePlateFill: "rgba(255,255,255,0.92)",
    namePlateStroke: "rgba(0,0,0,0.14)",
  },

  virtus_bologna: {
    base: "#111827",
    letters: "#FDE047",
    stroke: "rgba(0,0,0,0.52)",
    collar: "#FDE047",
    namePlateFill: "rgba(255,255,255,0.12)",
    namePlateStroke: "rgba(253,224,71,0.18)",
  },

  olimpia_milano: {
    base: "#D40F27",
    letters: "#FFFFFF",
    stroke: "rgba(0,0,0,0.34)",
    collar: "#FFFFFF",
    namePlateFill: "rgba(255,255,255,0.12)",
    namePlateStroke: "rgba(255,255,255,0.16)",
  },

  dubai: {
    base: "#0F172A",
    letters: "#F8FAFC",
    stroke: "rgba(0,0,0,0.48)",
    collar: "#F8FAFC",
    namePlateFill: "rgba(255,255,255,0.12)",
    namePlateStroke: "rgba(255,255,255,0.16)",
  },

  hapoel_tel_aviv: {
    base: "#C1121F",
    letters: "#FFFFFF",
    stroke: "rgba(0,0,0,0.34)",
    collar: "#FFFFFF",
    namePlateFill: "rgba(255,255,255,0.12)",
    namePlateStroke: "rgba(255,255,255,0.16)",
  },
};

function getTheme(teamKey?: string | null, teamName?: string): Theme {
  const k = normalizeTeamKey(teamKey, teamName);
  return (
    THEMES[k] ?? {
      base: "#111827",
      letters: "#F8FAFC",
      stroke: "rgba(0,0,0,0.45)",
      collar: "#F8FAFC",
      namePlateFill: "rgba(255,255,255,0.12)",
      namePlateStroke: "rgba(255,255,255,0.16)",
    }
  );
}

export function JerseyAvatar({
  playerName,
  number,
  teamName,
  teamKey,
  size = 88,
  className = "",
}: Props) {
  const theme = getTheme(teamKey ?? null, teamName);
  const px = `${size}px`;

  const last = upper(surnameOnly(playerName));
  const [t1, t2] = splitTeamTwoLines(upper(teamName));

  const isSmall = size <= 88;
  const isVerySmall = size <= 76;

  const nameSize = fitFontPx(
    Math.round(size * (isVerySmall ? 0.167 : isSmall ? 0.175 : 0.188)),
    isVerySmall ? 9 : 10,
    19,
    last,
    isVerySmall ? 7 : 8
  );

  const teamSize1 = fitFontPx(
    Math.round(size * (isVerySmall ? 0.114 : isSmall ? 0.121 : 0.132)),
    isVerySmall ? 7 : 8,
    14,
    t1,
    isVerySmall ? 8 : 9
  );

  const teamSize2 = fitFontPx(
    Math.round(size * (isVerySmall ? 0.111 : isSmall ? 0.118 : 0.128)),
    isVerySmall ? 7 : 8,
    14,
    t2,
    isVerySmall ? 8 : 9
  );

  const numSize = clamp(Math.round(size * (isVerySmall ? 0.56 : 0.60)), 24, 48);

  const nText = String(number ?? "").trim();
  const showStripes = !!theme.stripes;

  const nameTextLen = textLenForName(last);
  const team1TextLen = textLenForTeam(t1);
  const team2TextLen = textLenForTeam(t2);

  return (
    <div
      className={`relative ${className}`}
      style={{ width: px, height: px }}
      aria-label={`${playerName} ${number} ${teamName}`}
    >
      <svg viewBox="0 0 128 128" width={size} height={size} className="block">
        <defs>
          <filter id="avatarShadow" x="-40%" y="-40%" width="180%" height="190%">
            <feDropShadow dx="0" dy="7" stdDeviation="5.5" floodColor="rgba(0,0,0,0.20)" />
            <feDropShadow dx="0" dy="2.5" stdDeviation="2" floodColor="rgba(0,0,0,0.10)" />
          </filter>

          <filter id="printShadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="0.55" stdDeviation="0.45" floodColor="rgba(0,0,0,0.10)" />
          </filter>

          <pattern id="fabric" width="7" height="7" patternUnits="userSpaceOnUse">
            <rect width="7" height="7" fill="rgba(255,255,255,0.006)" />
            <path d="M0 3.5 L7 3.5" stroke="rgba(255,255,255,0.038)" strokeWidth="0.58" />
            <path d="M3.5 0 L3.5 7" stroke="rgba(0,0,0,0.032)" strokeWidth="0.58" />
          </pattern>

          <linearGradient id="bodyLight" x1="18" y1="10" x2="110" y2="124" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="rgba(255,255,255,0.08)" />
            <stop offset="0.42" stopColor="rgba(255,255,255,0.018)" />
            <stop offset="1" stopColor="rgba(0,0,0,0.06)" />
          </linearGradient>

          <radialGradient id="chestGlow" cx="60" cy="44" r="42" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="rgba(255,255,255,0.05)" />
            <stop offset="1" stopColor="rgba(255,255,255,0)" />
          </radialGradient>

          <linearGradient id="sideShadeL" x1="18" y1="28" x2="42" y2="112" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="rgba(255,255,255,0.018)" />
            <stop offset="1" stopColor="rgba(0,0,0,0.045)" />
          </linearGradient>

          <linearGradient id="sideShadeR" x1="110" y1="28" x2="86" y2="112" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="rgba(255,255,255,0.012)" />
            <stop offset="1" stopColor="rgba(0,0,0,0.05)" />
          </linearGradient>

          <clipPath id="jerseyClip">
            <path d="M35 15 C40 10 48 8 64 8 C80 8 88 10 93 15 L109 27 C113 30 115 35 114 40 L107 57 L106 116 C106 120 103 123 99 123 L29 123 C25 123 22 120 22 116 L21 57 L14 40 C13 35 15 30 19 27 Z" />
          </clipPath>

          <path id="nameCurve" d="M31 46 C45 41.2, 83 41.2, 97 46" />
          <path id="teamCurve1" d="M35 106.5 C47 104.2, 81 104.2, 93 106.5" />
          <path id="teamCurve2" d="M36.5 118 C48.5 116.4, 79.5 116.4, 91.5 118" />
        </defs>

        <g filter="url(#avatarShadow)">
          <path
            d="M35 15 C40 10 48 8 64 8 C80 8 88 10 93 15 L109 27 C113 30 115 35 114 40 L107 57 L106 116 C106 120 103 123 99 123 L29 123 C25 123 22 120 22 116 L21 57 L14 40 C13 35 15 30 19 27 Z"
            fill={theme.base}
          />

          <g clipPath="url(#jerseyClip)">
            {showStripes && theme.stripes && (
              <g opacity="1">
                <path d="M29 8 H38 V124 H29 Z" fill={theme.stripes} />
                <path d="M46 8 H55 V124 H46 Z" fill={theme.stripes} />
                <path d="M63 8 H72 V124 H63 Z" fill={theme.stripes} />
                <path d="M80 8 H89 V124 H80 Z" fill={theme.stripes} />
                <path d="M97 8 H106 V124 H97 Z" fill={theme.stripes} />
              </g>
            )}

            <rect x="0" y="0" width="128" height="128" fill="url(#bodyLight)" />
            <rect x="0" y="0" width="128" height="128" fill="url(#chestGlow)" />
            <rect x="0" y="0" width="128" height="128" fill="url(#fabric)" opacity="0.16" />

            <path d="M22 22 C28 16 34 14 42 12 L42 123 L28 123 C24 123 22 120 22 116 Z" fill="url(#sideShadeL)" />
            <path d="M90 12 C101 14 107 18 114 31 L106 123 L94 123 Z" fill="url(#sideShadeR)" />
            <path d="M26 118 C38 116.4 49 116 64 116 C79 116 90 116.4 102 118 L102 123 L26 123 Z" fill="rgba(0,0,0,0.025)" />
          </g>

          <path
            d="M35 15 C40 10 48 8 64 8 C80 8 88 10 93 15 L109 27 C113 30 115 35 114 40 L107 57 L106 116 C106 120 103 123 99 123 L29 123 C25 123 22 120 22 116 L21 57 L14 40 C13 35 15 30 19 27 Z"
            fill="none"
            stroke="rgba(255,255,255,0.07)"
            strokeWidth="1"
          />

          <path
            d="M44 16 C48 13 55 12 64 12 C73 12 80 13 84 16 C81 21 74 25 64 25 C54 25 47 21 44 16 Z"
            fill={theme.collar ?? "#FFFFFF"}
            opacity="0.98"
          />

          <path
            d="M46.5 16.6 C50 14.8 56 14 64 14 C72 14 78 14.8 81.5 16.6"
            stroke="rgba(255,255,255,0.18)"
            strokeWidth="0.8"
            fill="none"
          />

          <rect
            x="33.5"
            y="28"
            width="61"
            height="13.2"
            rx="6.6"
            fill={theme.namePlateFill ?? "rgba(255,255,255,0.12)"}
            stroke={theme.namePlateStroke ?? "rgba(255,255,255,0.16)"}
            strokeWidth="0.8"
            opacity="0.99"
          />

          <g filter="url(#printShadow)">
            <text
              textAnchor="middle"
              fontSize={nameSize}
              fontWeight="900"
              letterSpacing={last.length > 13 ? 0.18 : last.length > 10 ? 0.38 : 0.7}
              fill={theme.letters}
              style={{
                paintOrder: "stroke",
                stroke: theme.stroke,
                strokeWidth: 2.7,
              }}
              textLength={nameTextLen}
              lengthAdjust="spacingAndGlyphs"
            >
              <textPath href="#nameCurve" startOffset="50%">
                {last}
              </textPath>
            </text>
          </g>

          <g filter="url(#printShadow)">
            <text
              x="64"
              y="87"
              textAnchor="middle"
              fontSize={numSize}
              fontWeight="900"
              fill={theme.letters}
              style={{
                paintOrder: "stroke",
                stroke: theme.stroke,
                strokeWidth: 4.35,
                letterSpacing: "-0.04em",
              }}
            >
              {nText || " "}
            </text>
          </g>

          <g filter="url(#printShadow)">
            <text
              textAnchor="middle"
              fontSize={teamSize1}
              fontWeight="800"
              letterSpacing={t1.length > 12 ? 0.14 : t1.length > 9 ? 0.3 : 0.58}
              fill={theme.letters}
              style={{
                paintOrder: "stroke",
                stroke: theme.stroke,
                strokeWidth: 1.22,
              }}
              textLength={team1TextLen}
              lengthAdjust="spacingAndGlyphs"
            >
              <textPath href="#teamCurve1" startOffset="50%">
                {t1}
              </textPath>
            </text>

            {t2 && (
              <text
                textAnchor="middle"
                fontSize={teamSize2}
                fontWeight="800"
                letterSpacing={t2.length > 12 ? 0.14 : t2.length > 9 ? 0.3 : 0.58}
                fill={theme.letters}
                style={{
                  paintOrder: "stroke",
                  stroke: theme.stroke,
                  strokeWidth: 1.18,
                }}
                textLength={team2TextLen}
                lengthAdjust="spacingAndGlyphs"
              >
                <textPath href="#teamCurve2" startOffset="50%">
                  {t2}
                </textPath>
              </text>
            )}
          </g>
        </g>
      </svg>
    </div>
  );
}

export default JerseyAvatar;