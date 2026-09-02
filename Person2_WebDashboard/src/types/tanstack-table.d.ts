/**
 * Module augmentation so column definitions can carry alignment metadata.
 * TanStack Table ships `ColumnMeta` as an empty interface precisely so that
 * applications can extend it; without this, `meta: { align: 'right' }` fails
 * TypeScript's excess-property check.
 */
import type { RowData } from '@tanstack/react-table';

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    align?: 'left' | 'right' | 'center';
  }
}
