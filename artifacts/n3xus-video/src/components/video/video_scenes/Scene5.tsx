import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { UploadCloud, Youtube, Facebook, CheckCircle2 } from 'lucide-react';

export function Scene5() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 800),
      setTimeout(() => setPhase(2), 2500),
      setTimeout(() => setPhase(3), 4500),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-center p-[4vw]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, x: -100 }}
      transition={{ duration: 0.8 }}
    >
      <div className="w-full max-w-[80vw] flex gap-[4vw] items-center">
        
        {/* Tracker Panel */}
        <motion.div 
          className="flex-1 bg-white/5 border border-white/10 rounded-2xl p-[3vw]"
          initial={{ x: -50, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
        >
          <h2 className="text-[2vw] font-mono text-[#00d4ff] mb-[3vw] flex items-center gap-[1vw]">
            <UploadCloud className="w-[2.5vw] h-[2.5vw]" />
            PIPELINE STATUS
          </h2>

          <div className="space-y-[2vw] relative">
            {/* Connecting line */}
            <div className="absolute left-[1.25vw] top-[1vw] bottom-[2vw] w-[2px] bg-white/10" />
            
            <motion.div 
              className="absolute left-[1.25vw] top-[1vw] w-[2px] bg-[#00d4ff] origin-top"
              initial={{ scaleY: 0 }}
              animate={{ scaleY: phase >= 3 ? 1 : phase >= 2 ? 0.6 : 0.3 }}
              transition={{ duration: 1, ease: "easeInOut" }}
            />

            <StatusItem label="DOWNLOADING MEDIA" done={true} delay={0} />
            <StatusItem label="GENERATING METADATA" done={true} delay={0.1} />
            <StatusItem label="THUMBNAIL CREATION" done={true} delay={0.2} />
            <StatusItem label="PUBLISHING TO PLATFORMS" done={phase >= 2} active={phase < 2} delay={0.3} />
            <StatusItem label="SYNC COMPLETE" done={phase >= 3} active={phase === 2} delay={0.4} />
          </div>
        </motion.div>

        {/* Big Button / Success */}
        <div className="flex-1 flex flex-col items-center justify-center">
          
          <motion.div 
            className="flex gap-[2vw] mb-[4vw]"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <motion.div 
              className="bg-red-600 w-[6vw] h-[6vw] rounded-2xl flex items-center justify-center text-white"
              animate={phase >= 2 ? { scale: [1, 1.1, 1], boxShadow: "0 0 40px rgba(220,38,38,0.6)" } : {}}
            >
              <Youtube className="w-[3vw] h-[3vw]" />
            </motion.div>
            <motion.div 
              className="bg-blue-600 w-[6vw] h-[6vw] rounded-2xl flex items-center justify-center text-white"
              animate={phase >= 2 ? { scale: [1, 1.1, 1], boxShadow: "0 0 40px rgba(37,99,235,0.6)" } : {}}
              transition={{ delay: 0.1 }}
            >
              <Facebook className="w-[3vw] h-[3vw]" />
            </motion.div>
          </motion.div>

          <AnimatePresence mode="wait">
            {phase < 3 ? (
              <motion.div
                key="publishing"
                className="text-[3vw] font-display font-bold text-white text-center"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.1 }}
              >
                ONE-CLICK
                <div className="text-[#a855f7]">PUBLISH</div>
              </motion.div>
            ) : (
              <motion.div
                key="success"
                className="text-[4vw] font-display font-bold text-[#00d4ff] flex flex-col items-center"
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: "spring", bounce: 0.5 }}
              >
                <CheckCircle2 className="w-[6vw] h-[6vw] mb-[1vw]" />
                PUBLISHED
              </motion.div>
            )}
          </AnimatePresence>

        </div>

      </div>
    </motion.div>
  );
}

function StatusItem({ label, done, active, delay }: any) {
  return (
    <motion.div 
      className="flex items-center gap-[2vw] relative z-10"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay }}
    >
      <div className={`w-[2.5vw] h-[2.5vw] rounded-full flex items-center justify-center transition-colors duration-500
        ${done ? 'bg-[#00d4ff] text-black' : active ? 'bg-[#00d4ff]/20 border-2 border-[#00d4ff]' : 'bg-[#0a0a0f] border-2 border-white/20'}`}
      >
        {done && <CheckCircle2 className="w-[1.5vw] h-[1.5vw]" />}
        {active && (
          <motion.div 
            className="w-[1vw] h-[1vw] bg-[#00d4ff] rounded-full"
            animate={{ scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }}
            transition={{ duration: 1, repeat: Infinity }}
          />
        )}
      </div>
      <div className={`text-[1.5vw] font-mono ${done ? 'text-white' : active ? 'text-[#00d4ff]' : 'text-white/40'}`}>
        {label}
      </div>
    </motion.div>
  );
}