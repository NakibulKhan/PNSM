/**
 * Generic table built on TanStack Table v8.
 *
 * Pagination, sorting and filtering are all SERVER-side: the attendance log will
 * grow to tens of thousands of rows, and shipping them to the browser to slice
 * locally would be the wrong shape from day one. This component renders whatever
 * page it is handed and reports intent upward.
 */
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { ChevronLeft, ChevronRight, ArrowUp, ArrowDown } from 'lucide-react';
import { TableShell, Td, Th, Tr } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/common/states';
import type { ApiMeta } from '@/types/api';

export interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  meta?: ApiMeta;
  isLoading?: boolean;
  emptyTitle?: string;
  emptyMessage?: string;
  sorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;
  onPageChange?: (page: number) => void;
  getRowId?: (row: T) => string;
  onRowClick?: (row: T) => void;
}

export function DataTable<T>({
  columns,
  data,
  meta,
  isLoading,
  emptyTitle = 'Nothing to show',
  emptyMessage = 'Adjust the filters to widen the search.',
  sorting = [],
  onSortingChange,
  onPageChange,
  getRowId,
  onRowClick,
}: DataTableProps<T>) {
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    manualPagination: true,
    manualSorting: true,
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater;
      onSortingChange?.(next);
    },
    getCoreRowModel: getCoreRowModel(),
    getRowId: getRowId ? (row) => getRowId(row) : undefined,
  });

  const totalPages = meta ? Math.max(1, Math.ceil(meta.total / meta.pageSize)) : 1;
  const firstRow = meta ? (meta.page - 1) * meta.pageSize + 1 : 0;
  const lastRow = meta ? Math.min(meta.page * meta.pageSize, meta.total) : 0;

  if (isLoading) return <SkeletonRows rows={8} className="p-4" />;
  if (data.length === 0) return <EmptyState title={emptyTitle} message={emptyMessage} />;

  return (
    <div>
      <TableShell>
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const canSort = header.column.getCanSort();
                const direction = header.column.getIsSorted();
                return (
                  <Th
                    key={header.id}
                    align={header.column.columnDef.meta?.align ?? 'left'}
                  >
                    {canSort ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="inline-flex items-center gap-1 hover:text-ink"
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {direction === 'asc' ? (
                          <ArrowUp size={11} aria-hidden />
                        ) : direction === 'desc' ? (
                          <ArrowDown size={11} aria-hidden />
                        ) : null}
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </Th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <Tr
              key={row.id}
              onClick={onRowClick ? () => onRowClick(row.original) : undefined}
              className={onRowClick ? 'cursor-pointer' : undefined}
            >
              {row.getVisibleCells().map((cell) => (
                <Td
                  key={cell.id}
                  align={cell.column.columnDef.meta?.align ?? 'left'}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </Td>
              ))}
            </Tr>
          ))}
        </tbody>
      </TableShell>

      {meta && meta.total > meta.pageSize ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5">
          <p className="tnum text-[11.5px] text-muted">
            {firstRow}–{lastRow} of {meta.total}
          </p>
          <div className="flex items-center gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              disabled={meta.page <= 1}
              onClick={() => onPageChange?.(meta.page - 1)}
            >
              <ChevronLeft size={13} aria-hidden /> Previous
            </Button>
            <span className="tnum px-1 text-[11.5px] text-muted">
              {meta.page} / {totalPages}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={meta.page >= totalPages}
              onClick={() => onPageChange?.(meta.page + 1)}
            >
              Next <ChevronRight size={13} aria-hidden />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
