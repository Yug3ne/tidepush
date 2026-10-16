import type { ReactNode } from "react";
import { formatInt, formatPercent } from "../lib/format";

export interface BarRow {
  key: string;
  cells: ReactNode[];
  value: number;
  /** Hover tooltip for the whole row. */
  title: string;
}

/**
 * A table with one horizontal-bar column (single series: accent on a same-hue track).
 * Value labels stay in text colour; share is relative to `total`.
 */
export function BarTable({
  caption,
  headers,
  rows,
  total,
  valueLabel = "Devices",
}: {
  caption: string;
  headers: string[];
  rows: BarRow[];
  total: number;
  valueLabel?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="table-wrap">
      <table className="data stackable">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
            <th scope="col" className="bar-col">
              {valueLabel}
            </th>
            <th scope="col" className="num">
              Share
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} title={r.title}>
              {r.cells.map((c, i) => (
                <td key={i} data-label={headers[i]}>
                  {c}
                </td>
              ))}
              <td className="bar-col" data-label={valueLabel}>
                <div className="bar-cell">
                  <div className="bar-track" aria-hidden="true">
                    <div className="bar-fill" style={{ width: `${(r.value / max) * 100}%` }} />
                  </div>
                  <span className="bar-value">{formatInt(r.value)}</span>
                </div>
              </td>
              <td className="num" data-label="Share">
                {formatPercent(r.value, total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
