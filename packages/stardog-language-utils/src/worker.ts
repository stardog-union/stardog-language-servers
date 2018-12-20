export * from "./common";
import { createConnection } from "vscode-languageserver";
import {
  AbstractMessageReader,
  MessageReader,
  DataCallback
} from "vscode-jsonrpc/lib/messageReader";
import { AbstractMessageWriter, MessageWriter } from "vscode-jsonrpc/lib/messageWriter";

export class WorkerMessageReader extends AbstractMessageReader implements MessageReader {
  constructor(private ctx: Worker) {
    super();
  }
  listen(callback: DataCallback) {
    this.ctx.onmessage = (e: MessageEvent) => callback(e.data);
  }
}

export class WorkerMessageWriter extends AbstractMessageWriter implements MessageWriter {
  constructor(private ctx: Worker) {
    super();
  }
  write(message) {
    this.ctx.postMessage(message);
  }
}

type SomethingLikeDedicatedWorkerGlobalScope = Worker & { close: () => any };
const ctx: SomethingLikeDedicatedWorkerGlobalScope = self as any;
const reader = new WorkerMessageReader(ctx);
const writer = new WorkerMessageWriter(ctx);

export const getWorkerConnection = () => createConnection(reader, writer);
