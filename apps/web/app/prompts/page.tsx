import { CONTEXT_STRATEGY_DESCRIPTORS, CONTEXT_STRATEGIES, outputContract } from '@tob/core';
import { listPrompts } from '@tob/db';
import { Empty, Note } from '@/components/Stat';
import { db } from '@/lib/db';

export const dynamic = 'force-static';

export default function PromptsPage() {
  const prompts = listPrompts(db());

  return (
    <>
      <h1>Prompts</h1>
      <p className="lede">
        The reasoning instructions are yours to write. The output contract below is appended by the
        benchmark to every prompt, so responses stay machine-scoreable no matter what the prompt
        says.
      </p>

      {prompts.length === 0 ? (
        <Empty>No prompts yet. Run `pnpm seed`.</Empty>
      ) : (
        prompts.map((prompt) => (
          <section key={prompt.id}>
            <h2>
              {prompt.name} <span className="muted">v{prompt.version}</span>{' '}
              <span className="pill mono">{prompt.contentHash.slice(0, 12)}</span>
            </h2>
            <p className="lede">{prompt.description}</p>
            <pre>{prompt.content}</pre>
          </section>
        ))
      )}

      <h2>Output contract</h2>
      <Note>
        Editing a prompt appends a version rather than overwriting it, and each run snapshots the
        exact text it used — so a past run's numbers always refer to the prompt that produced them.
      </Note>
      <pre>{outputContract('FORCED')}</pre>

      <h2>Context strategies</h2>
      <p className="lede">
        How much of the case the model is shown. Ablating across these separates understanding the
        test from pattern-matching the diff.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Strategy</th>
              <th>Test</th>
              <th>Diff</th>
              <th className="wrap">What it measures</th>
            </tr>
          </thead>
          <tbody>
            {CONTEXT_STRATEGIES.map((strategy) => {
              const descriptor = CONTEXT_STRATEGY_DESCRIPTORS[strategy];
              return (
                <tr key={strategy}>
                  <td className="mono">{strategy}</td>
                  <td className="muted">{descriptor.includesTest ? 'yes' : 'no'}</td>
                  <td className="muted">{descriptor.includesDiff ? 'yes' : 'no'}</td>
                  <td className="wrap muted">{descriptor.description}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Note>
        No strategy may execute the test, run the application, or use a runtime observation. The
        prediction path is execution-free by construction.
      </Note>
    </>
  );
}
