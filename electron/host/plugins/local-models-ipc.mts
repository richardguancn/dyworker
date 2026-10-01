// IPC 域插件：本地模型管理（reviewer-local:* / voice-local:* / tts-local:*）。
// 下载/状态能力直接 import 各 local-* 域模块；"已应用的设置目录"等壳层状态经 deps 注入。
import { downloadLocalReviewerModel, localReviewerModelStatus } from "../../local-reviewer.mts";
import { downloadLocalAsrModel, downloadLocalAsrRuntime, localAsrAllModelsStatus, localAsrModelStatus, localAsrRuntimeStatus } from "../../local-asr.mts";
import { downloadLocalTtsModel, localTtsAllModelsStatus, localTtsModelStatus, localTtsRuntimeStatus, normalizeTtsModelId } from "../../local-tts.mts";
import { normalizeTtsEngine } from "../../settings.mts";

export function localModelsIpcPlugin(deps) {
  return {
    name: "ipc:local-models",
    apply(ctx) {
      const { trustedHandle, dialog, getMainWindow, app, path, fs, readSettings, applyAsrSettings, asrSettingsFrom, applyTtsSettings, getAsrServerPath } = deps;
      // 下载进度推给渲染端：窗口在插件 apply 之后才创建、且可能重建，必须每次现取
      const notify = (channel, payload) => {
        const win = getMainWindow();
        if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
      };

trustedHandle("reviewer-local:status", () => localReviewerModelStatus());

trustedHandle("reviewer-local:download", async () => {
  try {
    const result = await downloadLocalReviewerModel({
      onProgress: (progress) => {
        notify("reviewer-local:download-progress", progress);
      },
    });
    return { ok: true, ...result, status: localReviewerModelStatus() };
  } catch (error: any) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

trustedHandle("reviewer-local:choose-dir", async () => {
  const result = await dialog.showOpenDialog(getMainWindow(), {
    title: "选择审核模型保存目录",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  return { canceled: false, path: result.filePaths[0] };
});

trustedHandle("voice-local:status", async () => {
  const saved = await readSettings();
  const modelId = applyAsrSettings(saved);
  return {
    engine: asrSettingsFrom(saved).engine,
    model: localAsrModelStatus(modelId),
    models: localAsrAllModelsStatus(),
    runtime: localAsrRuntimeStatus(getAsrServerPath()),
  };
});

trustedHandle("voice-local:download", async (_event, payload) => {
  try {
    // 先应用磁盘上的最新设置：改了保存路径后无需重启，下载直接落到新目录
    const saved = await readSettings();
    const savedModelId = applyAsrSettings(saved);
    // 下载界面当前选中的模型（未指定时用设置里保存的模型）
    const requestedModelId = String(payload?.modelId || "").trim() || savedModelId;
    // 再拉引擎二进制（十几 MB），最后拉模型两个文件（约 1-3GB），进度统一推送
    await downloadLocalAsrRuntime({
      onProgress: (progress) => {
        notify("voice-local:download-progress", progress);
      },
    });
    await downloadLocalAsrModel({
      modelId: requestedModelId,
      onProgress: (progress) => {
        notify("voice-local:download-progress", { ...progress, modelId: requestedModelId });
      },
    });
    return {
      ok: true,
      status: {
        model: localAsrModelStatus(requestedModelId),
        models: localAsrAllModelsStatus(),
        runtime: localAsrRuntimeStatus(getAsrServerPath()),
      },
    };
  } catch (error: any) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

trustedHandle("voice-local:choose-dir", async () => {
  const result = await dialog.showOpenDialog(getMainWindow(), {
    title: "选择语音模型保存目录",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  return { canceled: false, path: result.filePaths[0] };
});

trustedHandle("tts-local:status", async () => {
  const saved = await readSettings();
  const modelId = applyTtsSettings(saved);
  return {
    engine: normalizeTtsEngine(saved.ttsEngine),
    model: localTtsModelStatus(modelId),
    models: localTtsAllModelsStatus(),
    runtime: localTtsRuntimeStatus(),
  };
});

trustedHandle("tts-local:download", async (_event, payload) => {
  try {
    // 先应用磁盘上的最新设置：改了保存路径后无需重启，下载直接落到新目录
    const saved = await readSettings();
    const savedModelId = applyTtsSettings(saved);
    // 下载界面当前选中的模型（未指定时用设置里保存的模型）
    const requested = String(payload?.modelId || "").trim();
    const requestedModelId = requested ? normalizeTtsModelId(requested) : savedModelId;
    // 引擎二进制与 ASR 共用（llama-tts 在同一压缩包里），没有就先拉运行时，再拉模型（约 1.5-2.3GB）
    await downloadLocalAsrRuntime({
      onProgress: (progress) => {
        notify("tts-local:download-progress", { ...progress, phase: `runtime:${progress.phase}` });
      },
    });
    await downloadLocalTtsModel({
      modelId: requestedModelId,
      onProgress: (progress) => {
        notify("tts-local:download-progress", { ...progress, modelId: requestedModelId });
      },
    });
    return {
      ok: true,
      status: {
        model: localTtsModelStatus(requestedModelId),
        models: localTtsAllModelsStatus(),
        runtime: localTtsRuntimeStatus(),
      },
    };
  } catch (error: any) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

trustedHandle("tts-local:choose-dir", async () => {
  const result = await dialog.showOpenDialog(getMainWindow(), {
    title: "选择语音合成模型保存目录",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  return { canceled: false, path: result.filePaths[0] };
});

trustedHandle("tts-local:choose-voice", async () => {
  const result = await dialog.showOpenDialog(getMainWindow(), {
    title: "选择参考音色音频",
    properties: ["openFile"],
    filters: [{ name: "音频", extensions: ["wav", "mp3", "flac", "ogg", "m4a", "aac", "opus", "webm"] }],
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  return { canceled: false, path: result.filePaths[0] };
});

trustedHandle("tts-local:read-voice", async (_event, payload) => {
  const voicePath = String(payload?.path || "").trim();
  if (!voicePath) return { ok: false, error: "缺少音频路径" };
  try {
    const stat = await fs.stat(voicePath);
    if (stat.size > 100 * 1024 * 1024) return { ok: false, error: "音频文件过大（超过 100MB）" };
    return { ok: true, bytes: new Uint8Array(await fs.readFile(voicePath)) };
  } catch (error: any) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

trustedHandle("tts-local:write-voice", async (_event, payload) => {
  const bytes = payload?.bytes;
  if (!(bytes instanceof Uint8Array) || bytes.length <= 44) {
    return { ok: false, error: "转换结果无效" };
  }
  try {
    const target = path.join(app.getPath("userData"), "tts-voice-converted.wav");
    await fs.writeFile(target, Buffer.from(bytes));
    return { ok: true, path: target };
  } catch (error: any) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});
    },
  };
}
