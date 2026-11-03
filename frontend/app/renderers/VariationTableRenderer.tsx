"use client";

import React from "react";
import { Latex } from "../components/ui";
import { RendererProps, VariationTableContent } from "../types/exercise";

const VariationTableRenderer: React.FC<
  RendererProps<VariationTableContent>
> = ({ content, variables }) => {
  const { points } = content;

  const Arrow = ({ direction }: { direction: "up" | "down" }) => (
    <div
      className={`text-2xl ${direction === "up" ? "text-green-500 mb-2 rotate-[-45deg]" : "text-red-500 mt-2 rotate-[45deg]"}`}
    >
      ➜
    </div>
  );

  return (
    <div className="p-5 bg-white rounded-2xl shadow-sm border border-gray-200 overflow-x-auto">
      <table className="w-full min-w-[300px] border-collapse">
        {/* Ligne des X */}
        <thead>
          <tr>
            <th className="border border-gray-300 bg-slate-50 p-2 w-16">
              <Latex>x</Latex>
            </th>
            {points.map((point, i) => (
              <th
                key={i}
                className="border border-gray-300 bg-slate-50 p-2 min-w-[80px]"
              >
                <Latex>{point.x}</Latex>
              </th>
            ))}
          </tr>
        </thead>

        {/* Ligne des variations de f(x) */}
        <tbody>
          <tr>
            <td className="border border-gray-300 bg-slate-50 p-2 font-bold text-center">
              <Latex>f(x)</Latex>
            </td>
            {points.map((point, i) => {
              const val = point.value
                ? point.value
                : "";
              const isLast = i === points.length - 1;

              return (
                <td
                  key={i}
                  className="border border-gray-300 p-2 h-24 align-middle relative"
                >
                  <div className="flex flex-col items-center justify-between h-full w-full">
                    {/* Haut */}
                    <div className="h-6">
                      {point.variation === "croissante" && val && (
                        <Latex>{val}</Latex>
                      )}
                      {!point.variation && val && <Latex>{val}</Latex>}{" "}
                      {/* Cas stable */}
                    </div>

                    {/* Centre (Flèches) */}
                    <div className="absolute inset-0 flex items-center justify-end pr-2 pointer-events-none">
                      {!isLast && point.variation === "croissante" && (
                        <Arrow direction="up" />
                      )}
                      {!isLast && point.variation === "décroissante" && (
                        <Arrow direction="down" />
                      )}
                    </div>

                    {/* Bas */}
                    <div className="h-6">
                      {point.variation === "décroissante" && val && (
                        <Latex>{val}</Latex>
                      )}
                    </div>
                  </div>
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
};

export default VariationTableRenderer;
