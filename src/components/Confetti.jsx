import { useState, useEffect } from 'react';
import { CONFETTI_COLORS } from '../data.js';

export default function Confetti({ active }) {
  const [pieces, setPieces] = useState([]);

  useEffect(() => {
    if (!active) return;
    setPieces(
      Array.from({ length: 130 }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        delay: Math.random() * 3.5,
        dur: 2.8 + Math.random() * 2.5,
        color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
        w: 7 + Math.random() * 8,
        h: 11 + Math.random() * 8,
        rot: Math.random() * 360,
      }))
    );
    const t = setTimeout(() => setPieces([]), 8000);
    return () => clearTimeout(t);
  }, [active]);

  if (!pieces.length) return null;
  return (
    <div className="confetti-wrap">
      {pieces.map(p => (
        <div
          key={p.id}
          className="cp"
          style={{
            left: `${p.x}%`,
            width: p.w,
            height: p.h,
            background: p.color,
            transform: `rotate(${p.rot}deg)`,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.dur}s`,
          }}
        />
      ))}
    </div>
  );
}
