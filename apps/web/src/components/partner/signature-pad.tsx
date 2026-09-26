'use client';

import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

export interface SignaturePadHandle {
  /** The drawn signature as a PNG, or null if nothing was drawn. */
  toBlob(): Promise<Blob | null>;
}

/** Recipient signs with a finger or mouse. Optional: an empty pad sends nothing. */
export const SignaturePad = forwardRef<SignaturePadHandle, { label: string }>(function SignaturePad({ label }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [signed, setSigned] = useState(false);

  useImperativeHandle(ref, () => ({
    toBlob: () => new Promise((resolve) => (signed && canvas.current ? canvas.current.toBlob((b) => resolve(b), 'image/png') : resolve(null))),
  }));

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) * e.currentTarget.width) / rect.width, y: ((e.clientY - rect.top) * e.currentTarget.height) / rect.height };
  };
  const ctx = () => {
    const c = canvas.current!.getContext('2d')!;
    c.lineWidth = 3;
    c.lineCap = 'round';
    c.strokeStyle = '#011e4d';
    return c;
  };

  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">{label}</p>
      <canvas
        ref={canvas}
        width={600}
        height={200}
        aria-label={label}
        className="h-32 w-full max-w-md touch-none rounded border bg-white"
        onPointerDown={(e) => {
          drawing.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          const { x, y } = point(e);
          ctx().beginPath();
          ctx().moveTo(x, y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const { x, y } = point(e);
          const c = ctx();
          c.lineTo(x, y);
          c.stroke();
          setSigned(true);
        }}
        onPointerUp={() => (drawing.current = false)}
      />
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => {
          canvas.current!.getContext('2d')!.clearRect(0, 0, 600, 200);
          setSigned(false);
        }}
      >
        Clear signature
      </Button>
    </div>
  );
});
