"use client";

import React, { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell
} from "recharts";

interface StackedChartProps {
  games: Array<Record<string, number>>;
  lines: number[];
  sides: ("over" | "under")[];
}

export default function StackedChart({ games, lines, sides }: StackedChartProps) {

  const data = useMemo(() => {

    return games.slice(-20).map((game, gameIdx) => {

      const entry: any = { name: gameIdx + 1 };

      sides.forEach((side, idx) => {

        const val = game[`stat_${idx}`] || 0;

        const isGreen =
          side === "over"
            ? val > lines[idx]
            : val < lines[idx];

        entry[`prop${idx}`] = val;
        entry[`color${idx}`] = isGreen
          ? "#4ade80"
          : "#f87171";

      });

      return entry;

    });

  }, [games, lines, sides]);

  return (

    <ResponsiveContainer width="100%" height={200}>

      <BarChart data={data} stackOffset="sign">

        <CartesianGrid
          strokeDasharray="3 3"
          stroke="#374151"
        />

        <XAxis
          dataKey="name"
          stroke="#9ca3af"
        />

        <YAxis
          stroke="#9ca3af"
        />

        <Tooltip
          contentStyle={{
            backgroundColor: "#1f2937",
            border: "none"
          }}
          labelStyle={{ color: "#fff" }}
          itemStyle={{ color: "#fff" }}
        />

        {sides.map((_, idx) => (

          <Bar
            key={idx}
            dataKey={`prop${idx}`}
            stackId="a"
          >

            {data.map((entry, i) => (

              <Cell
                key={i}
                fill={entry[`color${idx}`]}
              />

            ))}

          </Bar>

        ))}

      </BarChart>

    </ResponsiveContainer>

  );

}