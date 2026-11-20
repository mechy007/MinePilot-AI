export interface FriendSession { sessionId: string; hostXuid: string; hostGamertag?: string }
export function selectOwnerSession(sessions: readonly FriendSession[], ownerXuid: string): FriendSession {
  if (!/^\d+$/.test(ownerXuid)) throw new Error('Owner XUID must be numeric');
  const matches = sessions.filter(s => s.hostXuid === ownerXuid);
  if (matches.length !== 1) throw new Error(matches.length ? 'Multiple owner sessions; explicit selection required' : 'Owner session not found');
  return matches[0];
}
