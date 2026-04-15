import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard,
  AlertCircle,
  CheckCircle2,
  Timer,
  Search,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react';
import { getQueue } from '../api/client';
import ReviewQueue from '../components/ReviewQueue';
import type { LCPresentation, PresentationStatus } from '../types';

type SortKey = 'overallRiskScore' | 'createdAt' | 'lcNumber';
type SortDir = 'asc' | 'desc';

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  iconClass,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  iconClass: string;
}) {
  return (
    <div className="card flex items-center gap-4 p-5">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${iconClass}`}>
        <Icon className="h-6 w-6" />
      </div>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
        <p className="mt-0.5 text-2xl font-bold text-gray-900">{value}</p>
        {sub && <p className="text-xs text-gray-500">{sub}</p>}
      </div>
    </div>
  );
}

function filterAndSort(
  presentations: LCPresentation[],
  search: string,
  statusFilter: string,
  sortKey: SortKey,
  sortDir: SortDir,
): LCPresentation[] {
  let result = [...presentations];

  if (search.trim()) {
    const q = search.toLowerCase();
    result = result.filter(
      (p) =>
        p.lcNumber.toLowerCase().includes(q) ||
        p.clientName.toLowerCase().includes(q) ||
        p.beneficiary.toLowerCase().includes(q),
    );
  }

  if (statusFilter !== 'all') {
    result = result.filter((p) => p.status === statusFilter);
  }

  result.sort((a, b) => {
    let aVal: string | number = a[sortKey] as string | number;
    let bVal: string | number = b[sortKey] as string | number;
    if (typeof aVal === 'string') aVal = aVal.toLowerCase();
    if (typeof bVal === 'string') bVal = bVal.toLowerCase();
    if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  return result;
}

export default function Dashboard() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('overallRiskScore');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const { data, isLoading, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['queue'],
    queryFn: getQueue,
    refetchInterval: 30_000,
  });

  const presentations = data?.presentations ?? [];
  const stats = data?.stats;

  const totalCritical = presentations.reduce(
    (sum, p) => sum + p.findings.filter((f) => f.severity === 'critical').length,
    0,
  );

  const filtered = filterAndSort(presentations, search, statusFilter, sortKey, sortDir);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  const lastRefreshed = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  return (
    <div className="mx-auto max-w-screen-2xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Page header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <LayoutDashboard className="h-6 w-6 text-blue-700" />
          <div>
            <h1 className="text-xl font-bold text-gray-900">Review Dashboard</h1>
            {lastRefreshed && (
              <p className="text-xs text-gray-500">Last refreshed {lastRefreshed}</p>
            )}
          </div>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="btn-secondary"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Stats row */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Total Presentations"
          value={stats?.totalPresentations ?? presentations.length}
          icon={LayoutDashboard}
          iconClass="bg-blue-100 text-blue-700"
        />
        <StatCard
          label="Critical Findings"
          value={totalCritical}
          sub="Require immediate attention"
          icon={AlertCircle}
          iconClass="bg-red-100 text-red-700"
        />
        <StatCard
          label="STP Candidates"
          value={stats?.stpCandidates ?? presentations.filter((p) => p.stpCandidate).length}
          sub="Straight-through processing"
          icon={CheckCircle2}
          iconClass="bg-green-100 text-green-700"
        />
        <StatCard
          label="Avg. Exam Time"
          value={
            stats?.avgExaminationTimeMinutes != null
              ? `${stats.avgExaminationTimeMinutes} min`
              : '—'
          }
          sub="Per presentation"
          icon={Timer}
          iconClass="bg-amber-100 text-amber-700"
        />
      </div>

      {/* Queue panel */}
      <div className="card overflow-hidden">
        <div className="border-b border-gray-200 px-5 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-base font-semibold text-gray-900">Review Queue</h2>

            <div className="flex flex-wrap items-center gap-2">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="search"
                  placeholder="Search LC, client…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-9 w-52 rounded-md border border-gray-300 bg-white pl-8 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Status filter */}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All statuses</option>
                <option value="pending">Pending</option>
                <option value="processing">Processing</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
              </select>

              {/* Sort */}
              <div className="flex items-center gap-1">
                <SlidersHorizontal className="h-4 w-4 text-gray-400" />
                <select
                  value={`${sortKey}:${sortDir}`}
                  onChange={(e) => {
                    const [key, dir] = e.target.value.split(':') as [SortKey, SortDir];
                    setSortKey(key);
                    setSortDir(dir);
                  }}
                  className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="overallRiskScore:desc">Risk: High → Low</option>
                  <option value="overallRiskScore:asc">Risk: Low → High</option>
                  <option value="createdAt:desc">Newest first</option>
                  <option value="createdAt:asc">Oldest first</option>
                  <option value="lcNumber:asc">LC Number A→Z</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <ReviewQueue presentations={filtered} isLoading={isLoading} />

        {/* Footer */}
        {!isLoading && filtered.length > 0 && (
          <div className="border-t border-gray-100 px-5 py-3 text-right text-xs text-gray-400">
            Showing {filtered.length} of {presentations.length} presentation
            {presentations.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>
    </div>
  );
}
