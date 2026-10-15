// 音频转码工具：把浏览器能解码的音频（webm/opus、m4a/aac 等）转成指定采样率的
// 单声道 16bit PCM WAV。本地语音引擎只认 WAV，因此录音转写与 TTS 参考音色都走这里。

// 音频 → 指定采样率的单声道 16bit PCM WAV（Web Audio 解码，支持 webm/opus、m4a/aac 等浏览器认识的格式）。
// 本地语音引擎只认 WAV：录音转写用 16k；TTS 参考音色用 24k（Qwen3-TTS 原生采样率）。
export async function blobToWavMono(blob: Blob, targetRate: number): Promise<Uint8Array> {
  const arrayBuffer = await blob.arrayBuffer();
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const decodeCtx = new AudioCtx();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeCtx.decodeAudioData(arrayBuffer);
  } finally {
    void decodeCtx.close();
  }
  const frames = Math.max(1, Math.ceil(decoded.duration * targetRate));
  const OfflineCtx = window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  const offline = new OfflineCtx(1, frames, targetRate);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  const channel = rendered.getChannelData(0);
  const pcm = new DataView(new ArrayBuffer(frames * 2));
  for (let i = 0; i < frames; i += 1) {
    const sample = Math.max(-1, Math.min(1, channel[i] || 0));
    pcm.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + frames * 2, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, targetRate, true);
  view.setUint32(28, targetRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, frames * 2, true);
  const out = new Uint8Array(44 + frames * 2);
  out.set(new Uint8Array(header), 0);
  out.set(new Uint8Array(pcm.buffer), 44);
  return out;
}
