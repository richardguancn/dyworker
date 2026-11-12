#!/usr/bin/env python3
"""DYWorker 本地决策模型服务：包装官方 inference.py 的 DecisionEngine。

暴露与远程服务一致的两个端点（仅监听 127.0.0.1）：
  GET  /health          模型加载并预热完成后返回 {"status": "ok"}
  POST /v1/decisions    请求体 {state, questions}，原样返回 engine.predict 的结果

只用标准库起 HTTP：依赖越少，pip 安装面越小、启动越稳。设备自动 cuda → mps → cpu。
"""

import argparse
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def build_engine(model_dir):
    sys.path.insert(0, model_dir)
    import torch

    if torch.cuda.is_available():
        device = "cuda"
    elif getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
        device = "mps"
    else:
        device = "cpu"
    print(f"[decision] loading DecisionEngine from {model_dir} (device={device})", file=sys.stderr, flush=True)
    from inference import DecisionEngine

    engine = DecisionEngine(checkpoint=model_dir, device=device)
    print("[decision] engine loaded, warming up", file=sys.stderr, flush=True)
    # 预热：消化首次 forward 的延迟，/health 返回 ok 即代表可立即判定
    engine.predict({
        "state": "This is a warmup request.",
        "questions": {"ok": {"type": "noul", "instructions": "Is this a warmup request?"}},
    })
    print("[decision] ready", file=sys.stderr, flush=True)
    return engine


def main():
    parser = argparse.ArgumentParser(description="DYWorker local decision model server")
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()

    engine = build_engine(args.model_dir)
    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def _json(self, code, payload):
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == "/health":
                self._json(200, {"status": "ok"})
            else:
                self._json(404, {"error": "not found"})

        def do_POST(self):
            if self.path not in ("/v1/decisions", "/v1/jev"):
                self._json(404, {"error": "not found"})
                return
            try:
                length = int(self.headers.get("Content-Length") or 0)
                request = json.loads(self.rfile.read(length).decode("utf-8"))
            except Exception as error:
                self._json(400, {"error": f"invalid request body: {error}"})
                return
            try:
                # DecisionEngine 的 forward 不是并发安全：全局锁串行化，判定本身是单次 forward
                with lock:
                    result = engine.predict(request)
                self._json(200, result)
            except Exception as error:
                self._json(500, {"error": str(error)})

        def log_message(self, fmt, *log_args):
            # 静默访问日志：避免长驻进程把管道写满
            pass

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.daemon_threads = True
    server.serve_forever()


if __name__ == "__main__":
    main()
