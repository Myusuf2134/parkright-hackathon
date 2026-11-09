import { describe, expect, it } from 'vitest';
import { isUsableForecast, upcoming, validateClasses } from './model.ts';

describe('Your Day truth and privacy contracts', () => {
  it('accepts only well-formed user-entered classes', () => {
    const result = validateClasses([
      { id: 'ok', course: 'CSE 2421', building: 'Dreese Labs', startsAt: '2026-11-09T15:00:00.000Z' },
      { id: 'bad', course: '', building: 'Ohio Union', startsAt: 'invalid' },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].course).toBe('CSE 2421');
  });

  it('never creates classes when none were supplied', () => {
    expect(upcoming([], new Date('2026-11-09T12:00:00Z'))).toEqual([]);
  });

  it('excludes past classes and orders future classes', () => {
    const classes = validateClasses([
      { id: 'later', course: 'CSE 1', building: 'Dreese', startsAt: '2026-11-09T16:00:00Z' },
      { id: 'earlier', course: 'CSE 2', building: 'Dreese', startsAt: '2026-11-09T14:00:00Z' },
      { id: 'past', course: 'CSE 3', building: 'Dreese', startsAt: '2026-11-09T10:00:00Z' },
    ]);
    expect(upcoming(classes, new Date('2026-11-09T12:00:00Z')).map((c) => c.id)).toEqual(['earlier', 'later']);
  });

  it('treats expired or non-NWS forecasts as unavailable', () => {
    const forecast = {
      status: 'available' as const, kind: 'forecast' as const, location: 'OSU',
      source: 'National Weather Service', checked_at: '2026-11-09T12:00:00Z',
      expires_at: '2026-11-09T12:10:00Z', forecast_at: '2026-11-09T13:00:00Z',
      temperature_f: 53, summary: 'Cloudy',
      source_url: 'https://api.weather.gov/gridpoints/ILN/1,2/forecast', reason: null,
    };
    expect(isUsableForecast(forecast, new Date('2026-11-09T12:05:00Z'))).toBe(true);
    expect(isUsableForecast(forecast, new Date('2026-11-09T12:11:00Z'))).toBe(false);
    expect(isUsableForecast({ ...forecast, source_url: 'https://api.weather.gov.evil.example/' }, new Date('2026-11-09T12:05:00Z'))).toBe(false);
  });
});
