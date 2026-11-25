import { motion } from 'framer-motion';

export function Scene6() {
  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center"
      initial={{ opacity: 0, scale: 1.2 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, filter: 'blur(10px)' }}
      transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Background sweep */}
      <motion.div 
        className="absolute inset-0 bg-[#00d4ff]/5 pointer-events-none"
        initial={{ y: '100%' }}
        animate={{ y: '-100%' }}
        transition={{ duration: 3, ease: 'linear', repeat: Infinity }}
      />

      <motion.div 
        className="text-[6vw] font-black font-display tracking-tighter text-white text-center leading-none"
        initial={{ y: 50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.5, type: 'spring', stiffness: 200, damping: 20 }}
      >
        N3XUS
        <br/>
        <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#00d4ff] to-[#a855f7]">
          AUTO PUBLISHER
        </span>
      </motion.div>

      <motion.div 
        className="mt-[4vw] bg-white/5 border border-white/10 px-[3vw] py-[1vw] rounded-full text-[1.5vw] font-mono text-white/70 tracking-widest"
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 1 }}
      >
        AUTOMATE EVERYTHING.
      </motion.div>

    </motion.div>
  );
}