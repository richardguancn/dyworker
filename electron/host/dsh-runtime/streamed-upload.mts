/** 单块背压：调用者必须等前一块写完；取消或失败会释放两端等待者。 */
export class StreamedAttachmentUpload {
  private row?: { data: Uint8Array; resolve: () => void; reject: (error: any) => void };
  private wake?: () => void;
  private ended = false;
  private error?: any;
  readonly controller = new AbortController();
  readonly result: Promise<any>;
  constructor(store: any, name?: string) {
    this.result = store.saveFileStream({ data: this.chunks(), signal: this.controller.signal, name });
    void this.result.catch(error => this.abort(error));
  }
  private async *chunks() {
    while (true) {
      if (this.error) throw this.error;
      if (!this.row) {
        if (this.ended) return;
        await new Promise<void>(resolve => this.wake = resolve); continue;
      }
      const row = this.row;
      let consumed = false;
      try { yield row.data; consumed = true; row.resolve(); }
      catch (error) { row.reject(error); throw error; }
      finally { if (consumed && this.row === row) this.row = undefined; }
    }
  }
  write(data: Uint8Array) {
    if (this.error) return Promise.reject(this.error);
    if (this.ended || this.row || data.length > 65536) return Promise.reject(new Error('附件分块顺序或大小无效'));
    return new Promise<void>((resolve, reject) => { this.row = { data, resolve, reject }; this.wake?.(); this.wake = undefined; });
  }
  end() { if (this.row) throw new Error('前一块附件仍在保存'); this.ended = true; this.wake?.(); return this.result; }
  abort(error = new Error('附件上传已取消')) {
    this.error ??= error; this.controller.abort(this.error); this.row?.reject(this.error); this.wake?.(); this.wake = undefined;
  }
}
