'use client';

import { useEffect, useRef } from 'react';

// Open modals, oldest first. Escape closes only the top one, so a modal opened
// from inside another (e.g. a contract chart over the stock OI modal) doesn't
// take its parent down with it.
const openStack: symbol[] = [];

export default function Modal({ title, onClose, children, widthClassName = 'max-w-4xl' }: {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  widthClassName?: string;
}) {
  const id = useRef(Symbol('modal'));
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const me = id.current;
    openStack.push(me);
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && openStack[openStack.length - 1] === me) onCloseRef.current();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const i = openStack.lastIndexOf(me);
      if (i >= 0) openStack.splice(i, 1);
    };
  }, []);

  return (
    <div
      className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-2 sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`bg-white rounded-lg shadow-xl w-full ${widthClassName} max-h-[95vh] sm:max-h-[90vh] overflow-y-auto`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 sticky top-0 bg-white rounded-t-lg">
          <div className="font-bold text-base">{title}</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none px-1" aria-label="Close">
            ×
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
