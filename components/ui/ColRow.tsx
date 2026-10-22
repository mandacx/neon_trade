'use client';

import { Children, cloneElement, Fragment, isValidElement, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';

/** What useColumnPrefs() hands to a table: the saved order and widths, plus the ways to change them. */
export interface ColLayout {
  tableId: string;
  order: string[];
  widths: Record<string, number>;
  setWidth: (id: string, width: number | null, commit: boolean) => void;
  moveTo: (from: string, to: string) => void;
}

// The column being dragged (module level: dataTransfer can't be read while hovering).
let dragging: { table: string; id: string } | null = null;

type CellProps = { 'data-col'?: string; style?: CSSProperties; className?: string; children?: ReactNode };

function flatten(children: ReactNode, prefix = ''): ReactElement<CellProps>[] {
  const out: ReactElement<CellProps>[] = [];
  Children.toArray(children).forEach(c => {
    if (!isValidElement(c)) return;
    const key = `${prefix}${c.key}`;
    if (c.type === Fragment) out.push(...flatten((c.props as { children?: ReactNode }).children, `${key}/`));
    else out.push(cloneElement(c as ReactElement<CellProps>, { key }));
  });
  return out;
}

/**
 * A table row whose cells follow the user's saved column order and widths. Every cell of
 * a registry column carries `data-col="<id>"`; cells without it (action buttons, a
 * select-all box) stay where they are. Use it for the header row (`header`) and every body
 * row; it accepts the same props as <tr>.
 *
 * In a header row the cells also get a drag handle to the right edge for resizing
 * (double-click resets that column) and can be dragged onto another header to reorder.
 */
export default function ColRow({ layout, header, children, ...rest }: React.ComponentProps<'tr'> & { layout?: ColLayout; header?: boolean }) {
  const [over, setOver] = useState<string | null>(null);
  if (!layout) return <tr {...rest}>{children}</tr>;

  const cells = flatten(children);
  const rank = (id: string) => layout.order.indexOf(id);
  const idOf = (e: ReactElement<CellProps>) => e.props['data-col'];

  // Reorder only the cells that belong to columns, within the positions those cells hold.
  const slots: number[] = [];
  cells.forEach((e, i) => { const id = idOf(e); if (id && rank(id) >= 0) slots.push(i); });
  const sorted = slots.map(i => cells[i]).sort((a, b) => rank(idOf(a)!) - rank(idOf(b)!));
  slots.forEach((slot, k) => { cells[slot] = sorted[k]; });

  return (
    <tr {...rest}>
      {cells.map(e => {
        const id = idOf(e);
        if (!id || rank(id) < 0) return e;
        const w = layout.widths[id];
        const cls = e.props.className ?? '';
        const style: CSSProperties = {
          ...e.props.style,
          ...(header && !/\b(sticky|relative|absolute|fixed)\b/.test(cls) ? { position: 'relative' as const } : null),
          ...(w ? { width: w, minWidth: w, maxWidth: w, ...(header ? null : { overflow: 'hidden', textOverflow: 'ellipsis' }) } : null),
          ...(header && over === id ? { boxShadow: 'inset 3px 0 0 #3b82f6' } : null),
        };
        if (!header) return cloneElement(e, { style });
        return cloneElement(e, {
          style,
          onMouseDown: (ev: React.MouseEvent<HTMLElement>) => {
            // Draggable only when grabbed outside form controls (the OI filter popover has inputs).
            ev.currentTarget.draggable = !(ev.target as HTMLElement).closest('input,select,textarea,[data-nodrag]');
          },
          onDragStart: (ev: React.DragEvent) => { dragging = { table: layout.tableId, id }; ev.dataTransfer.setData('text/plain', id); ev.dataTransfer.effectAllowed = 'move'; },
          onDragOver: (ev: React.DragEvent) => { if (dragging?.table === layout.tableId) { ev.preventDefault(); if (over !== id) setOver(id); } },
          onDragLeave: () => setOver(o => (o === id ? null : o)),
          onDrop: (ev: React.DragEvent) => {
            ev.preventDefault();
            setOver(null);
            if (dragging?.table === layout.tableId) layout.moveTo(dragging.id, id);
            dragging = null;
          },
          onDragEnd: (ev: React.DragEvent<HTMLElement>) => { dragging = null; setOver(null); ev.currentTarget.draggable = false; },
        } as Partial<CellProps>, e.props.children, <ResizeHandle key="resize" onResize={(px, commit) => layout.setWidth(id, px, commit)} onReset={() => layout.setWidth(id, null, true)} />);
      })}
    </tr>
  );
}

function ResizeHandle({ onResize, onReset }: { onResize: (px: number, commit: boolean) => void; onReset: () => void }) {
  return (
    <span
      data-nodrag
      role="separator"
      aria-orientation="vertical"
      title="Drag to resize · double-click to reset"
      className="absolute top-0 right-0 z-10 h-full w-1.5 cursor-col-resize select-none touch-none hover:bg-blue-400/60"
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
      onDoubleClick={e => { e.stopPropagation(); onReset(); }}
      onPointerDown={e => {
        e.preventDefault();
        e.stopPropagation();
        const handle = e.currentTarget;
        handle.setPointerCapture(e.pointerId);
        const startX = e.clientX;
        const startW = (handle.parentElement as HTMLElement).getBoundingClientRect().width;
        let last = startW;
        let moved = false;
        const move = (m: PointerEvent) => { moved = true; last = startW + (m.clientX - startX); onResize(last, false); };
        const up = () => {
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', up);
          handle.removeEventListener('pointercancel', up);
          if (moved) onResize(last, true); // a plain click must not pin the width
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
        handle.addEventListener('pointercancel', up);
      }}
    />
  );
}
