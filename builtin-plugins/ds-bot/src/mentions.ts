export interface TeamMember { id: string; name: string; role?: string }
export interface MentionQuery { start: number; end: number; query: string }

export function memberMentionAt(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, caret);
  const match = /(?:^|[^a-z0-9_.])@([^@\s，。！？、：；]*)$/i.exec(before);
  if (!match) return null;
  return { start: caret - match[1].length - 1, end: caret, query: match[1] };
}

export function memberCandidates(members: TeamMember[], query: string): TeamMember[] {
  const search = query.toLocaleLowerCase();
  return [...members, { id: '__all__', name: '所有人', role: '全体成员' }]
    .filter(member => `${member.name} ${member.role || ''}`.toLocaleLowerCase().includes(search));
}

export function insertMemberMention(text: string, mention: MentionQuery, member: TeamMember) {
  const token = `@${member.name} `;
  return { text: text.slice(0, mention.start) + token + text.slice(mention.end), caret: mention.start + token.length };
}
