// 语音 / 图片预览 / 消息朗读编辑操作（模块级 actions）。
//
// 整组函数原样从 App.tsx 搬出，只是把「读写 state 的裸标识符」改成经 store 的
// getState() 解构拿到，并把跨模块共享的 ref 换成 sharedRefs 里的模块级单例；
// 函数体、文案与行为均保持不变，供 App 等任意位置 import 调用。
import type { Attachment, ChatMessage } from "../types";
import { attachmentImageSource } from "../ImageAttachment";
import { blobToWavMono } from "../lib/audio";
import { copyTextToClipboard, messageVisibleText } from "../lib/text";
import { clientHost } from "../pluginRuntime/clientHostSingleton.ts";
import { useComposerStore } from "./composerStore";
import { useLayoutStore } from "./layoutStore";
import { usePanelStore } from "./panelStore";
import { useSettingsStore } from "./settingsStore";
import { selectActiveSession, useSessionStore } from "./sessionStore";
import { microphoneStreamRef, recorderRef, recordingChunksRef, speakAudioRef, speakObjectUrlRef, speakTokenRef, textareaRef, voiceAudioRef, voiceObjectUrlRef, voiceTargetRef } from "./sharedRefs";
import { useViewStore } from "./viewStore";

export const speakMessageKey = (message: ChatMessage) => message.id || `${message.role}:${message.createdAt}`;

export const openImagePreview = (payload: { url: string; name: string; path?: string }, peers?: Array<Pick<Attachment, "path" | "previewUrl" | "name">>) => {
  const { setImagePreview, setImagePreviewPeers } = useViewStore.getState();
  setImagePreviewPeers(peers ?? []);
  setImagePreview(payload);
};

export const closeImagePreview = () => {
  const { setImagePreview, setImagePreviewPeers } = useViewStore.getState();
  setImagePreview(null);
  setImagePreviewPeers([]);
};

// 左右切换（循环）：目标图可能还没读过原图，先经附件通道取 dataURL
export const navigateImagePreview = (direction: -1 | 1) => {
  const { imagePreview, imagePreviewPeers, setImagePreview } = useViewStore.getState();
  const current = imagePreview;
  if (!current || imagePreviewPeers.length < 2) return;
  const currentKey = current.path || current.url;
  const index = imagePreviewPeers.findIndex((peer) => (peer.path || peer.previewUrl || "") === currentKey);
  const next = imagePreviewPeers[(Math.max(index, 0) + direction + imagePreviewPeers.length) % imagePreviewPeers.length];
  if (!next) return;
  void attachmentImageSource(next).then((result) => {
    if (result.ok && result.dataUrl) setImagePreview({ url: result.dataUrl, name: next.name || "图片", path: next.path });
  });
};

export const finishRecording = async (recorder: MediaRecorder) => {
  const { setVoiceState } = useComposerStore.getState();
  const { setError, setNotice } = useViewStore.getState();
  const { settings } = useSettingsStore.getState();
  const stream = microphoneStreamRef.current;
  microphoneStreamRef.current = null;
  stream?.getTracks().forEach((track) => track.stop());
  const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || "audio/webm" });
  recordingChunksRef.current = [];
  if (!blob.size) {
    setVoiceState("idle");
    setError("没有录到声音，请检查麦克风后重试");
    return;
  }
  setVoiceState("transcribing");
  setNotice("正在把录音转换成文字");
  try {
    if (!window.dyworker) {
      await new Promise((resolve) => window.setTimeout(resolve, 650));
      applyVoiceText("请根据当前工作文件夹整理一份工作摘要。");
    } else {
      // 本地引擎只认 WAV：webm 录音先解码重采样成 16k 单声道；云端直接发原始格式
      const engineLocal = settings.transcriptionEngine === "local";
      const audio = engineLocal
        ? await blobToWavMono(blob, 16000)
        : new Uint8Array(await blob.arrayBuffer());
      const result = await window.dyworker.transcribeAudio({
        settings,
        audio: Array.from(audio),
        mimeType: engineLocal ? "audio/wav" : blob.type || "audio/webm",
      });
      applyVoiceText(result.text);
    }
    setNotice("语音已转换为文字");
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  } catch (voiceError) {
    setError(voiceError instanceof Error ? voiceError.message : String(voiceError));
  } finally {
    recorderRef.current = null;
    setVoiceState("idle");
  }
};

// 转写结果按目标分发：默认写进 composer，评论卡录音时由 voiceTargetRef 指向评论 setter
export const applyVoiceText = (text: string) => {
  const { setComposer } = useComposerStore.getState();
  const target = voiceTargetRef.current;
  voiceTargetRef.current = "composer";
  if (target === "composer") {
    setComposer((current) => `${current}${current && !current.endsWith("\n") ? "\n" : ""}${text}`);
  } else {
    target(text);
  }
};

