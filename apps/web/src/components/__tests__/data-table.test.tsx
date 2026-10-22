import { fireEvent, render, screen } from '@testing-library/react';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable, withColumnIds } from '../data-table';
import { workHrefFor } from '@/lib/work-href';

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: jest.fn() }),
}));

interface Row {
  id: string;
  title: string;
}
const columns: ColumnDef<Row, unknown>[] = [
  { header: 'Title', accessorKey: 'title' },
  { header: '', id: 'act', cell: () => <button type="button">Act</button> },
  { header: 'Note', cell: () => <span>note</span> },
];
const rows: Row[] = [{ id: 'r1', title: 'September GSTR-1' }];
const hrefOf = (r: Row) => `/engagements/e1?tab=gst&task=${r.id}`;

beforeEach(() => push.mockClear());

describe('DataTable rowHref (WF-103)', () => {
  it('renders the first cell as a real link', () => {
    render(<DataTable columns={columns} data={rows} rowHref={hrefOf} />);
    expect(screen.getByRole('link', { name: 'September GSTR-1' }).getAttribute('href')).toBe(
      '/engagements/e1?tab=gst&task=r1',
    );
  });

  it('a click elsewhere on the row opens it', () => {
    render(<DataTable columns={columns} data={rows} rowHref={hrefOf} />);
    fireEvent.click(screen.getByText('note'));
    expect(push).toHaveBeenCalledWith('/engagements/e1?tab=gst&task=r1');
  });

  it('Ctrl/Cmd-click and middle-click open a new tab', () => {
    const open = jest.spyOn(window, 'open').mockImplementation(() => null);
    render(<DataTable columns={columns} data={rows} rowHref={hrefOf} />);
    fireEvent.click(screen.getByText('note'), { metaKey: true });
    fireEvent.click(screen.getByText('note'), { ctrlKey: true });
    fireEvent(screen.getByText('note'), new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(open).toHaveBeenCalledTimes(3);
    expect(open).toHaveBeenCalledWith('/engagements/e1?tab=gst&task=r1', '_blank', 'noopener');
    expect(push).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it('a click on a control in the row is left to the control', () => {
    render(<DataTable columns={columns} data={rows} rowHref={hrefOf} />);
    fireEvent.click(screen.getByRole('button', { name: 'Act' }));
    expect(push).not.toHaveBeenCalled();
  });

  it('onRowClick still works without rowHref', () => {
    const onRowClick = jest.fn();
    render(<DataTable columns={columns} data={rows} onRowClick={onRowClick} />);
    fireEvent.click(screen.getByText('note'));
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('DataTable onRowOpen (WF-202)', () => {
  it('a plain click on the row or its link is offered to onRowOpen first', () => {
    const onRowOpen = jest.fn(() => true);
    render(<DataTable columns={columns} data={rows} rowHref={hrefOf} onRowOpen={onRowOpen} />);
    fireEvent.click(screen.getByText('note'));
    fireEvent.click(screen.getByRole('link', { name: 'September GSTR-1' }));
    expect(onRowOpen).toHaveBeenCalledTimes(2);
    expect(push).not.toHaveBeenCalled();
  });

  it('declined (no filing), the row opens its link; a modified click never asks', () => {
    const onRowOpen = jest.fn(() => false);
    const open = jest.spyOn(window, 'open').mockImplementation(() => null);
    render(<DataTable columns={columns} data={rows} rowHref={hrefOf} onRowOpen={onRowOpen} />);
    fireEvent.click(screen.getByText('note'));
    expect(push).toHaveBeenCalledWith('/engagements/e1?tab=gst&task=r1');
    fireEvent.click(screen.getByText('note'), { metaKey: true });
    expect(onRowOpen).toHaveBeenCalledTimes(1);
    open.mockRestore();
  });
});

describe('DataTable column ids', () => {
  // The Client Dependencies crash: an actions column with `header: ''` and no
  // id threw "Columns require an id when using a non-string header" as soon as
  // there was a row.
  it('renders rows when an actions column has no id', () => {
    const noId: ColumnDef<Row, unknown>[] = [
      { header: 'Title', accessorKey: 'title' },
      { header: '', cell: () => <button type="button">Received</button> },
    ];
    render(<DataTable columns={noId} data={rows} />);
    expect(screen.getByRole('button', { name: 'Received' })).toBeInTheDocument();
  });

  it('keeps the ids it has and numbers the rest', () => {
    expect(withColumnIds(columns).map((c) => c.id)).toEqual([undefined, 'act', undefined]);
    expect(withColumnIds<Row>([{ header: '', cell: () => null }])[0]!.id).toBe('col_0');
  });
});

describe('workHrefFor', () => {
  const link = { engagementId: 'e1', engagementKind: 'compliance' as const, taskId: 't1' };
  it('uses the link with ff_work_links on', () => {
    expect(workHrefFor({ engagementId: 'e1', link }, true)).toBe(
      '/engagements/e1?tab=services&task=t1',
    );
  });
  it('falls back to the engagement with the flag off or no link', () => {
    expect(workHrefFor({ engagementId: 'e1', link }, false)).toBe('/engagements/e1');
    expect(workHrefFor({ engagementId: 'e1' }, true)).toBe('/engagements/e1');
  });
});
