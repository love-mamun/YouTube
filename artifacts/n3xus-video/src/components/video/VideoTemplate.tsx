import { motion, AnimatePresence } from 'framer-motion';
import { useVideoPlayer } from '@/lib/video/hooks';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';
import { Scene6 } from './video_scenes/Scene6';

const SCENE_DURATIONS = {
  input: 7000,
  download: 7000,
  gemini: 8000,
  thumbnails: 7000,
  publish: 8000,
  outro: 8000
};

export default function VideoTemplate() {
  const { currentScene } = useVideoPlayer({ durations: SCENE_DURATIONS });

  return (
    <div className="relative w-full h-screen overflow-hidden bg-[#0a0a0f] font-body text-white bg-grid">
      {/* Persistent Background Layer */}
      <div className="absolute inset-0 pointer-events-none">
        <motion.div 
          className="absolute w-[80vw] h-[80vw] rounded-full opacity-[0.03] blur-[100px]"
          style={{ background: 'radial-gradient(circle, #00d4ff, transparent)' }}
          animate={{
            x: ['-20%', '10%', '-20%'],
            y: ['-10%', '30%', '-10%'],
            scale: [1, 1.2, 1]
          }}
          transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div 
          className="absolute w-[60vw] h-[60vw] rounded-full opacity-[0.02] blur-[80px]"
          style={{ background: 'radial-gradient(circle, #a855f7, transparent)' }}
          animate={{
            x: ['40%', '10%', '40%'],
            y: ['40%', '10%', '40%'],
            scale: [1, 1.3, 1]
          }}
          transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      {/* Persistent Midground Grid/HUD Elements */}
      <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-[4vw] z-10">
        <div className="flex justify-between items-start">
          <motion.div 
            className="text-[#00d4ff] text-[1vw] font-bold tracking-widest opacity-70 flex items-center gap-[1vw]"
          >
            <div className="w-[0.5vw] h-[0.5vw] bg-[#00d4ff] animate-pulse rounded-full" />
            N3XUS // MISSION CONTROL
          </motion.div>
          <motion.div 
            className="text-white/30 text-[0.8vw] font-mono tracking-widest text-right"
          >
            SYS.STATUS // ONLINE<br/>
            LINK // SECURE
          </motion.div>
        </div>
        <div className="flex justify-between items-end">
          <div className="flex gap-[0.5vw]">
            {[1,2,3,4,5].map(i => (
              <motion.div 
                key={i}
                className="w-[1.5vw] h-[0.4vw] bg-white/20"
                animate={{ opacity: currentScene >= i - 1 ? 0.8 : 0.2, backgroundColor: currentScene >= i - 1 ? '#00d4ff' : 'rgba(255,255,255,0.2)' }}
              />
            ))}
          </div>
          <div className="text-[#00d4ff] text-[1vw] font-mono opacity-50">
            [V.1.0]
          </div>
        </div>
      </div>

      <AnimatePresence mode="sync">
        {currentScene === 0 && <Scene1 key="input" />}
        {currentScene === 1 && <Scene2 key="download" />}
        {currentScene === 2 && <Scene3 key="gemini" />}
        {currentScene === 3 && <Scene4 key="thumbnails" />}
        {currentScene === 4 && <Scene5 key="publish" />}
        {currentScene === 5 && <Scene6 key="outro" />}
      </AnimatePresence>
    </div>
  );
}