export const toggleVoiceInput = async () => {
  const { voiceState, setVoiceState } = useComposerStore.getState();
  const { setError, setNotice } = useViewStore.getState();
  const { settings } = useSettingsStore.getState();
  const { setSettingsOpen } = useLayoutStore.getState();
  setError("");
  if (voiceState === "transcribing") return;
  if (voiceState === "recording") {
    recorderRef.current?.stop();
    return;
  }
  if (!window.dyworker) {
    setVoiceState("transcribing");
    setNotice("正在把录音转换成文字");
    await new Promise((resolve) => window.setTimeout(resolve, 650));
    applyVoiceText("请根据当前工作文件夹整理一份工作摘要。");
    setVoiceState("idle");
    setNotice("语音已转换为文字");
    return;
  }
  // 本地引擎不需要云端密钥与转写地址；模型没下载时由主进程转写报错提示
  if (settings.transcriptionEngine !== "local"
    && (!settings.apiKey || (!settings.transcriptionEndpoint && !settings.endpoint))) {
    setError("请先在设置中配置模型密钥和语音转写服务");
    setSettingsOpen(true);
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    setError("当前系统没有提供可用的录音能力");
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const preferredType = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]
      .find((type) => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream, preferredType ? { mimeType: preferredType } : undefined);
    microphoneStreamRef.current = stream;
    recorderRef.current = recorder;
    recordingChunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) recordingChunksRef.current.push(event.data);
    };
    recorder.onstop = () => void finishRecording(recorder);
    recorder.onerror = () => {
      stream.getTracks().forEach((track) => track.stop());
      recorderRef.current = null;
      setVoiceState("idle");
      setError("录音中断，请检查麦克风权限后重试");
    };
    recorder.start(250);
    setVoiceState("recording");
    setNotice("正在录音，再次点击麦克风即可结束");
  } catch (voiceError) {
    setError(`无法使用麦克风：${voiceError instanceof Error ? voiceError.message : String(voiceError)}`);
  }
};

export const copyMessage = async (message: ChatMessage) => {
  const { setNotice } = useViewStore.getState();
  const text = messageVisibleText(message);
  // 复制按钮只复制文本：图文混排进剪贴板时，部分粘贴目标（如输入框）会只取到图片、
  // 丢掉文本。图片由缩略图上的复制按钮单独复制。
  const copied = await copyTextToClipboard(text);
  setNotice(copied ? "消息已复制" : "消息复制失败，请检查剪贴板权限");
};

export const stopSpeakingMessage = () => {
  const { setSpeakingMessageKey, setSpeakingLoadingKey } = useComposerStore.getState();
  speakTokenRef.current += 1;
  if (speakAudioRef.current) {
    speakAudioRef.current.pause();
    speakAudioRef.current = null;
  }
  if (speakObjectUrlRef.current) {
    URL.revokeObjectURL(speakObjectUrlRef.current);
    speakObjectUrlRef.current = "";
  }
  setSpeakingMessageKey(null);
  setSpeakingLoadingKey(null);
};

export const toggleSpeakMessage = async (message: ChatMessage) => {
  const { speakingMessageKey, speakingLoadingKey, setSpeakingMessageKey, setSpeakingLoadingKey } = useComposerStore.getState();
  const { setNotice } = useViewStore.getState();
  const key = speakMessageKey(message);
  if (speakingMessageKey === key || speakingLoadingKey === key) {
    stopSpeakingMessage();
    return;
  }
  // 已有合成进行中：先停掉，避免两条音频叠加
  stopSpeakingMessage();
  const text = messageVisibleText(message).trim();
  if (!text) {
    setNotice("这条消息没有可朗读的文本");
    return;
  }
  const token = speakTokenRef.current;
  setSpeakingLoadingKey(key);
  try {
    const result = await window.dyworker?.speakText({ text: text.slice(0, 2000) });
    if (token !== speakTokenRef.current) return;
    if (!result?.ok || !result.wav?.length) {
      setNotice(result?.error || "语音合成失败，请重试");
      return;
    }
    // IPC 结构化克隆拿到的是 Uint8Array<ArrayBufferLike>：拷贝成独立 ArrayBuffer 再建 Blob
    const wavBuffer = result.wav.buffer.slice(result.wav.byteOffset, result.wav.byteOffset + result.wav.byteLength) as ArrayBuffer;
    const url = URL.createObjectURL(new Blob([wavBuffer], { type: "audio/wav" }));
    const audio = new Audio(url);
    speakObjectUrlRef.current = url;
    speakAudioRef.current = audio;
    audio.onended = () => stopSpeakingMessage();
    audio.onerror = () => {
      setNotice("语音播放失败");
      stopSpeakingMessage();
    };
    setSpeakingMessageKey(key);
    await audio.play();
  } catch (error) {
    if (token === speakTokenRef.current) setNotice(error instanceof Error ? error.message : String(error));
  } finally {
    if (token === speakTokenRef.current) setSpeakingLoadingKey(null);
  }
};

