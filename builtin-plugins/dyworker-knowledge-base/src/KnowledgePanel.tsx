/**
 * 知识库管理面板 — 全局设置中的知识库。
 *
 * v0.3：目录浏览器（类操作系统文件管理器）。
 *   - 面包屑导航：根 → 分类 → 文件，可点击任意层级，可返回上一级
 *   - 根视图：分类文件夹（点开进入）
 *   - 分类视图：文件列表（打开 / 重命名 / 移动到其他目录）
 *   - 文件视图：切块条目列表
 *   - 重命名与移动均支持，改动即时持久化
 * 数据交互走同插件的 /api/kb/* 端点。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { KnowledgeGraph } from './KnowledgeGraph'
import { isLocalSource, localSourcePath } from '../local-source.js'
type ConvViewProps = Record<string, unknown>
type LocalFoldersResult = Awaited<ReturnType<NonNullable<Window['dyworker']>['knowledgeLocalFolders']>>

function t(key: string, fallback: string): string {
  if (typeof window !== 'undefined') {
    return (window as any).__dyworker_i18n__?.t(key, fallback) ?? fallback
  }
  return fallback
}

interface KbEntry {
  id: number
  category: string
  name: string
  summary: string
  source: string | null
  updatedAt: string
  tags: string[]
}

interface MemoryEntry {
  id: string
  name: string
  category: string
  content: string
  scope: 'global' | 'workspace'
  workspacePath: string
}

type SearchEntry = KbEntry & { detail?: unknown }

interface SearchResults {
  keyword: string
  entries: SearchEntry[]
  memories: MemoryEntry[]
  error: string
}

function searchExcerpt(entry: SearchEntry, keyword: string): ReactNode {
  if (typeof entry.detail !== 'string') return entry.summary
  const body = entry.detail.replace(/\s+/g, ' ').trim()
  const literal = keyword.replace(/\s+/g, ' ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(literal, 'iu').exec(body)
  if (!match) return entry.summary

  const before = Array.from(body.slice(0, match.index))
  const after = Array.from(body.slice(match.index + match[0].length))
  return <>
    {before.length > 36 ? '…' : ''}{before.slice(-36).join('')}
    <strong style={{ color: 'var(--ink, #374151)' }}>{match[0]}</strong>
    {after.slice(0, 84).join('')}{after.length > 84 ? '…' : ''}
  </>
}

interface ImportResult {
  imported: number
  source: string
  ids: number[]
  category: string
  suggestedCategory: string | null
  categories: string[]
}

/** AI 分类建议（/api/kb/classify）。 */
interface ClassifySuggestion {
  source: string
  category?: string
  name?: string
  tags?: string[]
  error?: string
}

interface FolderInfo {
  category: string
  files: number
  count: number
}

interface FileInfo {
  source: string | null
  category: string
  updatedAt: string
  count: number
}

/** 当前浏览位置（两级：根 → 分类；分类内直接展示文件分组与条目）。 */
type View =
  | { kind: 'root' }
  | { kind: 'category'; category: string }
  | { kind: 'memories' }

/** 正在重命名的对象。 */
type Editing = { kind: 'category' | 'file'; value: string } | null

/** 正在执行"移动到"操作的文件。 */
type Moving = { source: string } | null

/** 文件分组折叠状态（默认展开，记录被折叠的文件）。 */

const card: React.CSSProperties = {
  border: '1px solid var(--border, #e5e7eb)', borderRadius: 10, padding: '14px 16px',
  background: 'var(--card, #fff)', boxShadow: '0 1px 3px rgba(16,24,40,.06)',
}

const heading: React.CSSProperties = { margin: '0 0 4px', fontSize: 16, fontWeight: 600 }

const sub: React.CSSProperties = { margin: '0 0 12px', fontSize: 12.5, color: 'var(--muted, #6b7280)' }

const dropZone: React.CSSProperties = {
  border: '2px dashed var(--border-strong, #cbd5e1)', borderRadius: 8, padding: '18px',
  textAlign: 'center', fontSize: 13, color: 'var(--muted, #6b7280)', cursor: 'pointer',
  background: 'var(--surface, #f9fafb)', transition: 'border-color .15s',
}

const breadcrumb: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5,
  padding: '2px 0 10px', color: 'var(--muted, #6b7280)', flexWrap: 'wrap',
}

const crumb: React.CSSProperties = { cursor: 'pointer', color: 'var(--accent, #2563eb)', fontWeight: 500 }

const crumbCurrent: React.CSSProperties = { color: 'var(--ink, #1f2937)', fontWeight: 600 }

const backBtn: React.CSSProperties = {
  border: '1px solid var(--border, #d1d5db)', background: 'var(--card, #fff)', borderRadius: 6,
  padding: '2px 10px', fontSize: 12, cursor: 'pointer', color: 'var(--ink, #374151)',
}

const row: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px',
  borderRadius: 6, fontSize: 13, cursor: 'pointer',
}

const rowActions: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }

const smallBtn: React.CSSProperties = {
  border: '1px solid var(--border, #d1d5db)', background: 'var(--card, #fff)', borderRadius: 6,
  padding: '2px 8px', fontSize: 11.5, cursor: 'pointer', color: 'var(--ink, #374151)',
}

const primaryBtn: React.CSSProperties = {
  border: '1px solid var(--accent, #2563eb)', background: 'var(--accent, #2563eb)', color: '#fff',
  borderRadius: 6, padding: '2px 8px', fontSize: 11.5, cursor: 'pointer',
}

const renameInput: React.CSSProperties = {
  border: '1px solid var(--accent, #2563eb)', borderRadius: 6, padding: '3px 8px',
  fontSize: 13, outline: 'none', width: 260,
}

