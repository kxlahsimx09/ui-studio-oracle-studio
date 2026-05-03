import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import Markdown from 'react-markdown';
import { SidebarLayout, TOOLS_NAV } from '../components/SidebarLayout';
import { API_BASE } from '../api/oracle';

type View = 'all' | 'handoff' | 'directed';

interface InboxFile {
  filename: string;
  path: string;
  created: string;
  preview: string;
  type: 'handoff' | 'directed';
  archived?: boolean;
  // directed-only (parsed by backend from yaml frontmatter)
  oracle?: string;
  from?: string;
  to?: string;
  from_role?: string;
  to_role?: string;
  thread?: number;
  envelope_type?: string;
  subject?: string;
  priority?: string;
  handled_at?: string;
  handled_by_thread?: number;
}

const VIEW_TABS: Array<{ value: View; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'handoff', label: 'Handoff' },
  { value: 'directed', label: 'Directed' },
];

export function Handoff() {
  const [view, setView] = useState<View>('all');
  const [oracleFilter, setOracleFilter] = useState<string>('');
  const [showArchived, setShowArchived] = useState(false);
  const [files, setFiles] = useState<InboxFile[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [fullContent, setFullContent] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);

  useEffect(() => {
    void loadInbox();
  }, [view, oracleFilter, showArchived]);

  async function loadInbox() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (view !== 'all') params.set('type', view);
      if (oracleFilter) params.set('oracle', oracleFilter);
      if (showArchived) params.set('include_archived', '1');
      const res = await fetch(`${API_BASE}/inbox?${params}`);
      if (res.ok) {
        const data = await res.json();
        setFiles(data.files || []);
        setTotal(data.total || 0);
      }
    } catch (e) {
      console.error('Failed to load inbox:', e);
    } finally {
      setLoading(false);
    }
  }

  async function toggleExpand(file: InboxFile) {
    if (expanded === file.filename) {
      setExpanded(null);
      setFullContent(null);
      return;
    }
    setExpanded(file.filename);
    setFullContent(null);
    setLoadingContent(true);
    try {
      const res = await fetch(`${API_BASE}/file?path=${encodeURIComponent(file.path)}`);
      if (res.ok) {
        const text = await res.text();
        setFullContent(text);
      } else {
        setFullContent(file.preview);
      }
    } catch {
      setFullContent(file.preview);
    } finally {
      setLoadingContent(false);
    }
  }

  function formatDate(created: string): string {
    if (created === 'unknown') return 'Unknown date';
    try {
      return new Date(created).toLocaleString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return created;
    }
  }

  function extractTitle(file: InboxFile): string {
    if (file.subject) return file.subject;
    const headingMatch = file.preview.match(/^#\s+(.+)$/m);
    if (headingMatch) return headingMatch[1];
    const firstLine = file.preview.split('\n').find(l => l.trim().length > 0 && !l.startsWith('---'));
    return firstLine?.substring(0, 80) || 'Untitled';
  }

  // List of distinct oracles for the filter dropdown.
  const oracleOptions = useMemo(() => {
    const set = new Set<string>();
    files.forEach(f => f.oracle && set.add(f.oracle));
    return Array.from(set).sort();
  }, [files]);

  return (
    <SidebarLayout navItems={TOOLS_NAV} navTitle="Tools" filters={[]}>
      <h1 className="text-[32px] font-bold text-text-primary mb-2">Inbox</h1>
      <p className="text-text-secondary mb-6">
        <code className="bg-bg-card px-1.5 py-0.5 rounded text-[13px]">handoff/</code> — self-to-self context pass.{' '}
        <code className="bg-bg-card px-1.5 py-0.5 rounded text-[13px]">for-{'{oracle}'}/</code> — directed cross-agent envelopes (AGENTS.md §11).
      </p>

      <div className="flex flex-wrap gap-3 items-center mb-6">
        <div className="flex gap-1 bg-bg-card border border-border rounded-lg p-1">
          {VIEW_TABS.map(tab => (
            <button
              key={tab.value}
              onClick={() => setView(tab.value)}
              className={`px-3 py-1 rounded-md text-sm transition-colors ${
                view === tab.value ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {(view === 'directed' || view === 'all') && oracleOptions.length > 0 && (
          <select
            value={oracleFilter}
            onChange={e => setOracleFilter(e.target.value)}
            className="bg-bg-card border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary"
          >
            <option value="">all oracles</option>
            {oracleOptions.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        )}

        {(view === 'directed' || view === 'all') && (
          <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={e => setShowArchived(e.target.checked)}
              className="accent-accent"
            />
            include archived
          </label>
        )}
      </div>

      {loading ? (
        <div className="text-text-muted py-12 text-center">Loading inbox...</div>
      ) : files.length === 0 ? (
        <div className="text-center py-16 text-text-secondary">
          <p className="my-2">No envelopes match this filter.</p>
        </div>
      ) : (
        <>
          <div className="text-text-muted text-sm mb-4">
            {total} envelope{total !== 1 ? 's' : ''}
            {view !== 'all' && <> · {view}</>}
            {oracleFilter && <> · for-{oracleFilter}</>}
          </div>

          <div className="flex flex-col gap-2">
            {files.map(file => (
              <div
                key={file.path}
                className={`bg-bg-card border rounded-xl overflow-hidden transition-colors duration-200 hover:border-accent ${
                  file.archived ? 'border-border/50 opacity-70' : 'border-border'
                }`}
              >
                <div className="px-5 py-4 cursor-pointer" onClick={() => toggleExpand(file)}>
                  <div className="flex items-start gap-3 flex-wrap">
                    {file.type === 'directed' && (
                      <div className="flex flex-wrap items-center gap-1.5 mb-1">
                        <span className="bg-bg-secondary text-text-primary px-2 py-0.5 rounded text-xs font-mono">
                          {file.from}
                          {file.from_role && file.from_role !== file.from && (
                            <span className="text-text-muted"> ({file.from_role})</span>
                          )}
                        </span>
                        <span className="text-text-muted text-xs">→</span>
                        <span className="bg-bg-secondary text-text-primary px-2 py-0.5 rounded text-xs font-mono">
                          {file.to}
                          {file.to_role && file.to_role !== file.to && (
                            <span className="text-text-muted"> ({file.to_role})</span>
                          )}
                        </span>
                        {file.envelope_type && (
                          <span className={`px-2 py-0.5 rounded text-xs ${
                            file.envelope_type === 'escalate' ? 'bg-red-500/20 text-red-300' :
                            file.envelope_type === 'consult' ? 'bg-blue-500/20 text-blue-300' :
                            'bg-bg-secondary text-text-muted'
                          }`}>
                            {file.envelope_type}
                          </span>
                        )}
                        {file.priority === 'high' && (
                          <span className="bg-orange-500/20 text-orange-300 px-2 py-0.5 rounded text-xs">priority: high</span>
                        )}
                        {file.thread && (
                          <Link
                            to={`/forum?thread=${file.thread}`}
                            className="bg-accent/20 text-accent px-2 py-0.5 rounded text-xs hover:bg-accent hover:text-white transition-colors"
                            onClick={e => e.stopPropagation()}
                          >
                            thread #{file.thread}
                          </Link>
                        )}
                        {file.archived && (
                          <span className="bg-bg-secondary text-text-muted px-2 py-0.5 rounded text-xs">archived</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="text-[15px] font-medium text-text-primary mb-1.5">
                    {extractTitle(file)}
                  </div>
                  <div className="flex gap-4 text-xs text-text-muted max-sm:flex-col max-sm:gap-1">
                    <span className="text-accent">{formatDate(file.created)}</span>
                    <span className="font-mono text-[11px] truncate">{file.filename}</span>
                  </div>
                </div>
                {expanded === file.filename && (
                  <div className="border-t border-border p-5">
                    {loadingContent ? (
                      <div className="text-text-muted py-12 text-center">Loading...</div>
                    ) : (
                      <div className="leading-[1.7] text-text-primary text-sm prose-handoff">
                        <Markdown>{fullContent || file.preview}</Markdown>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </SidebarLayout>
  );
}
