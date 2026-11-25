import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Download, Zap } from 'lucide-react';

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 800),
      setTimeout(() => setPhase(2), 2000),
      setTimeout(() => setPhase(3), 3500),
      setTimeout(() => setPhase(4), 5000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center"
      initial={{ opacity: 0, x: '100vw' }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, scale: 1.2 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="absolute inset-0 flex items-center justify-center opacity-10 pointer-events-none">
        <motion.div 
          className="text-[30vw] font-black tracking-tighter text-[#00d4ff] whitespace-nowrap"
          animate={{ x: ['100%', '-100%'] }}
          transition={{ duration: 20, ease: 'linear', repeat: Infinity }}
        >
          yt-dlp
        </motion.div>
      </div>

      <div className="w-full max-w-[70vw] relative z-10 flex gap-[4vw] items-center">
        
        {/* Left Stats */}
        <motion.div 
          className="flex-1 space-y-[2vw]"
          initial={{ opacity: 0, x: -50 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2 }}
        >
          <div className="text-[4vw] font-display font-bold leading-none text-white">
            ULTRA<br/>FAST<br/><span className="text-[#00d4ff]">FETCH</span>
          </div>
          
          {phase >= 1 && (
            <motion.div 
              className="flex items-center gap-[1vw] text-[1.5vw] font-mono text-white/70"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <Zap className="text-[#a855f7] w-[2vw] h-[2vw]" />
              POWERED BY YT-DLP
            </motion.div>
          )}
        </motion.div>

        {/* Right HUD */}
        <motion.div 
          className="flex-1 bg-[#0a0a0f] border border-[#00d4ff]/30 rounded-xl p-[2vw] relative overflow-hidden"
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          {/* Animated Background Lines */}
          <div className="absolute inset-0 opacity-20 flex flex-col justify-around pointer-events-none">
            {[...Array(10)].map((_, i) => (
              <motion.div 
                key={i}
                className="h-[1px] w-full bg-[#00d4ff]"
                animate={{ x: ['-100%', '100%'] }}
                transition={{ duration: 2 + Math.random() * 2, repeat: Infinity, ease: 'linear', delay: Math.random() }}
              />
            ))}
          </div>

          <div className="relative z-10">
            <div className="flex justify-between items-center mb-[2vw]">
              <div className="flex items-center gap-[1vw] text-[#00d4ff]">
                <Download className="w-[2vw] h-[2vw]" />
                <span className="font-mono text-[1.5vw]">DOWNLOADING</span>
              </div>
              <div className="bg-[#a855f7]/20 text-[#a855f7] font-mono px-[1vw] py-[0.5vw] rounded text-[1vw]">
                4K UHD
              </div>
            </div>

            {/* Progress Bar */}
            <div className="mb-[1vw] flex justify-between font-mono text-[1.2vw] text-white/50">
              <span>video_source_1080p.mp4</span>
              {phase >= 2 ? (
                <motion.span 
                  initial={{ opacity: 0 }} 
                  animate={{ opacity: 1 }}
                >
                  {phase >= 4 ? '100%' : '73%'}
                </motion.span>
              ) : (
                <span>0%</span>
              )}
            </div>

            <div className="w-full h-[1vw] bg-white/10 rounded-full overflow-hidden">
              <motion.div 
                className="h-full bg-gradient-to-r from-[#00d4ff] to-[#a855f7]"
                initial={{ width: '0%' }}
                animate={{ width: phase >= 4 ? '100%' : phase >= 2 ? '73%' : '0%' }}
                transition={{ duration: phase >= 4 ? 0.5 : 2, ease: "circOut" }}
              />
            </div>

            {/* Terminal Lines */}
            <div className="mt-[2vw] font-mono text-[0.8vw] text-white/40 space-y-[0.5vw]">
              {phase >= 1 && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>{'>'} Resolving formats...</motion.div>}
              {phase >= 2 && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>{'>'} Format 399 (1080p) selected</motion.div>}
              {phase >= 3 && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>{'>'} Downloading audio stream...</motion.div>}
              {phase >= 4 && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[#00d4ff]">{'>'} Download complete. Muxing.</motion.div>}
            </div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}