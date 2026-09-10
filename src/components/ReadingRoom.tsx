import { useEffect, useRef } from 'react';
import { SHELVES } from '../lib/art/shelves';

/**
 * The room the app sits in: three shelves receding into lamplight, and the
 * front row reflected in a polished floor.
 *
 * The shelves are real elements in a perspective scene rather than a picture of
 * shelves. Each row sits at its own distance from the camera, so the browser
 * scales and offsets them for us, and the whole rig turns a few degrees towards
 * the pointer. That parallax between rows is what reads as depth; a flat image
 * stays flat however carefully it is shaded.
 */
export function ReadingRoom({ dimmed = false }: { dimmed?: boolean }) {
  const rig = useRef<HTMLDivElement>(null);

  // Pointer parallax, eased towards its target so the room drifts rather than
  // snaps, with a slow idle sway so it is alive when nobody is moving.
  useEffect(() => {
    const el = rig.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let targetX = 0;
    let targetY = 0;
    let x = 0;
    let y = 0;
    let idle = 0;
    let frame = 0;

    const onMove = (e: PointerEvent) => {
      targetX = (e.clientX / window.innerWidth) * 2 - 1;
      targetY = (e.clientY / window.innerHeight) * 2 - 1;
    };

    const tick = () => {
      idle += 0.0014;
      x += (targetX + Math.sin(idle) * 0.2 - x) * 0.04;
      y += (targetY + Math.cos(idle * 0.7) * 0.12 - y) * 0.04;
      el.style.setProperty('--px', x.toFixed(4));
      el.style.setProperty('--py', y.toFixed(4));
      frame = requestAnimationFrame(tick);
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    frame = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className={`room${dimmed ? ' dimmed' : ''}`} aria-hidden="true">
      <div className="room-dark" />
      <div className="room-lamp" />
      <div className="room-stage">
        <div className="room-rig" ref={rig}>
          {/* Back to front, so the nearer rows overlap the further ones. */}
          {[...SHELVES].reverse().map((shelf) => (
            <div
              key={shelf.depth}
              className="room-shelf"
              style={{ '--art': shelf.url, '--depth': `${shelf.depth}px` } as React.CSSProperties}
            />
          ))}
          <div
            className="room-shelf reflected"
            style={{ '--art': SHELVES[0].url, '--depth': '0px' } as React.CSSProperties}
          />
        </div>
      </div>
      <div className="room-haze" />
    </div>
  );
}
