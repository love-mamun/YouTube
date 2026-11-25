import { useEffect, useRef } from "react";

interface Node {
  x: number; y: number;
  vx: number; vy: number;
  r: number;
}

export function SpaceBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const isMobile = window.innerWidth < 768;
    const NODE_COUNT = isMobile ? 35 : 75;
    const LINE_DIST = isMobile ? 130 : 170;
    const SPEED = isMobile ? 0.2 : 0.28;
    const CYAN = "0, 212, 255";

    let W = 0, H = 0;
    let nodes: Node[] = [];
    let frameId: number;

    function resize() {
      W = canvas!.width = window.innerWidth;
      H = canvas!.height = window.innerHeight;
    }

    function init() {
      resize();
      nodes = Array.from({ length: NODE_COUNT }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * SPEED,
        vy: (Math.random() - 0.5) * SPEED,
        r: Math.random() * 1.4 + 0.8,
      }));
    }

    function draw() {
      frameId = requestAnimationFrame(draw);
      ctx!.clearRect(0, 0, W, H);

      // Move nodes
      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0 || n.x > W) n.vx *= -1;
        if (n.y < 0 || n.y > H) n.vy *= -1;
      }

      // Draw connecting lines
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < LINE_DIST) {
            const alpha = (1 - dist / LINE_DIST) * 0.22;
            ctx!.beginPath();
            ctx!.strokeStyle = `rgba(${CYAN}, ${alpha})`;
            ctx!.lineWidth = 0.8;
            ctx!.moveTo(nodes[i].x, nodes[i].y);
            ctx!.lineTo(nodes[j].x, nodes[j].y);
            ctx!.stroke();
          }
        }
      }

      // Draw nodes
      for (const n of nodes) {
        ctx!.beginPath();
        ctx!.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(${CYAN}, 0.65)`;
        ctx!.fill();

        // Subtle glow
        const grad = ctx!.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r * 3.5);
        grad.addColorStop(0, `rgba(${CYAN}, 0.12)`);
        grad.addColorStop(1, `rgba(${CYAN}, 0)`);
        ctx!.beginPath();
        ctx!.arc(n.x, n.y, n.r * 3.5, 0, Math.PI * 2);
        ctx!.fillStyle = grad;
        ctx!.fill();
      }
    }

    init();
    draw();

    const onResize = () => { resize(); };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="fixed inset-0 pointer-events-none z-0"
      style={{ opacity: 0.5 }}
    />
  );
}
