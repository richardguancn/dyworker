#!/usr/bin/env python3
"""Linux 应用进程树采样；仅记录资源数值，不读取命令行、环境或聊天内容。"""
import argparse
import json
import os
from pathlib import Path
import sys
import time


def fields(path):
    try:
        return {line.split(':', 1)[0]: int(line.split(':', 1)[1].split()[0])
                for line in path.read_text().splitlines() if ':' in line}
    except (OSError, ValueError, IndexError):
        return {}


def process_stat(path):
    try:
        raw = path.read_text()
        end = raw.rindex(')')
        parts = raw[end + 2:].split()  # 从 stat 的第 3 字段开始
        return {'pid': int(path.parent.name), 'name': raw[raw.index('(') + 1:end],
                'ppid': int(parts[1]), 'cpu_ticks': int(parts[11]) + int(parts[12]),
                'start_ticks': int(parts[19]), 'rss_bytes': int(parts[21]) * os.sysconf('SC_PAGE_SIZE')}
    except (OSError, ValueError, IndexError):
        return None


def sample(proc, root_pid, previous, elapsed):
    rows = {}
    for entry in proc.iterdir():
        if entry.name.isdigit():
            row = process_stat(entry / 'stat')
            if row:
                rows[row['pid']] = row
    if root_pid not in rows:
        return None
    selected = {root_pid}
    # 已知子进程被重新托管后仍跟踪；启动时间用于防止进程号复用。
    selected.update(pid for pid, old in previous.items()
                    if pid in rows and old['start_ticks'] == rows[pid]['start_ticks'])
    while True:
        children = {pid for pid, row in rows.items() if row['ppid'] in selected}
        if children <= selected:
            break
        selected |= children
    hz = os.sysconf('SC_CLK_TCK')
    output = []
    current = {}
    for pid in sorted(selected):
        row = rows[pid]
        directory = proc / str(pid)
        io = fields(directory / 'io')
        memory = fields(directory / 'smaps_rollup')
        row.update({'read_bytes': io.get('read_bytes'), 'write_bytes': io.get('write_bytes')})
        old = previous.get(pid)
        comparable = old and old['start_ticks'] == row['start_ticks'] and elapsed > 0
        def delta(name):
            return max(0, row[name] - old[name]) if comparable and row[name] is not None and old.get(name) is not None else None
        ticks = delta('cpu_ticks')
        output.append({'pid': pid, 'ppid': row['ppid'], 'name': row['name'],
                       'cpu_percent_one_core': ticks / hz / elapsed * 100 if ticks is not None else None,
                       'rss_bytes': memory.get('Rss', row['rss_bytes'] // 1024) * 1024,
                       'pss_bytes': memory['Pss'] * 1024 if 'Pss' in memory else None,
                       'read_bytes_delta': delta('read_bytes'), 'write_bytes_delta': delta('write_bytes')})
        current[pid] = row
    totals = {}
    for key in ['cpu_percent_one_core', 'rss_bytes', 'pss_bytes', 'read_bytes_delta', 'write_bytes_delta']:
        values = [row[key] for row in output]
        # 权限不足不当作零，不把不完整的总量当成完整结果。
        totals[key] = sum(values) if all(value is not None for value in values) else None
    return current, {'time': time.time(), 'interval_seconds': elapsed, 'processes': output, 'totals': totals}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pid', type=int, required=True, help='DYWorker 主进程号')
    parser.add_argument('--samples', type=int, default=300)
    parser.add_argument('--interval', type=float, default=1.0)
    parser.add_argument('--output', type=Path, help='JSONL 输出文件；默认标准输出')
    parser.add_argument('--proc-root', type=Path, default=Path('/proc'), help=argparse.SUPPRESS)
    args = parser.parse_args()
    if not 1 <= args.samples <= 3600 or not 0.1 <= args.interval <= 60 or args.pid < 1:
        parser.error('samples 必须为 1—3600，interval 必须为 0.1—60 秒，pid 必须大于零')
    if not (args.proc_root / str(args.pid) / 'stat').exists():
        parser.error('无法读取指定进程，请检查进程号和 /proc 读取权限')
    output = args.output.open('x', encoding='utf-8') if args.output else sys.stdout
    written = 0
    try:
        def emit(record):
            nonlocal written
            line = json.dumps(record, ensure_ascii=False) + '\n'
            written += len(line.encode('utf-8'))
            if written > 10 * 1024 * 1024:
                raise RuntimeError('采样文件达到 10 MB 上限，已停止采样')
            output.write(line)
            output.flush()
        emit({'kind': 'metadata', 'pid': args.pid, 'logical_cpus': os.cpu_count(),
              'cpu_definition': '100% = 一个逻辑核', 'memory_unit': 'bytes',
              'missing_values': 'null 表示首次采样或无法读取；RSS 总和包含共享内存'})
        previous, last = {}, time.monotonic()
        for index in range(args.samples):
            now = time.monotonic()
            result = sample(args.proc_root, args.pid, previous, now - last if index else 0)
            if result is None:
                emit({'kind': 'stopped', 'reason': '主进程已退出'})
                break
            previous, record = result
            emit(record)
            last = now
            if index + 1 < args.samples:
                time.sleep(max(0, args.interval - (time.monotonic() - now)))
    finally:
        if args.output:
            output.close()


if __name__ == '__main__':
    try:
        main()
    except (OSError, RuntimeError) as error:
        sys.exit(str(error))
