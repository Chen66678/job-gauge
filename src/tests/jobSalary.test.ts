import { describe, expect, it } from 'vitest';
import { parseSalaryText } from '../domain/jobSalary';

describe('parseSalaryText', () => {
  it('parses monthly ranges with K suffix', () => {
    expect(parseSalaryText('20-30K')).toEqual([20, 30]);
    expect(parseSalaryText('15-25K·13薪')).toEqual([15, 25]);
    expect(parseSalaryText(' 8-12k ')).toEqual([8, 12]);
  });

  it('parses single monthly values', () => {
    expect(parseSalaryText('20K以上')).toEqual([20, 20]);
  });

  it('converts daily rates to estimated monthly K', () => {
    expect(parseSalaryText('300-400元/天')).toEqual([7, 9]);
    expect(parseSalaryText('300元/天')).toEqual([7, 7]);
  });

  it('returns null for negotiable or unknown salary', () => {
    expect(parseSalaryText('面议')).toBeNull();
    expect(parseSalaryText('薪资未披露')).toBeNull();
    expect(parseSalaryText(null)).toBeNull();
    expect(parseSalaryText(undefined)).toBeNull();
    expect(parseSalaryText('')).toBeNull();
    expect(parseSalaryText('有竞争力的薪资')).toBeNull();
  });

  it('normalizes reversed ranges and rejects zero-zero', () => {
    expect(parseSalaryText('30-20K')).toEqual([20, 30]);
    expect(parseSalaryText('0-0K')).toBeNull();
  });
});
