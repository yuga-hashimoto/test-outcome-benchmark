import { percent } from '@/lib/format';
import type { ModelPromptMatrix } from '@tob/core';

/**
 * Model × prompt matrix. Colour is scaled between the lowest and highest cell
 * present rather than 0–100%, because the interesting variation between
 * configurations is usually a few points wide and would otherwise be invisible.
 */
export function Heatmap({ matrix }: { matrix: ModelPromptMatrix }) {
  const values = matrix.cells
    .map((cell) => cell.value)
    .filter((value): value is number => value !== null);

  if (values.length === 0) {
    return <div className="empty">No completed runs to plot yet.</div>;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const intensity = (value: number): number => (max === min ? 0.5 : (value - min) / (max - min));

  const cellFor = (modelConfigId: string, promptId: string) =>
    matrix.cells.find((cell) => cell.modelConfigId === modelConfigId && cell.promptId === promptId);

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Model</th>
            {matrix.prompts.map((prompt) => (
              <th key={prompt.id} className="num">
                {prompt.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.models.map((model) => (
            <tr key={model.id}>
              <td>{model.label}</td>
              {matrix.prompts.map((prompt) => {
                const cell = cellFor(model.id, prompt.id);
                const value = cell?.value ?? null;
                return (
                  <td
                    key={prompt.id}
                    className="num"
                    style={
                      value === null
                        ? undefined
                        : {
                            background: `color-mix(in srgb, var(--accent) ${12 + intensity(value) * 45}%, transparent)`,
                          }
                    }
                  >
                    {value === null ? <span className="muted">—</span> : percent(value)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
