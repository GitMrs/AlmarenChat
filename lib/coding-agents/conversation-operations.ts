interface ConversationRun {
  controller: AbortController;
  done: Promise<void>;
  finish: () => void;
}

interface ConversationState {
  run?: ConversationRun;
  editing: boolean;
}

const globalState = globalThis as unknown as { studioConversationOperations?: Map<string, ConversationState> };
const conversations = globalState.studioConversationOperations ??= new Map<string, ConversationState>();

function busy(): never {
  throw Object.assign(new Error('当前工作区正在执行或更新对话，请稍候再试'), { status: 409 });
}

/** Covers the whole request, including startup and the final database writes. */
export function beginStudioConversationRun(userId: string, workspaceId: string): ConversationRun {
  const key = `${userId}:${workspaceId}`;
  const state = conversations.get(key) || { editing: false };
  if (state.editing || state.run) busy();
  let resolve!: () => void;
  const run: ConversationRun = {
    controller: new AbortController(),
    done: new Promise<void>((done) => { resolve = done; }),
    finish() {
      if (state.run !== run) return;
      state.run = undefined;
      resolve();
      if (!state.editing) conversations.delete(key);
    },
  };
  state.run = run;
  conversations.set(key, state);
  return run;
}

export async function editStudioConversation<T>(
  userId: string,
  workspaceId: string,
  cancelActive: boolean,
  edit: () => Promise<T>
): Promise<T> {
  const key = `${userId}:${workspaceId}`;
  const state = conversations.get(key) || { editing: false };
  if (state.editing || (state.run && !cancelActive)) busy();
  state.editing = true;
  conversations.set(key, state);
  try {
    if (state.run) {
      state.run.controller.abort();
      await state.run.done;
    }
    return await edit();
  } finally {
    state.editing = false;
    conversations.delete(key);
  }
}
