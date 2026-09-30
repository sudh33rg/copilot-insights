import type { Outcomes } from '../../shared/dto';
import { formatCredits, formatInt, formatPercent } from '../ui/format';
import { Measure, type MeasureLike } from '../ui/Measure';

const int = (value: number | string) => formatInt(Number(value));
const signed = (value: number | string) => {
  const number = Number(value);
  if (number === 0) return '0';
  return `${number > 0 ? '+' : '−'}${formatInt(Math.abs(number))}`;
};
const plus = (value: number | string) => `+${formatInt(Number(value))}`;
const minus = (value: number | string) => `−${formatInt(Number(value))}`;

const testResult = (outcomes: Outcomes): MeasureLike => ({
  value: outcomes.lastTestPassed.value === null ? null : outcomes.lastTestPassed.value ? 'Passed' : 'Failed',
  provenance: outcomes.lastTestPassed.provenance,
});

const observedAnything = (outcomes: Outcomes): boolean =>
  outcomes.commits.length > 0 ||
  [
    outcomes.linesAdded,
    outcomes.linesRemoved,
    outcomes.editsKept,
    outcomes.editsUndone,
    outcomes.editsUserModified,
    outcomes.editKeepRate,
    outcomes.laterSurvival,
    outcomes.terminalRuns,
    outcomes.terminalFailures,
    outcomes.testRuns,
    outcomes.testFailures,
    outcomes.lastTestPassed,
    outcomes.errorsDelta,
    outcomes.warningsDelta,
  ].some((measure) => measure.value !== null);

/** What the session achieved, from evidence VS Code observed and Copilot reported. Missing evidence shows as —. */
export function OutcomeCard({ outcomes }: { outcomes: Outcomes }) {
  return (
    <section className="card" aria-label="Outcome">
      <h3>Outcome</h3>
      {!observedAnything(outcomes) && (
        <p className="muted">Outcome evidence is collected only while VS Code is open with this extension.</p>
      )}
      <dl className="facts">
        <dt>Lines changed</dt>
        <dd>
          <Measure measure={outcomes.linesAdded} format={plus} />{' '}
          <Measure measure={outcomes.linesRemoved} format={minus} />
        </dd>
        <dt>Edits kept</dt>
        <dd>
          <Measure measure={outcomes.editsKept} format={int} />
        </dd>
        <dt>Edits undone</dt>
        <dd>
          <Measure measure={outcomes.editsUndone} format={int} />
        </dd>
        <dt>Edits modified by you</dt>
        <dd>
          <Measure measure={outcomes.editsUserModified} format={int} />
        </dd>
        <dt>Keep rate</dt>
        <dd>
          <Measure measure={outcomes.editKeepRate} format={(value) => formatPercent(Number(value))} />
        </dd>
        <dt>Later survival</dt>
        <dd>
          <Measure measure={outcomes.laterSurvival} format={(value) => formatPercent(Number(value))} />
        </dd>
        <dt>Terminal runs</dt>
        <dd>
          <Measure measure={outcomes.terminalRuns} format={int} />
        </dd>
        <dt>Failed runs</dt>
        <dd>
          <Measure measure={outcomes.terminalFailures} format={int} />
        </dd>
        <dt>Test runs</dt>
        <dd>
          <Measure measure={outcomes.testRuns} format={int} />
        </dd>
        <dt>Last test run</dt>
        <dd>
          <Measure measure={testResult(outcomes)} />
        </dd>
        <dt>Diagnostics errors</dt>
        <dd>
          <Measure measure={outcomes.errorsDelta} format={signed} />
        </dd>
        <dt>Diagnostics warnings</dt>
        <dd>
          <Measure measure={outcomes.warningsDelta} format={signed} />
        </dd>
        <dt>Commits</dt>
        <dd>
          {outcomes.commits.length === 0 ? (
            '—'
          ) : (
            <ul className="commits">
              {outcomes.commits.map((commit) => (
                <li key={commit.hash}>
                  <code>{commit.hash.slice(0, 7)}</code>{' '}
                  <Measure measure={commit.credits} format={(value) => formatCredits(Number(value))} />{' '}
                  <span className="muted">
                    {commit.overlapFiles} of {commit.editedFiles} edited files
                  </span>
                </li>
              ))}
            </ul>
          )}
        </dd>
      </dl>
    </section>
  );
}
