import { isExactLanding, telemetryPath } from '@hsdg/contracts';
import { classifyChange, isNewRoute, rowOpenFrom, sourceOf } from '@/lib/telemetry';
import { changeOf, formatMeasure } from '@/components/reports/workflow-measures';

const ENG = '/engagements/7f1c2a9e-3b4d-4c5e-8f6a-0b1c2d3e4f5a';

describe('telemetryPath — no content leaves the browser', () => {
  it('replaces ids and keeps only parameter names', () => {
    expect(
      telemetryPath(`${ENG}?tab=gst&fy=2026-27&gstin=19AAACB1234C1Z5&m=9&part=outward`),
    ).toEqual({
      path: '/engagements/:id',
      params: ['fy', 'gstin', 'm', 'part', 'tab'],
    });
  });

  it('treats anything that is not a plain word as an id', () => {
    expect(telemetryPath('/entities/12345/edit').path).toBe('/entities/:id/edit');
    expect(telemetryPath('/search?q=bharat%20gstr1').params).toEqual(['q']);
    expect(telemetryPath('/').path).toBe('/');
  });

  it('knows an exact landing', () => {
    expect(isExactLanding(['m', 'part', 'tab'])).toBe(true);
    expect(isExactLanding(['open'])).toBe(true);
    expect(isExactLanding(['tab'])).toBe(false);
  });
});

describe('rowOpenFrom', () => {
  it('an engagement opened from a list is a row open from that list', () => {
    expect(rowOpenFrom('/today', `${ENG}?tab=gst&part=outward`)).toEqual({ source: 'today' });
    expect(rowOpenFrom('/my-work?tab=tasks', ENG)).toEqual({ source: 'my-work' });
    expect(rowOpenFrom('/', ENG)).toEqual({ source: 'home' });
  });

  it('moving inside the engagement is not', () => {
    expect(rowOpenFrom(`${ENG}?tab=gst`, `${ENG}?tab=gst&m=9`)).toBeNull();
    expect(rowOpenFrom(`${ENG}/edit`, ENG)).toBeNull();
    expect(rowOpenFrom(null, ENG)).toBeNull();
    expect(rowOpenFrom('/today', '/engagements/new')).toBeNull();
  });

  it('the filing drawer opened in place is a row open', () => {
    expect(rowOpenFrom('/filing-runs/r1', '/filing-runs/r1?open=i1')).toEqual({
      source: 'filing-runs',
    });
    expect(rowOpenFrom('/filing-runs/r1?open=i1', '/filing-runs/r1?open=i2')).toBeNull();
  });

  it('a source is a plain word', () => {
    expect(sourceOf('/Client_Dependencies!')).toBe('client_dependencies');
  });
});

describe('isNewRoute', () => {
  it('a new page or a new set of parameters is a step; a new value is not', () => {
    expect(isNewRoute(null, '/today')).toBe(true);
    expect(isNewRoute('/today', '/my-work')).toBe(true);
    expect(isNewRoute(`${ENG}?tab=gst`, `${ENG}?tab=gst&m=9`)).toBe(true);
    expect(isNewRoute(`${ENG}?tab=gst&m=9`, `${ENG}?tab=gst&m=10`)).toBe(false);
  });
});

describe('workflow measures', () => {
  it('formats values by unit', () => {
    expect(formatMeasure(null, 'steps')).toBe('—');
    expect(formatMeasure(2, 'steps')).toBe('2 steps');
    expect(formatMeasure(93.5, 'percent')).toBe('93.5%');
    expect(formatMeasure(4.25, 'hours')).toBe('4.25 h');
    expect(formatMeasure(0.42, 'hours')).toBe('25 min');
    expect(formatMeasure(0, 'hours')).toBe('< 1 min');
  });

  it('compares with the window before', () => {
    expect(changeOf({ value: 7, previous: 10 })).toBe(-30);
    expect(changeOf({ value: 7, previous: null })).toBeNull();
    expect(changeOf({ value: 7, previous: 0 })).toBeNull();
  });
});

describe('classifyChange — steps are the person’s', () => {
  it('the first page of a load is a step', () => {
    expect(classifyChange(null, '/?landing=1', false)).toBe('route');
  });

  it('a URL the app changes on its own is a redirect, not a step', () => {
    expect(classifyChange('/?landing=1', '/today', false)).toBe('redirect');
    expect(classifyChange(`${ENG}?tab=gst`, `${ENG}?tab=gst&m=9`, false)).toBe('redirect');
  });

  it('a page the person moved to is a step', () => {
    expect(classifyChange('/today', `${ENG}?tab=gst&m=9&part=outward`, true)).toBe('route');
    expect(classifyChange('/compliance/runs?run=x', '/compliance/runs?run=x&open=i1', true)).toBe(
      'route',
    );
  });

  it('the same place with other values is nothing', () => {
    expect(classifyChange(`${ENG}?tab=gst&m=9`, `${ENG}?tab=gst&m=10`, true)).toBeNull();
  });
});
