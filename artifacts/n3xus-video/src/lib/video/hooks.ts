import { useEffect, useState, useRef } from "react";

declare global {
  interface Window {
    startRecording?: () => void;
    stopRecording?: () => void;
  }
}

export function useVideoPlayer({ durations }: { durations: Record<string, number> }) {
  const [currentSceneIndex, setCurrentSceneIndex] = useState(0);
  const keys = Object.keys(durations);
  const totalScenes = keys.length;
  const hasRecordedRef = useRef(false);

  useEffect(() => {
    window.startRecording?.();
  }, []);

  useEffect(() => {
    const currentKey = keys[currentSceneIndex];
    const duration = durations[currentKey];

    const timer = setTimeout(() => {
      setCurrentSceneIndex((prev) => {
        const next = prev + 1;
        if (next === totalScenes) {
          if (!hasRecordedRef.current) {
            hasRecordedRef.current = true;
            window.stopRecording?.();
          }
          return 0; // loop
        }
        return next;
      });
    }, duration);

    return () => clearTimeout(timer);
  }, [currentSceneIndex, durations, keys, totalScenes]);

  return { currentScene: currentSceneIndex };
}