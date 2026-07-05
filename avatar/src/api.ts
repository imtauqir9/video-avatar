export type Conversation = { conversation_url: string; conversation_id: string };

export async function createConversation(): Promise<Conversation> {
  const r = await fetch("/api/conversations", { method: "POST" });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || `Failed to create conversation (HTTP ${r.status})`);
  }
  return r.json();
}

export async function endConversation(id: string): Promise<void> {
  await fetch(`/api/conversations/${id}/end`, { method: "POST" }).catch(() => {});
}
