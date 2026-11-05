"use client";

import React from "react";
import { Latex } from "../components/ui";
import { RendererProps, SignTableContent } from "../types/exercise";

const SignTableRenderer: React.FC<RendererProps<SignTableContent>> = ({
  content,
  variables,
}) => {
  const { points } = content;

  return (
    <div className="p-5 bg-white rounded-2xl shadow-sm border border-gray-200 overflow-x-auto">
      <table className="w-full min-w-[300px] border-collapse text-center">
        <thead>
          <tr>
            <th className="border border-gray-300 bg-slate-50 p-2 w-16">
              <Latex>x</Latex>
            </th>
            {points.map((point, i) => (
              <th key={i} className="border border-gray-300 bg-slate-50 p-2">
                <Latex>{point.x}</Latex>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="border border-gray-300 bg-slate-50 p-2 font-bold">
              <Latex>f(x)</Latex>
            </td>
            {points.map((point, i) => (
              <td
                key={i}
                className="border border-gray-300 p-2 text-xl font-bold"
              >
                {point.sign === "+" && (
                  <span className="text-green-600">+</span>
                )}
                {point.sign === "-" && <span className="text-red-600">−</span>}
                {point.sign === "0" && (
                  <span className="text-slate-800">0</span>
                )}
                {/* Double barre pour valeur interdite (ex: ||) */}
                {point.sign === "||" && (
                  <span className="text-slate-800 border-l-2 border-r-2 border-slate-800 h-6 inline-block mx-2"></span>
                )}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
};

export default SignTableRenderer;
