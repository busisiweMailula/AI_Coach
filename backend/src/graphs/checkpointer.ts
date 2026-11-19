import { MemorySaver } from "@langchain/langgraph";

let saver: MemorySaver | undefined;

export async function getJsonCheckpointer(): Promise<MemorySaver> {
  if (!saver) saver = new MemorySaver();
  return saver;
}

export function resetJsonCheckpointer(): void {
  saver = undefined;
}
