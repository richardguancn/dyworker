import { Search, X } from "lucide-react";
import { memo, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { filterWorkspaceEntries, takeWorkspaceEntries } from "../../lib/files";
import type { WorkspaceEntry } from "../../types";
import { WorkspaceNode } from "./WorkspaceNode";

type TreeProps = {
  entries: WorkspaceEntry[];
  onOpenFile: (entry: WorkspaceEntry) => void;
  onInsertFile?: (entry: WorkspaceEntry) => void;
};

const WorkspaceRows = memo(function WorkspaceRows({ entries, onOpenFile, onInsertFile, forceExpand }: TreeProps & { forceExpand?: boolean }) {
  return <div className="workspace-tree">
    {entries.map((entry) => <WorkspaceNode entry={entry} key={entry.path} onOpenFile={onOpenFile} onInsertFile={onInsertFile} forceExpand={forceExpand} />)}
  </div>;
});

const SEARCH_BATCH_SIZE = 120;

const WorkspaceSearchResults = memo(function WorkspaceSearchResults({ entries, query, onOpenFile, onInsertFile }: TreeProps & { query: string }) {
  const matches = useMemo(() => filterWorkspaceEntries(entries, query), [entries, query]);
  const [limit, setLimit] = useState(SEARCH_BATCH_SIZE);
  const visible = useMemo(() => takeWorkspaceEntries(matches, limit), [matches, limit]);
  const moreRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!visible.hasMore || !moreRef.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        observer.disconnect();
        setLimit(limit + SEARCH_BATCH_SIZE);
      }
    });
    observer.observe(moreRef.current);
    return () => observer.disconnect();
  }, [limit, visible.hasMore]);

  if (!matches.length) return <p className="panel-empty">没有匹配「{query}」的文件。</p>;
  return <>
    <WorkspaceRows entries={visible.entries} onOpenFile={onOpenFile} onInsertFile={onInsertFile} forceExpand />
    {visible.hasMore && <button ref={moreRef} type="button" className="bare-button workspace-tree-more" onClick={() => setLimit(limit + SEARCH_BATCH_SIZE)}>显示更多</button>}
  </>;
});

export function WorkspaceTree({ entries, workspaceOpen, onOpenFile, onInsertFile }: TreeProps & { workspaceOpen: boolean }) {
  const [fileFilter, setFileFilter] = useState("");
  const keyword = fileFilter.trim();
  const query = useDeferredValue(keyword);
  const resultsRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (resultsRef.current) resultsRef.current.scrollTop = 0;
  }, [query]);

  return <>
    <div className="tool-file-filter">
      <Search size={14} />
      <input placeholder="筛选文件…" aria-label="筛选文件" value={fileFilter} onChange={(event) => setFileFilter(event.target.value)} />
      {keyword && <button className="icon-button subtle tiny" aria-label="清除筛选" title="清除筛选" onClick={() => setFileFilter("")}><X size={13} /></button>}
    </div>
    <div className="file-split-tree-results" ref={resultsRef} aria-busy={keyword !== query}>
      {workspaceOpen && (entries.length ? <>
        <div hidden={Boolean(query)}><WorkspaceRows entries={entries} onOpenFile={onOpenFile} onInsertFile={onInsertFile} /></div>
        {query && <WorkspaceSearchResults key={query} entries={entries} query={query} onOpenFile={onOpenFile} onInsertFile={onInsertFile} />}
      </> : <p className="panel-empty">这个文件夹是空的。</p>)}
    </div>
  </>;
}
