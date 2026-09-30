import { describe, expect, it } from 'vitest';
import { freshSessionEstimate } from './freshSession';

const turns = (inputs: (number | null)[], systemInitiated: number[] = []) =>
  inputs.map((inputTokens, i) => ({
    index: i + 1,
    inputTokens,
    systemInitiated: systemInitiated.includes(i + 1),
  }));

describe('freshSessionEstimate', () => {
  it('picks the restart point that would have saved the most, against the first request as baseline', () => {
    // baseline 10K; saving(k) = turns from k on × (input_k − 10K): k=4 gives 3 × 30K = 90K of 210K input.
    expect(freshSessionEstimate(turns([10_000, 20_000, 30_000, 40_000, 50_000, 60_000]))).toEqual({
      restartAtTurn: 4,
      tokensSaved: 90_000,
      shareOfInput: 90_000 / 210_000,
    });
  });

  it('never restarts at a system-initiated turn', () => {
    const estimate = freshSessionEstimate(turns([10_000, 20_000, 30_000, 40_000, 50_000, 60_000], [4]));
    expect(estimate?.restartAtTurn).toBe(3);
    expect(estimate?.tokensSaved).toBe(80_000);
  });

  it('skips turns whose input tokens are unknown', () => {
    const estimate = freshSessionEstimate(turns([10_000, 20_000, null, 40_000, 50_000, 60_000]));
    // Known turns: 1,2,4,5,6 → k=4: 3 × 30K = 90K; total input 180K.
    expect(estimate).toEqual({ restartAtTurn: 4, tokensSaved: 90_000, shareOfInput: 0.5 });
  });

  it('is null for a flat session, for too little data, and when the saving is small', () => {
    expect(freshSessionEstimate(turns([10_000, 10_000, 10_000, 10_000, 10_000]))).toBeNull();
    expect(freshSessionEstimate(turns([10_000, 40_000, 80_000]))).toBeNull();
    expect(freshSessionEstimate(turns([10_000, null, null, 80_000, 90_000]))).toBeNull();
    expect(freshSessionEstimate(turns([10_000, 11_000, 12_000, 13_000]))).toBeNull();
    expect(freshSessionEstimate([])).toBeNull();
  });

  it('does not divide by zero when the baseline is zero or input is all zero', () => {
    expect(freshSessionEstimate(turns([0, 0, 0, 0]))).toBeNull();
  });
});