const iconSize: React.CSSProperties = { fontSize: 18, flexShrink: 0 }

const meta: React.CSSProperties = { fontSize: 11.5, color: 'var(--muted, #9ca3af)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

const inputStyle: React.CSSProperties = {
  border: '1px solid var(--border, #d1d5db)', borderRadius: 8, padding: '8px 12px',
  fontSize: 13, outline: 'none', flex: '1 1 180px', minWidth: 0,
}

const button: React.CSSProperties = {
  border: '1px solid var(--border, #d1d5db)', background: 'var(--card, #fff)', borderRadius: 8,
  padding: '8px 14px', fontSize: 13, cursor: 'pointer', color: 'var(--accent, #2563eb)',
}

const primaryButton: React.CSSProperties = { ...button, background: 'var(--accent, #2563eb)', color: '#fff', borderColor: 'var(--accent, #2563eb)' }

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
  return (await res.json()) as T
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const raw = String(reader.result ?? '')
      const idx = raw.indexOf(',')
      resolve(idx === -1 ? raw : raw.slice(idx + 1))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

const FILE_PAGE_SIZE = 50

export function KnowledgePanel(_props: ConvViewProps): ReactNode {
  const [mode, setMode] = useState<'graph' | 'directory'>('graph')
  const [filePageData, setFilePageData] = useState<{ category: string; page: number; files: FileInfo[] }>()
  const [filePageError, setFilePageError] = useState('')
  const [folderCounts, setFolderCounts] = useState<FolderInfo[]>([])
  const [directoryVersion, setDirectoryVersion] = useState(0)
  const [categories, setCategories] = useState<string[]>([])
  const [importing, setImporting] = useState(false)
  const [importingLabel, setImportingLabel] = useState('导入中…')
  const [lastImport, setLastImport] = useState<ImportResult | null>(null)
  const [view, setView] = useState<View>({ kind: 'root' })
  const [editing, setEditing] = useState<Editing>(null)
  const [moving, setMoving] = useState<Moving>(null)
  const [hoveredFolder, setHoveredFolder] = useState<string | null>(null)
  const [openFile, setOpenFile] = useState<FileInfo | null>(null)
  const [fileEntries, setFileEntries] = useState<KbEntry[]>([])
  const [fileLoading, setFileLoading] = useState(false)
  const [fileError, setFileError] = useState('')
  const [filePage, setFilePage] = useState(0)
  const fileRequest = useRef(0)
  const [localFolders, setLocalFolders] = useState<NonNullable<LocalFoldersResult['folders']>>([])
  const [localReport, setLocalReport] = useState<LocalFoldersResult['report']>()
  const [localBusy, setLocalBusy] = useState(false)
  const [localProgress, setLocalProgress] = useState<LocalFoldersResult['progress']>()
  const [localError, setLocalError] = useState('')
  const [creatingCategory, setCreatingCategory] = useState(false)
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null)
  const [searching, setSearching] = useState(false)
  const searchRequest = useRef(0)
  const [memories, setMemories] = useState<MemoryEntry[]>([])
  const [memoryError, setMemoryError] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportMessage, setExportMessage] = useState('')
  const exportKnowledge = async () => {
    setExportMessage(''); setExporting(true)
    try {
      if (!window.dyworker?.exportKnowledge) throw new Error('当前环境不支持导出')
      const result = await window.dyworker.exportKnowledge({ kind: 'knowledge' })
      if (!result.ok) throw new Error(result.error || '导出失败')
      if (!result.canceled) setExportMessage(`已导出到 ${result.path}`)
    } catch (error) { setExportMessage(`导出失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setExporting(false) }
  }
  // AI 整理
  const [classifying, setClassifying] = useState(false)
  const [suggestions, setSuggestions] = useState<ClassifySuggestion[] | null>(null)
  const [accepted, setAccepted] = useState<Set<number>>(new Set())
  const fileInput = useRef<HTMLInputElement>(null)
  const editInput = useRef<HTMLInputElement>(null)
  const createInput = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    try {
      const data = await getJson<{ counts: FolderInfo[]; categories: string[] }>('/api/kb/files?summary=1')
      setFolderCounts(data.counts)
      setCategories(data.categories)
      setDirectoryVersion(version => version + 1)
    } catch (error) {
      console.error('knowledge-base: list failed', error)
    }
    try {
      const data = await getJson<{ rows: MemoryEntry[] }>('/api/kb/memories')
      setMemories(data.rows); setMemoryError('')
    } catch { setMemoryError('个人记忆读取失败，请稍后重试。') }
  }, [])

  const refreshLocalFolders = useCallback(async () => {
    if (!window.dyworker?.knowledgeLocalFolders) return
    try {
      const result = await window.dyworker.knowledgeLocalFolders({ action: 'list' })
      if (!result.ok) throw new Error(result.error || '本地目录读取失败')
      setLocalFolders(result.folders ?? [])
    } catch (error) { setLocalError(error instanceof Error ? error.message : String(error)) }
  }, [])

  useEffect(() => { if (mode === 'directory') { void refresh(); void refreshLocalFolders() } }, [mode, refresh, refreshLocalFolders])

  useEffect(() => {
    if (!localBusy) { setLocalProgress(undefined); return }
    let active = true
    const timer = window.setInterval(async () => {
      try {
        const result = await window.dyworker?.knowledgeLocalFolders({ action: 'list' })
        if (active && result?.progress) setLocalProgress(result.progress)
      } catch { /* 最终结果由目录操作返回。 */ }
    }, 500)
    return () => { active = false; window.clearInterval(timer) }
  }, [localBusy])

  const loadFileEntries = async (file: FileInfo, offset = 0) => {
    const request = ++fileRequest.current
    if (!offset) setFileEntries([])
    setFileLoading(true)
    setFileError('')
    try {
      const params = new URLSearchParams({ source: file.source ?? '', category: file.category, offset: String(offset) })
      const { rows } = await getJson<{ rows: KbEntry[] }>(`/api/kb/list?${params}`)
      if (request === fileRequest.current) setFileEntries(previous => offset ? [...previous, ...rows] : rows)
    } catch {
      if (request === fileRequest.current) setFileError('读取文件条目失败，请重试。')
    } finally { if (request === fileRequest.current) setFileLoading(false) }
  }

  const changeView = (next: View) => {
    setView(next)
    setOpenFile(null)
    setFilePage(0)
  }

  const clearSearchResults = () => {
    searchRequest.current++
    setSearching(false)
    setSearchResults(null)
  }

  const manageLocalFolder = async (action: 'connect' | 'refresh' | 'disconnect', id?: string) => {
    const bridge = window.dyworker
    if (!bridge?.knowledgeLocalFolders) return
    if (action === 'disconnect' && !window.confirm('断开后，此目录的资料会从知识库移除，本地文件会保留。确定断开吗？')) return
    setLocalBusy(true)
    setLocalReport(undefined)
    setLocalError('')
    try {
      const result = await bridge.knowledgeLocalFolders({ action, id, category: view.kind === 'category' ? view.category : undefined })
      if (result.canceled) return
      if (result.folders) setLocalFolders(result.folders)
      await refresh()
      clearSearchResults()
      setOpenFile(null)
      if (!result.ok) throw new Error(result.error || '本地目录更新失败')
      setLocalReport(result.report)
    } catch (error) { setLocalError(error instanceof Error ? error.message : String(error)) }
    finally { setLocalBusy(false) }
  }

  // 编辑框自动聚焦。
  useEffect(() => {
    if (editing !== null) editInput.current?.focus()
  }, [editing])

  // 新建目录输入框自动聚焦。
  useEffect(() => {
    if (creatingCategory) createInput.current?.focus()
  }, [creatingCategory])

  /** 新建目录。 */
  const createCategory = useCallback(async (name: string) => {
    setCreatingCategory(false)
    const trimmed = name.trim()
    if (trimmed === '') return
    try {
      await postJson('/api/kb/create-category', { name: trimmed })
      await refresh()
    } catch (error) {
      window.alert(`新建目录失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }, [refresh])

  /** 删除空目录。 */
  const deleteCategory = useCallback(async (name: string) => {
    if (!window.confirm(`删除目录「${name}」？仅空目录可删除。`)) return
    try {
      await postJson('/api/kb/delete-category', { name })
      await refresh()
    } catch (error) {
      window.alert(`删除失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }, [refresh])

  const importFile = useCallback(async (file: File, category?: string): Promise<ImportResult> => {
    if (file.size > 20 * 1024 * 1024) throw new Error('单个文件不能超过 20 MB')
    const contentBase64 = await fileToBase64(file)
    const result = await postJson<ImportResult>('/api/kb/import', { name: file.name, contentBase64, category })
    return result
  }, [])

  /** 批量导入：逐个上传（顺序执行，避免并发打爆端点），显示进度。 */
  const importFiles = useCallback(async (files: File[], category?: string) => {
    if (files.length === 0) return
    setImporting(true)
    setImportingLabel('导入中…')
    setLastImport(null)
    const total = files.length
    let done = 0
    let failed = 0
    let lastOk: ImportResult | null = null
    for (const file of files) {
      try {
        lastOk = await importFile(file, category)
      } catch (error) {
        failed++
        console.error(`knowledge-base: import failed: ${file.name}`, error)
      }
      done++
      setImportingLabel(`导入中（${done}/${total}）`)
    }
    setImporting(false)
    if (lastOk !== null) {
      setLastImport(lastOk)
    }
    await refresh()
    if (failed > 0) {
      window.alert(`导入完成：成功 ${total - failed}/${total}，失败 ${failed} 个文件`)
    }
  }, [importFile, refresh])

  /** 触发 AI 整理：对未分类文件生成建议。 */
  const runClassify = useCallback(async () => {
    setClassifying(true)
    setSuggestions(null)
    setAccepted(new Set())
    try {
      const data = await postJson<{ suggestions: ClassifySuggestion[] }>('/api/kb/classify', {})
      setSuggestions(data.suggestions)
      // 默认全选无错误的建议
      setAccepted(new Set(
        data.suggestions.map((_, i) => i).filter((i) => data.suggestions[i]?.error === undefined),
      ))
    } catch (error) {
      window.alert(`AI 分析失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setClassifying(false)
    }
  }, [])

  /** 采纳建议：对选中的文件应用分类/改名。 */
  const applySuggestions = useCallback(async () => {
    if (suggestions === null) return
    let ok = 0
    let failed = 0
    for (const i of accepted) {
      const s = suggestions[i]
      if (s === undefined || s.error !== undefined) continue
      try {
        // 分类变化 → 移动
        if (s.category) {
          await postJson('/api/kb/move-file', { source: s.source, category: s.category })
        }
        // 文件名变化 → 重命名（改名后 source 变了，后续引用用新名）
        if (s.name !== undefined && s.name !== '' && !s.source.includes(s.name)) {
          const newName = `${s.name}${s.source.slice(s.source.lastIndexOf('.'))}`
          await postJson('/api/kb/rename-file', { source: s.source, newSource: newName })
        }
        ok++
      } catch (error) {
        failed++
        console.error(`apply suggestion failed: ${s.source}`, error)
      }
    }
    setSuggestions(null)
    await refresh()
    if (failed > 0) window.alert(`整理完成：成功 ${ok} 个，失败 ${failed} 个`)
  }, [accepted, suggestions, refresh])

  /** 提交重命名（分类或文件）。分类改名后回根视图；文件改名留在当前分类视图。 */
  const submitRename = useCallback(async (value: string) => {
    const target = editing
    setEditing(null)
    if (target === null) return
    const name = value.trim()
    if (name === '' || name === target.value) return
    try {
      if (target.kind === 'category') {
        await postJson('/api/kb/rename-category', { oldCategory: target.value, newCategory: name })
        await refreshLocalFolders()
        setView({ kind: 'root' })
        setOpenFile(null)
        setFilePage(0)
      } else {
        await postJson('/api/kb/rename-file', { source: target.value, newSource: name })
        setOpenFile(null)
      }
      await refresh()
    } catch (error) {
      window.alert(`重命名失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }, [editing, refresh, refreshLocalFolders])

  /** 移动文件到目标分类；留在当前分类视图（文件从列表消失）。 */
  const moveTo = useCallback(async (source: string, category: string) => {
    setMoving(null)
    try {
      await postJson('/api/kb/move-file', { source, category })
      await refresh()
    } catch (error) {
      window.alert(`移动失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }, [refresh])

  /** 折叠/展开文件分组。 */
  const toggleFile = (file: FileInfo) => {
    if (openFile?.source === file.source) { setOpenFile(null); return }
    setOpenFile(file)
    void loadFileEntries(file)
  }

  /** 删除整个文件（该文件所有条目）。 */
  const deleteFile = useCallback(async (source: string) => {
    if (!window.confirm(`删除文件「${source}」？其所有条目将一并删除。`)) return
    try {
      await postJson('/api/kb/delete-file', { source })
      setOpenFile(null)
      await refresh()
    } catch (error) {
      window.alert(`删除失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }, [refresh])

  /** 删除单个条目。 */
  const deleteEntry = useCallback(async (id: number) => {
    if (!window.confirm('删除这条内容？')) return
    try {
      await postJson('/api/kb/delete-entry', { id })
      setFileEntries(previous => previous.filter(entry => entry.id !== id))
      await refresh()
    } catch (error) {
      window.alert(`删除失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }, [refresh])

  const runSearch = async () => {
    const keyword = query.trim()
    if (!keyword) return
    const request = ++searchRequest.current
    setSearching(true)
    const [documents, personalMemories] = await Promise.allSettled([
      getJson<{ rows: SearchEntry[] }>(`/api/kb/search?q=${encodeURIComponent(keyword)}`),
      getJson<{ rows: MemoryEntry[] }>('/api/kb/memories'),
    ])
    if (request !== searchRequest.current) return

    const matchingKeyword = keyword.toLowerCase()
    const matchingMemories = personalMemories.status === 'fulfilled'
      ? personalMemories.value.rows.filter(item => `${item.name} ${item.category} ${item.content}`.toLowerCase().includes(matchingKeyword))
      : []
    if (personalMemories.status === 'fulfilled') {
      setMemories(personalMemories.value.rows)
      setMemoryError('')
    }
    let error = ''
    if (documents.status === 'rejected') error = '资料检索失败，请重试。'
    if (personalMemories.status === 'rejected') {
      error = error ? '检索失败，请重试。' : '个人记忆检索失败，请重试。'
    }
    setSearchResults({
      keyword,
      entries: documents.status === 'fulfilled' ? documents.value.rows : [],
      memories: matchingMemories,
      error,
    })
    setSearching(false)
  }

  const folders = new Map<string, FolderInfo>(categories.map(category => [category, { category, files: 0, count: 0 }]))
  for (const folder of folderCounts) folders.set(folder.category, folder)
  const fullFolders = [...folders.values()]
  // 面包屑不含根级：根视图（知识库首页）不显示面包屑，从分类级开始。
  const breadcrumbs: Array<{ label: string; onClick: () => void; current: boolean }> = []
  if (view.kind === 'category') {
    breadcrumbs.push({
      label: view.category,
      onClick: () => changeView({ kind: 'category', category: view.category }),
      current: true,
    })
  }

  // 当前视图数据
  const activeCategory = view.kind === 'category' ? view.category : null
  const fileCount = activeCategory !== null ? folders.get(activeCategory)?.files ?? 0 : 0
  const lastPage = Math.max(0, Math.ceil(fileCount / FILE_PAGE_SIZE) - 1)
  const currentPage = Math.min(filePage, lastPage)
  const currentFiles = filePageData?.category === activeCategory && filePageData.page === currentPage ? filePageData.files : null
  useEffect(() => {
    if (mode !== 'directory' || activeCategory === null) return
    let active = true
    setFilePageError('')
    const params = new URLSearchParams({ category: activeCategory, offset: String(currentPage * FILE_PAGE_SIZE) })
    getJson<{ files: FileInfo[] }>(`/api/kb/files?${params}`).then(data => {
      if (active) setFilePageData({ category: activeCategory, page: currentPage, files: data.files })
    }).catch(() => { if (active) setFilePageError('文件列表读取失败，请重试。') })
    return () => { active = false }
  }, [mode, activeCategory, currentPage, directoryVersion])
  const visibleLocalFolders = localFolders.filter(folder => view.kind !== 'category' || folder.category === view.category)
  const isRoot = view.kind === 'root'

  const [, setLocaleTick] = useState(0)
  useEffect(() => {
    const handler = () => setLocaleTick((v) => v + 1)
    window.addEventListener('dyworker:locale-change', handler)
    return () => window.removeEventListener('dyworker:locale-change', handler)
  }, [])

  const tabs = <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
    <div style={{ marginRight: 'auto' }} />
    <button style={mode === 'graph' ? primaryButton : button} aria-pressed={mode === 'graph'} onClick={() => setMode('graph')}>{t('kb.tabGraph', '关系图谱')}</button>
    <button style={mode === 'directory' ? primaryButton : button} aria-pressed={mode === 'directory'} onClick={() => setMode('directory')}>{t('kb.tabDirectory', '资料目录')}</button>
  </div>
  if (mode === 'graph') return <div style={{ width: '100%', maxWidth: 1600, margin: '0 auto', padding: '20px 24px', boxSizing: 'border-box' }}>{tabs}<div style={{ border: '1px solid var(--border, #e8ebef)', borderRadius: 12, overflow: 'hidden', background: 'var(--card, #fff)' }}><KnowledgeGraph /></div></div>

  // 资料目录保持原有宽度，图谱使用可用画布。
  return (
    <div style={{ maxWidth: 'var(--dsh-chat-content-width)', width: '100%', margin: '0 auto', padding: '20px 24px' }}>
      {tabs}
      <div style={{ ...card, marginBottom: 14 }}>
        <h3 style={heading}>{t('kb.title', '知识库')}</h3>
        <p style={sub}>{t('kb.memoryIntegration', '个人记忆与导入资料可一起检索。记忆内容在「记忆」中管理，项目记忆仅供对应项目使用。')}</p>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <button style={button} disabled={exporting} onClick={() => void exportKnowledge()}>{exporting ? t('kb.exporting', '导出中…') : t('kb.exportKnowledge', '导出资料')}</button>
          <span style={{ ...sub, margin: 0 }}>{t('kb.exportNote', '导出解析后的资料内容，不包含原始上传文件。')}</span>
        </div>
        {exportMessage && <p role="status" style={sub}>{exportMessage}</p>}

        <button
          type="button"
          disabled={importing}
          style={{ ...dropZone, width: '100%' }}
          onClick={() => fileInput.current?.click()}
        >
          {importing ? importingLabel : t('kb.dropZone', '点击选择文件（可多选）')}
        </button>
        <input
          ref={fileInput} type="file" multiple style={{ display: 'none' }}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            if (files.length > 0) void importFiles(files, view.kind === 'category' ? view.category : undefined)
            e.target.value = ''
          }}
        />
        <p style={{ ...sub, marginTop: 8 }}>{t('kb.formatDesc', '支持 md / txt / json / yml / docx / pdf；单个文件不超过 20 MB，同名文件重新导入会更新内容。')}</p>

        {lastImport !== null && lastImport.imported > 0 && (
          <div style={{ marginTop: 10, fontSize: 12.5, color: '#16a34a', background: 'var(--sidebar-active, #ecfdf3)', borderRadius: 8, padding: '8px 12px' }}>
            ✓ 已导入《{lastImport.source}》：{lastImport.imported} 个条目，分类「{lastImport.category}」（可在目录中重命名 / 移动）
          </div>
        )}

        {window.dyworker?.knowledgeLocalFolders && view.kind !== 'memories' && (
          <section aria-label="本地资料目录" style={{ borderTop: '1px solid var(--border, #e8ebef)', marginTop: 16, paddingTop: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <h4 style={{ ...heading, fontSize: 14, margin: 0 }}>本地资料目录</h4>
              <button style={button} disabled={localBusy || importing} onClick={() => void manageLocalFolder('connect')}>连接本地目录</button>
            </div>
            <p style={sub}>原文件留在本地，应用读取目录及子目录供检索。文件有变动时，点击「更新」。</p>
            <p style={sub}>本地目录中的文本文件每个最多 50 MB，PDF 和 Word 文档每个最多 20 MB。</p>
            {visibleLocalFolders.map(folder => (
              <div key={folder.id} style={{ ...row, gap: 8, flexWrap: 'wrap', cursor: 'default' }}>
                <div style={{ minWidth: 0, flex: '1 1 200px' }}>
                  <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{folder.path}</div>
                  {isRoot && <div style={meta}>{folder.category}</div>}
                </div>
                <button style={smallBtn} disabled={localBusy || importing} onClick={() => void manageLocalFolder('refresh', folder.id)}>更新</button>
                <button style={smallBtn} disabled={localBusy || importing} onClick={() => void manageLocalFolder('disconnect', folder.id)}>断开</button>
              </div>
            ))}
            {localBusy && <p role="status" style={{ ...sub, overflowWrap: 'anywhere' }}>{localProgress ? `已检查 ${localProgress.processed} 个文件${localProgress.file ? ` · ${localProgress.file}` : ''}` : '正在处理本地目录…'}</p>}
            {localError && <p role="alert" style={sub}>{localError}</p>}
            {localReport && <div style={{ marginTop: 8 }}>
              <p role="status" style={sub}>更新 {localReport.updated} 个，未变化 {localReport.unchanged} 个，移除 {localReport.removed} 个，跳过 {localReport.skipped} 个，失败 {localReport.failed} 个。</p>
              {!!localReport.issues.length && <details style={sub}>
                <summary>查看跳过或失败的文件</summary>
                <ul>{localReport.issues.map(issue => <li key={issue.path} style={{ overflowWrap: 'anywhere' }}>{issue.path} · {issue.reason}</li>)}</ul>
                {localReport.issues.length < localReport.skipped + localReport.failed && <p>显示前 {localReport.issues.length} 项。</p>}
                <p>文件无法更新时，知识库会保留已有内容。</p>
              </details>}
            </div>}
          </section>
        )}

      </div>

      {/* AI 建议面板 */}
      {suggestions !== null && (
        <div style={{ ...card, border: '1px solid #bfdbfe', background: 'var(--sidebar-active, #eff6ff)', marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                {t('kb.aiSuggestionsTitle', '🤖 AI 建议（只建议，不改动；勾选后点"应用"）')}
              </div>
              {suggestions.map((s, i) => (
                <div key={s.source} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid #dbeafe', fontSize: 12.5 }}>
                  <input
                    type="checkbox"
                    checked={accepted.has(i)}
                    disabled={s.error !== undefined}
                    onChange={() => {
                      setAccepted((prev) => {
                        const next = new Set(prev)
                        if (next.has(i)) next.delete(i)
                        else next.add(i)
                        return next
                      })
                    }}
                  />
                  <span style={{ flex: '0 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.source}</span>
                  {s.error !== undefined ? (
                    <span style={{ color: '#dc2626', flex: 1 }}>⚠️ {s.error}</span>
                  ) : (
                    <>
                      <span style={{ color: 'var(--muted, #9ca3af)' }}>→</span>
                      <span style={{ color: 'var(--accent, #2563eb)', fontWeight: 500 }}>{s.category}</span>
                      <span style={{ color: 'var(--muted, #6b7280)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.name}
                        {Array.isArray(s.tags) && s.tags.length > 0 ? ` · #${s.tags.join(' #')}` : ''}
                      </span>
                    </>
                  )}
                </div>
              ))}
              <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                <button style={primaryBtn} onClick={() => void applySuggestions()}>{t('kb.applySelected', '应用选中（{count}）').replace('{count}', String(accepted.size))}</button>
                <button style={smallBtn} onClick={() => setSuggestions(null)}>{t('kb.cancel', '取消')}</button>
              </div>
        </div>
      )}

      {/* 检索 */}
      <div style={{ ...card, marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            style={inputStyle} placeholder={t('kb.searchPlaceholder', '检索知识库…（如：ISO9001、参数、安装）')}
            aria-label={t('kb.searchBtn', '检索')}
            value={query}
            onChange={(e) => { setQuery(e.target.value); clearSearchResults() }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void runSearch() }}
          />
          <button style={primaryButton} onClick={() => void runSearch()}>{t('kb.searchBtn', '检索')}</button>
          {(searching || searchResults !== null) && (
            <button style={button} onClick={() => { setQuery(''); clearSearchResults() }}>{t('kb.backToDirectory', '返回目录')}</button>
          )}
        </div>
      </div>

      {/* 目录浏览器 */}
      <div style={card}>
        {searching ? (
          <p role="status" style={sub}>正在检索…</p>
        ) : searchResults === null ? (
          <>
            {memoryError && <p role="alert" style={{ color: '#b91c1c', fontSize: 13 }}>{memoryError} <button style={smallBtn} onClick={() => void refresh()}>{t('common.retry', '重试')}</button></p>}
            {/* 面包屑 + 返回（根视图无面包屑） */}
            <div style={breadcrumb}>
              {!isRoot && <button style={backBtn} onClick={() => changeView({ kind: 'root' })}>{t('kb.parentDir', '← 上一级')}</button>}
              {breadcrumbs.length > 0 && <span style={{ color: 'var(--muted, #9ca3af)' }}>/</span>}
              {breadcrumbs.map((c, i) => (
                <span key={i} style={c.current ? crumbCurrent : crumb} onClick={c.onClick}>{c.label}</span>
              ))}
              {view.kind === 'category' && (
                <button
                  style={{ ...smallBtn, marginLeft: 'auto' }}
                  onClick={() => setEditing({ kind: 'category', value: view.category })}
                >
                  {t('kb.renameCategory', '重命名分类')}
                </button>
              )}
            </div>

            {/* 编辑框（面包屑下显示） */}
            {editing !== null && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '0 0 10px' }}>
                <input
                  ref={editInput} style={renameInput}
                  defaultValue={editing.value}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void submitRename((e.target as HTMLInputElement).value)
                    if (e.key === 'Escape') setEditing(null)
                  }}
                  onBlur={(e) => void submitRename(e.target.value)}
                />
                <button style={primaryBtn} onClick={(e) => void submitRename((e.target as HTMLButtonElement).previousElementSibling as HTMLInputElement ? ((e.target as HTMLButtonElement).previousElementSibling as HTMLInputElement).value : '')}>{t('kb.confirm', '确定')}</button>
                <button style={smallBtn} onClick={() => setEditing(null)}>{t('kb.cancel', '取消')}</button>
              </div>
            )}

            {/* 根视图：分类目录（列表样式：图标 + 目录名，含空目录） */}
            {isRoot && (
              <>
                <button style={{ ...button, width: '100%', textAlign: 'left', marginBottom: 12 }} onClick={() => { void refresh(); changeView({ kind: 'memories' }) }}>
                  {t('kb.personalMemory', '个人记忆 · {count} 条').replace('{count}', String(memories.length))}
                </button>
                {/* 新建目录：按钮 + 内联输入框 */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '0 0 10px' }}>
                  {creatingCategory ? (
                    <>
                      <input
                        ref={createInput}
                        style={renameInput}
                        placeholder={t('kb.newFolderPlaceholder', '输入新目录名称，回车创建')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void createCategory((e.target as HTMLInputElement).value)
                          if (e.key === 'Escape') setCreatingCategory(false)
                        }}
                        onBlur={(e) => void createCategory(e.target.value)}
                      />
                      <button style={primaryBtn} onClick={(e) => void createCategory((e.target as HTMLButtonElement).previousElementSibling as HTMLInputElement ? ((e.target as HTMLButtonElement).previousElementSibling as HTMLInputElement).value : '')}>{t('kb.create', '创建')}</button>
                      <button style={smallBtn} onClick={() => setCreatingCategory(false)}>{t('kb.cancel', '取消')}</button>
                    </>
                  ) : (
                    <button style={smallBtn} onClick={() => setCreatingCategory(true)}>{t('kb.newFolder', '＋ 新建目录')}</button>
                  )}
                </div>
                {fullFolders.length === 0
                  ? <p style={{ ...sub, padding: '8px 0' }}>{t('kb.emptyFolderHint', '暂无导入的文件，先导入一个文件，或新建一个目录。')}</p>
                  : <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {fullFolders.map((folder) => (
                        <div
                          key={folder.category}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 12, padding: '11px 12px',
                            borderRadius: 8,
                            border: editing !== null && editing.kind === 'category' && editing.value === folder.category
                              ? '2px solid #2563eb'
                              : hoveredFolder === folder.category ? '1px solid #2563eb' : '1px solid transparent',
                            cursor: 'pointer', background: hoveredFolder === folder.category ? 'var(--surface, #f9fafb)' : 'transparent',
                            transition: 'border-color .15s, background .15s', position: 'relative',
                          }}
                          onClick={() => changeView({ kind: 'category', category: folder.category })}
                          onMouseEnter={() => setHoveredFolder(folder.category)}
                          onMouseLeave={() => setHoveredFolder(null)}
                        >
                          {/* 图标 + 目录名：名称紧跟图标 */}
                          <span style={{ fontSize: 18, flexShrink: 0 }}>📁</span>
                          <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink, #1f2937)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {folder.category}
                          </span>
                          <span style={{ fontSize: 11.5, color: 'var(--muted, #9ca3af)', marginLeft: 4, flexShrink: 0 }}>
                            {folder.files > 0 ? `${folder.files} 个文件 · ${folder.count} 个条目` : '空目录'}
                          </span>
                          {hoveredFolder === folder.category && (
                            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                              <button
                                style={{ ...smallBtn, border: '1px solid var(--border, #d1d5db)', background: 'var(--card, #fff)', borderRadius: 6, padding: '1px 8px', fontSize: 12, cursor: 'pointer', color: 'var(--ink, #374151)' }}
                                onClick={() => setEditing({ kind: 'category', value: folder.category })}
                                title="重命名目录"
                              >
                                ✏️ 重命名
                              </button>
                              {folder.files === 0 && !localFolders.some(local => local.category === folder.category) && (
                                <button
                                  style={{ ...smallBtn, border: '1px solid #fecaca', background: 'var(--card, #fff)', borderRadius: 6, padding: '1px 8px', fontSize: 12, cursor: 'pointer', color: '#dc2626' }}
                                  onClick={() => void deleteCategory(folder.category)}
                                  title="删除空目录"
                                >
                                  🗑 删除
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>}
              </>
            )}

            {view.kind === 'memories' && <>
              <h3 style={{ ...heading, fontSize: 14 }}>个人记忆（{memories.length}）</h3>
              <p style={sub}>显示个人和项目记忆；会话记忆仅在所属任务中使用。请在「记忆」中修改或删除。</p>
              {memories.length === 0 && <p style={sub}>暂无个人记忆。</p>}
              {memories.map(item => <div key={item.id} style={{ padding: '10px 0', borderTop: '1px solid #f0f1f4', fontSize: 13 }}>
                <strong>{item.name || item.category}</strong>
                <span style={{ color: 'var(--muted, #6b7280)', marginLeft: 8 }}>{item.scope === 'workspace' ? `项目：${item.workspacePath}` : '个人'}</span>
                <div style={{ marginTop: 4, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.content}</div>
              </div>)}
            </>}

            {/* 分类视图：文件分组 + 直接展示条目（两级结构，不再进第三层） */}
            {view.kind === 'category' && (
              filePageError ? <p role="alert" style={sub}>{filePageError} <button style={smallBtn} onClick={() => setDirectoryVersion(version => version + 1)}>重试</button></p>
                : currentFiles === null ? <p role="status" style={sub}>正在读取文件…</p>
                : currentFiles.length === 0
                ? <p style={{ ...sub, padding: '8px 0' }}>该分类为空。</p>
                : <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 4 }}>
                    {currentFiles.map((file) => {
                      const { source } = file
                      const editable = !!source && !isLocalSource(source)
                      const collapsed = openFile?.source !== source
                      return (
                        <div key={source ?? ''} style={{ border: '1px solid var(--border, #f0f1f4)', borderRadius: 10 }}>
                          {/* 文件分组头：可折叠 + 重命名 + 移动到 */}
                          <div
                            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', cursor: 'pointer', borderRadius: 10 }}
                            onClick={() => toggleFile(file)}
                            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface, #f9fafb)' }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                          >
                            <span style={{ fontSize: 11, color: 'var(--muted, #9ca3af)', width: 12, flexShrink: 0 }}>{collapsed ? '▸' : '▾'}</span>
                            <span style={iconSize}>📄</span>
                            <span style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--ink, #1f2937)', minWidth: 0, overflowWrap: 'anywhere' }}>{localSourcePath(source ?? '无来源')}</span>
                            <span style={meta}>{file.count} 块 · {file.updatedAt}</span>
                            {editable && <div style={rowActions} onClick={(e) => e.stopPropagation()}>
                              {moving?.source === file.source && (
                                <select
                                  autoFocus
                                  style={{ border: '1px solid var(--accent, #2563eb)', borderRadius: 6, padding: '2px 6px', fontSize: 11.5 }}
                                  value=""
                                  onChange={(e) => { if (e.target.value !== '') void moveTo(source, e.target.value) }}
                                  onBlur={() => setMoving(null)}
                                >
                                  <option value="" disabled>移动到…</option>
                                  {categories.filter((c) => c !== view.category).map((c) => <option key={c} value={c}>{c}</option>)}
                                </select>
                              )}
                              <button style={smallBtn} onClick={() => setMoving({ source })}>移动到…</button>
                              <button style={smallBtn} onClick={() => setEditing({ kind: 'file', value: source })}>✏️ 重命名</button>
                              <button style={{ ...smallBtn, color: '#dc2626', borderColor: '#fecaca' }} onClick={() => void deleteFile(source)}>🗑 删除</button>
                            </div>}
                          </div>
                          {/* 文件内容：切块条目直接展示 */}
                          {!collapsed && fileEntries.map((entry) => (
                            <div key={entry.id} style={{ ...row, cursor: 'default', paddingLeft: 34, borderTop: '1px solid #f5f6f8', borderRadius: 0 }}>
                              <span style={{ fontSize: 12, color: 'var(--border-strong, #cbd5e1)' }}>·</span>
                              {/* 文本容器：flex 布局保证超长内容省略号截断 */}
                              <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 8 }}>
                                <span style={{ fontWeight: 500, color: 'var(--ink, #374151)', flex: '0 1 auto', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {entry.name}
                                </span>
                                <span style={{ fontSize: 11.5, color: 'var(--muted, #9ca3af)', flex: '1 1 auto', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {entry.summary}
                                </span>
                                {entry.tags.map((tag) => (
                                  <span key={tag} style={{ display: 'inline-block', fontSize: 11, color: 'var(--ink, #374151)', background: 'var(--surface, #f3f4f6)', borderRadius: 999, padding: '1px 8px', flexShrink: 0 }}>{tag}</span>
                                ))}
                              </div>
                              {!isLocalSource(source) && <button
                                style={{ ...smallBtn, color: 'var(--muted, #9ca3af)', borderColor: 'transparent', fontSize: 13, padding: '1px 6px', flexShrink: 0 }}
                                title="删除这条内容"
                                onClick={(e) => { e.stopPropagation(); void deleteEntry(entry.id) }}
                              >
                                ✕
                              </button>}
                            </div>
                          ))}
                          {!collapsed && (fileLoading || fileError || fileEntries.length < file.count) && <div style={{ padding: '8px 34px' }}>
                            {fileLoading ? <span role="status" style={sub}>正在读取条目…</span> : (
                              <>
                                {fileError && <span role="alert" style={{ ...sub, marginRight: 8 }}>{fileError}</span>}
                                <button style={smallBtn} onClick={() => void loadFileEntries(file, fileEntries.length)}>{fileError ? '重试' : '加载更多条目'}</button>
                              </>
                            )}
                          </div>}
                        </div>
                      )
                    })}
                    {lastPage > 0 && <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, paddingTop: 8 }}>
                      <button style={smallBtn} disabled={currentPage === 0} onClick={() => { setOpenFile(null); setFilePage(currentPage - 1) }}>上一页</button>
                      <span style={sub}>{currentPage + 1} / {lastPage + 1}</span>
                      <button style={smallBtn} disabled={currentPage === lastPage} onClick={() => { setOpenFile(null); setFilePage(currentPage + 1) }}>下一页</button>
                    </div>}
                  </div>
            )}
          </>
        ) : (
          <>
            <h3 style={{ ...heading, fontSize: 14 }}>检索结果（{searchResults.entries.length + searchResults.memories.length}）</h3>
            {searchResults.error && (
              <p role="alert" style={{ color: '#b91c1c', fontSize: 13 }}>{searchResults.error} <button style={smallBtn} onClick={() => void runSearch()}>{t('common.retry', '重试')}</button></p>
            )}
            {!searchResults.error && searchResults.entries.length === 0 && searchResults.memories.length === 0 && (
              <p role="status" style={{ ...sub, marginTop: 10 }}>未找到匹配的资料或个人记忆。</p>
            )}
            {searchResults.entries.map((entry) => (
              <article key={entry.id} style={{ padding: '10px', borderTop: '1px solid var(--border, #f0f1f4)', overflowWrap: 'anywhere' }}>
                <h4 style={{ ...heading, fontSize: 13, color: 'var(--ink, #374151)' }}>{entry.name}</h4>
                <div style={{ color: 'var(--muted, #6b7280)', fontSize: 11.5 }}>
                  {entry.category}{entry.source ? ` / ${localSourcePath(entry.source)}` : ''}
                </div>
                <p style={{ ...sub, fontSize: 12, margin: '4px 0 0' }}>{searchExcerpt(entry, searchResults.keyword)}</p>
              </article>
            ))}
            {searchResults.memories.map(item => <div key={`memory-${item.id}`} style={{ padding: '10px', borderTop: '1px solid var(--border, #f0f1f4)', fontSize: 13, overflowWrap: 'anywhere' }}>
              <strong>{item.name || item.category}</strong>
              <span style={{ color: 'var(--muted, #6b7280)', marginLeft: 8 }}>个人记忆 · {item.scope === 'workspace' ? `项目：${item.workspacePath}` : '个人'}</span>
              <div style={{ marginTop: 4, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.content}</div>
            </div>)}
          </>
        )}
      </div>
    </div>
  )
}
