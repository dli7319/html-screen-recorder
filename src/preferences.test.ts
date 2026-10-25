import { beforeEach, describe, expect, it } from 'vitest';
import { getRecordOnShare, setRecordOnShare } from './preferences';

describe('record-on-share preference', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to on when it has never been set', () => {
    expect(getRecordOnShare()).toBe(true);
  });

  it('remembers an opt-out', () => {
    setRecordOnShare(false);
    expect(getRecordOnShare()).toBe(false);
  });

  it('remembers turning it back on', () => {
    setRecordOnShare(false);
    setRecordOnShare(true);
    expect(getRecordOnShare()).toBe(true);
  });

  it('treats only a stored "false" as off', () => {
    localStorage.setItem('html-screen-recorder:recordOnShare', 'false');
    expect(getRecordOnShare()).toBe(false);
    localStorage.setItem('html-screen-recorder:recordOnShare', 'true');
    expect(getRecordOnShare()).toBe(true);
  });
});
