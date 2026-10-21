import { engagementListPath, entityListPath, myEngagementsHref } from '../list-paths';

describe('list paths', () => {
  it('writes the client list query, section last and in canonical order', () => {
    expect(entityListPath({ limit: 25, offset: 0 })).toBe('/entities?limit=25&offset=0');
    expect(
      entityListPath({ limit: 25, offset: 50, search: 'Acme & Co', sections: ['income_tax', 'gst'] }),
    ).toBe('/entities?limit=25&offset=50&search=Acme+%26+Co&section=gst,income_tax');
    expect(entityListPath({ limit: 25, offset: 0, missing: 'pan', sections: ['gst'] })).toBe(
      '/entities?limit=25&offset=0&missing=pan&section=gst',
    );
    expect(entityListPath({ limit: 25, offset: 0, missing: null })).toBe('/entities?limit=25&offset=0');
  });

  it('writes the engagement list query, dropping empty filters', () => {
    expect(engagementListPath({ limit: 25, offset: 0, status: '', kind: '', mine: false, sections: [] })).toBe(
      '/engagements?limit=25&offset=0',
    );
    expect(
      engagementListPath({ limit: 8, offset: 0, status: 'active', mine: true, sections: ['statutory_audit'] }),
    ).toBe('/engagements?limit=8&offset=0&status=active&mine=true&section=statutory_audit');
  });

  it('links the home panel to the engagements page in the same section', () => {
    expect(myEngagementsHref([])).toBe('/engagements?mine=true');
    expect(myEngagementsHref(['gst'])).toBe('/engagements?mine=true&section=gst');
  });
});
