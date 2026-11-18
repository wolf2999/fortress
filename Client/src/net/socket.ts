export type BytesHandler = (bytes: Uint8Array) => void;

/** 二进制 websocket。主动 close 之后不再重连。 */
export class NetSocket {
  private ws: WebSocket | null = null;
  private pending: Uint8Array[] = [];
  private timer: number | null = null;
  private userClosed = false;

  constructor(
    private readonly url: string,
    private readonly onMessage: BytesHandler,
    private readonly onOpen: () => void,
    private readonly onClose: () => void,
  ) {}

  connect(): void {
    this.userClosed = false;
    const ws = new WebSocket(this.url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => {
      const queued = this.pending;
      this.pending = [];
      for (const bytes of queued) ws.send(bytes);
      this.onOpen();
    };
    ws.onmessage = (ev: MessageEvent) => {
      this.onMessage(new Uint8Array(ev.data as ArrayBuffer));
    };
    ws.onclose = () => {
      this.onClose();
      if (!this.userClosed) this.schedule();
    };
    ws.onerror = () => ws.close();
  }

  private schedule(): void {
    if (this.timer !== null) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      if (!this.userClosed) this.connect();
    }, 2000);
  }

  send(bytes: Uint8Array): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(bytes);
    else this.pending.push(bytes);
  }

  close(): void {
    this.userClosed = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.pending = [];
  }
}