export const stopPlayingVoice = () => {
  const { setPlayingVoicePath, setVoiceLoadingPath } = useComposerStore.getState();
  if (voiceAudioRef.current) {
    voiceAudioRef.current.pause();
    voiceAudioRef.current = null;
  }
  if (voiceObjectUrlRef.current) {
    URL.revokeObjectURL(voiceObjectUrlRef.current);
    voiceObjectUrlRef.current = "";
  }
  setPlayingVoicePath(null);
  setVoiceLoadingPath(null);
};

export const togglePlayVoice = async (attachment: Attachment) => {
  const { playingVoicePath, voiceLoadingPath, setPlayingVoicePath, setVoiceLoadingPath } = useComposerStore.getState();
  const { setNotice } = useViewStore.getState();
  const pathKey = attachment.path || attachment.name;
  if (playingVoicePath === pathKey || voiceLoadingPath === pathKey) {
    stopPlayingVoice();
    return;
  }
  stopPlayingVoice();
  stopSpeakingMessage();
  if (!attachment.path) {
    setNotice("语音文件路径不存在");
    return;
  }
  setVoiceLoadingPath(pathKey);
  try {
    const result = await window.dyworker?.readAudioAttachment(attachment.path);
    if (!result?.ok || (!result.wav?.length && !result.bytes?.length)) {
      setNotice(result?.error || "语音文件无法读取或已清理");
      return;
    }
    const audioBuffer = result.wav ? result.wav : result.bytes!;
    const mimeType = result.wav ? "audio/wav" : (result.mimeType || "audio/mpeg");
    const bufferCopy = audioBuffer.buffer.slice(audioBuffer.byteOffset, audioBuffer.byteOffset + audioBuffer.byteLength) as ArrayBuffer;
    const url = URL.createObjectURL(new Blob([bufferCopy], { type: mimeType }));
    const audio = new Audio();
    audio.src = url;
    audio.preload = "auto";
    voiceObjectUrlRef.current = url;
    voiceAudioRef.current = audio;
    audio.onended = () => stopPlayingVoice();
    audio.onerror = () => {
      const errorMsg = audio.error?.message || "语音播放失败";
      setNotice(errorMsg.includes("supported source") ? "语音格式无法播放或文件已损坏" : "语音播放失败");
      stopPlayingVoice();
    };
    setPlayingVoicePath(pathKey);
    await audio.play();
  } catch (error) {
    setNotice(error instanceof Error ? error.message : String(error));
    stopPlayingVoice();
  } finally {
    setVoiceLoadingPath(null);
  }
};

export const startMessageEdit = (message: ChatMessage, messageIndex: number) => {
  const sessionState = useSessionStore.getState();
  const activeSession = selectActiveSession(sessionState);
  const { setEditingMessage, setNotice, queuedRunIds } = useViewStore.getState();
  const { setComposer, setAttachments, setActiveSkills, setAnnotations, setMentionMenu } = useComposerStore.getState();
  const { skills } = usePanelStore.getState();
  const activeTaskRunning = Boolean(activeSession?.id && sessionState.runningSessionIds.has(activeSession.id));
  if (!activeSession || message.role !== "user") return;
  // 任务运行期间只允许编辑排队中、尚未开始执行的消息
  if (activeTaskRunning && !(message.runId && queuedRunIds.has(message.runId))) return;
  const text = messageVisibleText(message);
  if (activeSession.runtime === 'dsh') {
    const editor = clientHost().inputEditor(activeSession.id);
    if (!editor || !clientHost().inputReady(activeSession.id)) { setNotice('本会话输入尚未就绪，请稍后重试'); return; }
    try { editor.restore({ text, references: message.pluginReferences || [] }); editor.refreshSources(); }
    catch (error) { setNotice(`无法恢复这条消息的引用：${error instanceof Error ? error.message : String(error)}`); return; }
  }
  setEditingMessage({ sessionId: activeSession.id, messageIndex, original: message });
  setComposer(text);
  setAttachments(message.attachments ? [...message.attachments] : []);
  setActiveSkills(message.skillsUsed?.length ? skills.filter((skill) => message.skillsUsed?.includes(skill.name)) : []);
  // 引用注释一并恢复进 composer，重发时按编辑后的版本重新编号拼进正文
  setAnnotations(message.annotations ? message.annotations.map((annotation) => ({ ...annotation })) : []);
  setMentionMenu(null);
  setNotice("已载入消息，修改后点击发送即可替换原消息并重新处理");
  window.setTimeout(() => textareaRef.current?.focus(), 0);
};

export const cancelMessageEdit = () => {
  const { setEditingMessage, setNotice } = useViewStore.getState();
  const { setComposer, setAttachments, setActiveSkills, setAnnotations } = useComposerStore.getState();
  setEditingMessage(null);
  setComposer("");
  setAttachments([]);
  setActiveSkills([]);
  setAnnotations([]);
  setNotice("已取消编辑");
  window.setTimeout(() => textareaRef.current?.focus(), 0);
};
