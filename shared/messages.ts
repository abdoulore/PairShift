// Messages a wallet signs; shared so the browser and server build byte-identical text.
export function intentMessage(owner: string, payload: unknown, ts: number): string {
  return `Tandem: authorize switch\nowner: ${owner}\nts: ${ts}\nintent: ${JSON.stringify(payload)}`;
}

export function cancelMessage(owner: string, id: string, ts: number): string {
  return `Tandem: cancel switch\nowner: ${owner}\nts: ${ts}\nid: ${id}`;
}
