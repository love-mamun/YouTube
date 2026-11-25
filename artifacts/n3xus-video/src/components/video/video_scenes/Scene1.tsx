import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Terminal } from 'lucide-react';

export function Scene1() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 2000),
      setTimeout(() => setPhase(3), 3500),
      setTimeout(() => setPhase(4), 5000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center"
      initial={{ opacity: 0, scale: 1.1 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, y: -50, scale: 0.95 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="w-full max-w-[60vw] relative">
        <motion.div 
          className="absolute -inset-[2px] bg-gradient-to-r from-[#00d4ff]/50 to-[#a855f7]/50 rounded-lg blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: phase >= 1 ? 1 : 0 }}
          transition={{ duration: 1 }}
        />
        
        <motion.div 
          className="relative bg-[#0a0a0f] border border-white/10 rounded-lg p-[3vw] shadow-2xl overflow-hidden"
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
        >
          {/* Header */}
          <div className="flex items-center gap-[1vw] mb-[2vw] border-b border-white/10 pb-[1vw]">
            <Terminal className="w-[2vw] h-[2vw] text-[#00d4ff]" />
            <h2 className="text-[1.5vw] font-mono text-white/70">INPUT // DATA STREAM</h2>
          </div>

          <motion.div
            className="flex flex-col gap-[1vw]"
            initial={{ opacity: 0 }}
            animate={{ opacity: phase >= 2 ? 1 : 0 }}
          >
            <div className="text-[1.2vw] text-white/50 font-mono">TARGET_URL:</div>
            
            <div className="relative">
              <div className="w-full bg-white/5 border border-[#00d4ff]/30 rounded p-[1.5vw] text-[1.8vw] font-mono text-white flex items-center">
                <span className="text-[#00d4ff] mr-[1vw]">{'>'}</span>
                {phase >= 3 && (
                  <motion.span
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="truncate"
                  >
                    https://youtube.com/watch?v=...
                  </motion.span>
                )}
                <motion.span 
                  animate={{ opacity: [1, 0, 1] }} 
                  transition={{ duration: 0.8, repeat: Infinity }}
                  className="w-[1vw] h-[2vw] bg-[#00d4ff] ml-[0.5vw]"
                />
              </div>

              {phase >= 4 && (
                <motion.div 
                  className="absolute inset-0 border-2 border-[#00d4ff] rounded pointer-events-none"
                  initial={{ scale: 1.1, opacity: 0 }}
                  animate={{ scale: 1, opacity: [0, 1, 0] }}
                  transition={{ duration: 0.5 }}
                />
              )}
            </div>
          </motion.div>

          {phase >= 4 && (
            <motion.div 
              className="mt-[3vw] flex justify-center"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div className="bg-[#00d4ff] text-black font-bold font-mono px-[3vw] py-[1vw] text-[1.5vw] rounded hover:scale-105 transition-transform flex items-center gap-[1vw]">
                INITIATE PIPELINE
                <motion.div
                  className="w-[1vw] h-[1vw] border-t-2 border-r-2 border-black rotate-45"
                  animate={{ x: [0, 5, 0] }}
                  transition={{ duration: 1, repeat: Infinity }}
                />
              </div>
            </motion.div>
          )}

        </motion.div>
      </div>
    </motion.div>
  );
}