import { playCompletionSoundRef } from "../state/sharedRefs";


// 任务完成提示音：两声短促的上行音（E5 → B5），用 WebAudio 合成，不依赖音频资源文件。
// 浏览器要求用户交互后才能出声，首次交互前的 AudioContext 处于 suspended，这里尝试 resume。
export let completionAudioContext: AudioContext | null = null;
export function playCompletionSound() {
  try {
    const AudioCtor = window.AudioContext
      || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    completionAudioContext = completionAudioContext || new AudioCtor();
    const ctx = completionAudioContext;
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;
    [659.25, 987.77].forEach((frequency, index) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      const start = now + index * 0.13;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.16, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.4);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.45);
    });
  } catch {
    // 音频不可用时静默跳过，不影响任务结果
  }
}

playCompletionSoundRef.current = playCompletionSound;
