// 会话只保存选择，不复制密钥；每次运行从设置里取得对应配置的最新凭据。
export interface SessionModelSelection {
  profileId?: string;
  endpoint: string;
  model: string;
  reasoningEffort: string;
}

export function modelSelection(settings: any, profileId?: string): SessionModelSelection | undefined {
  if (!settings?.endpoint || !settings?.model) return undefined;
  const profile = settings.profiles?.find((item: any) => item.endpoint === settings.endpoint && item.model === settings.model
    && item.apiKey === settings.apiKey);
  return { profileId: profileId || profile?.id, endpoint: settings.endpoint, model: settings.model,
    reasoningEffort: settings.reasoningEffort || '' };
}

export function bindSessionModel<T extends { modelSelection?: SessionModelSelection; contextModel?: string; contextEndpoint?: string }>(session: T, settings: any): T {
  if (session.modelSelection) return session;
  // 旧会话有实际使用记录时优先恢复该模型；没有记录才采用默认模型。
  const profile = settings.profiles?.find((item: any) => item.model === session.contextModel && item.endpoint === session.contextEndpoint);
  const selection = modelSelection(profile ? { ...settings, ...profile }
    : session.contextModel && session.contextEndpoint
      ? { ...settings, endpoint: session.contextEndpoint, model: session.contextModel,
        apiKey: settings.endpoint === session.contextEndpoint && settings.model === session.contextModel ? settings.apiKey : '',
        reasoningEffort: settings.endpoint === session.contextEndpoint && settings.model === session.contextModel ? settings.reasoningEffort : '' }
      : settings);
  return selection ? { ...session, modelSelection: selection } : session;
}

export function settingsForSession<T extends { endpoint: string; model: string; apiKey: string; reasoningEffort?: string }>(settings: T, session?: { modelSelection?: SessionModelSelection } | null): T {
  const selection = session?.modelSelection;
  if (!selection) return settings;
  const profiles = (settings as any).profiles || [];
  const matches = (item: any) => item.endpoint === selection.endpoint && item.model === selection.model;
  const profile = profiles.find((item: any) => item.id === selection.profileId && matches(item))
    || profiles.find(matches);
  // 配置被删除后仍显示原选择，但不能拿另一个模型的密钥静默改跑。
  return { ...settings, endpoint: selection.endpoint, model: selection.model,
    apiKey: profile?.apiKey ?? (matches(settings) ? settings.apiKey : ''),
    ...(profile?.transcriptionEndpoint !== undefined ? { transcriptionEndpoint: profile.transcriptionEndpoint } : {}),
    ...(profile?.transcriptionModel ? { transcriptionModel: profile.transcriptionModel } : {}),
    reasoningEffort: selection.reasoningEffort };
}
