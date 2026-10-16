import assert from 'node:assert/strict';
import { popupViewport, webViewport, viewportName } from './viewport.ts';

export const viewport = { name: viewportName, ...webViewport };
export const selectionOf = report => report.run.results.filter(test => test.kind === 'test' && test.selected)
  .map(test => ({ id: test.id, testId: test.testId, targetId: test.targetId,
    attemptIds: test.attempts.map(attempt => attempt.id) })).sort((a, b) => a.id.localeCompare(b.id));

export function assertViewportEvidence(report, observations) {
  const selected = selectionOf(report);
  assert.ok(selected.length, 'Viewport gate selected no tests');
  assert.ok(observations.length, 'Actual viewport observations are missing');
  const attempts = new Set(selected.flatMap(test => test.attemptIds));
  for (const test of selected) {
    assert.equal(test.targetId, viewportName, 'Actual test target does not match viewport');
    assert.equal(test.attemptIds.length, 1, 'Required test did not use one attempt');
    assert.ok(observations.some(value => value.attemptId === test.attemptIds[0]), 'Actual attempt has no viewport readback');
  }
  for (const value of observations) {
    assert.ok(attempts.has(value.attemptId), 'Viewport evidence belongs to an unselected attempt');
    assert.equal(value.viewport, viewportName, 'Viewport readback belongs to a different target');
    assert.ok(['popup', 'auth', 'school'].includes(value.role), 'Unknown viewport surface');
    const expected = value.role === 'popup' ? popupViewport : webViewport;
    assert.deepEqual(value.expected, expected, 'Viewport evidence has a different expected size');
    assert.equal(value.actual.width, expected.width, 'Actual viewport width mismatch');
    assert.equal(value.actual.height, expected.height, 'Actual viewport height mismatch');
  }
}

export function assertRunEvidence(runtime, report, discovery, suite) {
  assert.deepEqual(runtime.viewport, viewport, 'Runtime viewport identity mismatch');
  assert.deepEqual(report.run.viewport, viewport, 'Report viewport identity mismatch');
  const selected = selectionOf(report);
  const pairs = discovery.pairs.filter(pair => pair.kind === 'test' && pair.disposition === 'run');
  assert.ok(discovery.all?.length, 'Unfiltered framework discovery is missing');
  assert.ok(pairs.every(pair => discovery.all.some(full => full.id === pair.id)), 'Selected discovery contains an unknown test');
  assert.deepEqual(selected.map(test => test.id).sort(), pairs.map(pair => pair.id).sort(), 'Actual test IDs differ from discovery');
  if (suite) {
    assert.ok(['core', 'devices', 'all'].includes(suite), 'Unknown required suite');
    const expected = discovery.all.filter(pair => pair.kind === 'test' && (suite === 'all' ||
      pair.titlePath.join(' ').startsWith('QUICKLOGIN-03 ') === (suite === 'devices')));
    assert.deepEqual(selected.map(test => test.id).sort(), expected.map(pair => pair.id).sort(), 'Actual test IDs do not cover the required suite');
  }
  assert.deepEqual(runtime.selection, selected, 'Runtime and actual selected tests disagree');
  assert.ok(pairs.every(pair => pair.target === viewportName), 'Discovery contains a different viewport');
  assertViewportEvidence(report, runtime.viewportObservations ?? []);
  for (const test of report.run.results.filter(test => test.kind === 'test' && test.selected)) {
    assert.equal(test.status, 'passed', 'Required actual test did not pass');
    const [attempt] = test.attempts;
    assert.equal(attempt.status, 'passed');
    assert.equal(attempt.cleanup, 'complete', 'Actual attempt cleanup is incomplete');
    assert.deepEqual(attempt.secondaryErrors, [], 'Actual attempt has a secondary error');
  }
  return selected.map(({ id, testId, targetId }) => ({ id, testId, targetId }));
}
