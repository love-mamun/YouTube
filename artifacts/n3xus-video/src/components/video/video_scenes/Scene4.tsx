import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Image as ImageIcon, Sparkles } from 'lucide-react';

export function Scene4() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 2000),
      setTimeout(() => setPhase(3), 4000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center p-[4vw]"
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, y: 100 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="text-center mb-[4vw]">
        <motion.h2 
          className="text-[4vw] font-display font-bold text-white flex items-center justify-center gap-[2vw]"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <ImageIcon className="w-[4vw] h-[4vw] text-[#a855f7]" />
          THUMBNAIL GEN
        </motion.h2>
        <motion.p 
          className="text-[1.5vw] font-mono text-[#00d4ff] mt-[1vw]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          AI-GENERATED VARIANTS // OPTIMIZED FOR CTR
        </motion.p>
      </div>

      <div className="grid grid-cols-4 gap-[2vw] w-full max-w-[90vw]">
        {[1, 2, 3, 4].map((i) => (
          <ThumbnailCard 
            key={i} 
            index={i} 
            phase={phase} 
            selected={i === 2 && phase >= 3} 
          />
        ))}
      </div>
      
      {phase >= 3 && (
        <motion.div
           className="mt-[4vw] flex items-center gap-[1vw] text-[#a855f7] bg-[#a855f7]/10 px-[2vw] py-[1vw] rounded-full font-mono text-[1.2vw]"
           initial={{ opacity: 0, y: 20 }}
           animate={{ opacity: 1, y: 0 }}
           transition={{ type: "spring" }}
        >
          <Sparkles className="w-[1.5vw] h-[1.5vw]" />
          VARIANT 2 AUTO-SELECTED (BEST MATCH)
        </motion.div>
      )}

    </motion.div>
  );
}

function ThumbnailCard({ index, phase, selected }: { index: number, phase: number, selected: boolean }) {
  const isVisible = phase >= 1;
  const isRevealed = phase >= 2;
  
  return (
    <motion.div
      className={`aspect-video rounded-xl relative overflow-hidden transition-all duration-500 ${
        selected ? 'ring-4 ring-[#00d4ff] shadow-[0_0_30px_rgba(0,212,255,0.5)] scale-110 z-10' : 
        phase >= 3 ? 'opacity-40 scale-90 grayscale' : 'border border-white/20'
      }`}
      initial={{ opacity: 0, y: 50 }}
      animate={isVisible ? { opacity: 1, y: 0 } : {}}
      transition={{ delay: index * 0.15, type: "spring", stiffness: 300, damping: 25 }}
    >
      {/* Fallback skeleton */}
      <div className="absolute inset-0 bg-white/5 flex items-center justify-center">
        <div className="w-[4vw] h-[4vw] border-4 border-t-[#00d4ff] border-white/10 rounded-full animate-spin" />
      </div>

      {/* Simulated Image Reveal */}
      {isRevealed && (
        <motion.div 
          className="absolute inset-0 bg-[#0a0a0f]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-[#a855f7]/40 to-[#00d4ff]/40 mix-blend-overlay" />
          {/* Faux content */}
          <div className="absolute inset-0 flex flex-col p-[1.5vw] justify-between">
            <div className={`w-[40%] h-[15%] rounded ${index % 2 === 0 ? 'bg-white' : 'bg-[#00d4ff]'}`} />
            <div className="flex justify-end">
              <div className="w-[30%] h-[15%] bg-[#a855f7] rounded" />
            </div>
          </div>
          {/* Overlay wipe effect */}
          <motion.div 
            className="absolute inset-0 bg-white"
            initial={{ x: 0 }}
            animate={{ x: '100%' }}
            transition={{ duration: 0.6, delay: index * 0.1, ease: "circIn" }}
          />
        </motion.div>
      )}

      {selected && (
        <motion.div 
          className="absolute top-[1vw] right-[1vw] bg-[#00d4ff] text-black px-[1vw] py-[0.5vw] rounded-md font-mono text-[0.8vw] font-bold"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.2, type: "spring" }}
        >
          SELECTED
        </motion.div>
      )}
    </motion.div>
  );
}