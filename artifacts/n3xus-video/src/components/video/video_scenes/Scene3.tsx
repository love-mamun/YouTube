import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { BrainCircuit, CheckCircle2 } from 'lucide-react';

export function Scene3() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 1000),
      setTimeout(() => setPhase(2), 2500),
      setTimeout(() => setPhase(3), 4000),
      setTimeout(() => setPhase(4), 5500),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-center overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, filter: 'blur(20px)' }}
      transition={{ duration: 0.8 }}
    >
      {/* Background Neural Network Effect */}
      <div className="absolute inset-0 opacity-20 pointer-events-none">
        <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#00d4ff" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
          
          {/* Animated connections */}
          <motion.path 
            d="M 100 100 Q 300 300 500 200 T 900 400" 
            fill="none" 
            stroke="#a855f7" 
            strokeWidth="2"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 4, ease: "linear", repeat: Infinity }}
          />
          <motion.path 
            d="M 200 600 Q 400 400 600 500 T 1000 200" 
            fill="none" 
            stroke="#00d4ff" 
            strokeWidth="2"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 3.5, ease: "linear", repeat: Infinity, delay: 1 }}
          />
        </svg>
      </div>

      <div className="w-full max-w-[80vw] flex gap-[4vw] items-stretch z-10">
        
        {/* Left: The Brain */}
        <motion.div 
          className="flex-[0.4] flex flex-col justify-center"
          initial={{ x: -100, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
        >
          <div className="relative aspect-square w-full rounded-full border border-white/10 flex items-center justify-center">
            <motion.div 
              className="absolute inset-0 rounded-full bg-gradient-to-tr from-[#00d4ff]/20 to-[#a855f7]/20 blur-xl"
              animate={{ scale: [1, 1.2, 1], rotate: 360 }}
              transition={{ duration: 10, repeat: Infinity, ease: 'linear' }}
            />
            <motion.div
              animate={{ scale: phase >= 1 ? [1, 1.1, 1] : 1 }}
              transition={{ duration: 0.5, repeat: Infinity, repeatDelay: 1.5 }}
            >
              <BrainCircuit className="w-[10vw] h-[10vw] text-[#00d4ff]" />
            </motion.div>
            
            <div className="absolute bottom-[-4vw] w-full text-center">
              <h3 className="text-[2vw] font-display font-bold">GEMINI AI</h3>
              <p className="text-[#a855f7] font-mono text-[1vw]">CONTENT GENERATOR</p>
            </div>
          </div>
        </motion.div>

        {/* Right: Generations */}
        <div className="flex-[0.6] flex flex-col justify-center gap-[2vw]">
          
          <GenerationCard 
            phase={phase} 
            step={1} 
            title="SEO TITLE" 
            content="10 Insane Tricks to Master Framer Motion in 2024!" 
          />
          
          <GenerationCard 
            phase={phase} 
            step={2} 
            title="DESCRIPTION" 
            content="Discover the secrets to smooth React animations. In this video, we break down spring physics, choreography, and advanced layout animations..." 
            lines={2}
          />
          
          <GenerationCard 
            phase={phase} 
            step={3} 
            title="TAGS & HASHTAGS" 
            content="#React #FramerMotion #WebDesign #UIUX #Frontend" 
            isTags
          />

        </div>
      </div>
    </motion.div>
  );
}

function GenerationCard({ phase, step, title, content, lines = 1, isTags = false }: any) {
  const isVisible = phase >= step;
  
  return (
    <motion.div
      className="bg-white/5 border border-white/10 p-[2vw] rounded-lg relative overflow-hidden"
      initial={{ opacity: 0, x: 50 }}
      animate={isVisible ? { opacity: 1, x: 0 } : { opacity: 0, x: 50 }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
    >
      {isVisible && (
        <motion.div 
          className="absolute inset-0 bg-[#00d4ff]/10"
          initial={{ x: '-100%' }}
          animate={{ x: '100%' }}
          transition={{ duration: 0.8, ease: "easeInOut" }}
        />
      )}
      
      <div className="flex items-center justify-between mb-[1vw]">
        <div className="text-[1vw] font-mono text-white/50">{title}</div>
        <CheckCircle2 className="w-[1.5vw] h-[1.5vw] text-[#00d4ff]" />
      </div>

      <div className="relative">
        {!isVisible ? (
          <div className="space-y-[0.5vw]">
             {[...Array(lines)].map((_, i) => (
                <div key={i} className="h-[1.5vw] w-full bg-white/10 rounded animate-pulse" />
             ))}
          </div>
        ) : (
          <motion.div 
            className={`font-display font-medium leading-tight ${isTags ? 'text-[#a855f7]' : 'text-white'} ${lines > 1 ? 'text-[1.2vw]' : 'text-[1.8vw]'}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            {content}
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}