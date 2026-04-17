import React, { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  AlertCircle,
  AlertTriangle,
  Info,
  CheckCircle2,
  Loader2,
  ScrollText,
  Printer,
  ClipboardList,
  RefreshCw,
  Building2,
  CalendarDays,
} from 'lucide-react';
import { getPresentation, submitOverride } from '../api/client';
import DocumentCard from '../components/DocumentCard';
import FindingCard from '../components/FindingCard';
import OverrideModal from '../components/OverrideModal';
import DiscrepancyReport from '../components/DiscrepancyReport';
import type { Finding, Severity, OverrideData } from '../types';

const SEVERITY_ORDER: Severity[] = ['critical', 'moderate', 'informational'];

/**
 * Connect to the SSE progress stream for a presentation.
 * Invalidates the React Query cache on every progress event.
 * Closes the connection once status is completed or failed.
 */
function useProgressSSE(presentationId: string | undefined, enabled: boolean) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!presentationId || !enabled) return;

    const token = localStorage.getItem('auth_token');
    // SSE doesn't support headers natively — pass token as query param
    const url = `/api/validations/${presentationId}/progress?token=${token ?? ''}`;
    const es = new EventSource(url);

    es.addEventListener('progress', () => {
      queryClient.invalidateQueries({ queryKey: ['presentation', presentationId] });
    });

    es.addEventListener('status', () => {
      queryClient.invalidateQueries({ queryKey: ['presentation', presentationId] });
    });

    es.addEventListener('done', () => {
      queryClient.invalidateQueries({ queryKey: ['presentation', presentationId] });
      es.close();
    });

    es.onerror = () => {
      // On SSE error, fall back gracefully — React Query will continue with its own refetch
      es.close();
    };

    return () => {
      es.close();
    };
  }, [presentationId, enabled, queryClient]);
}

function RiskBadge({ score }: { score: number }) {
  const color =
    score <= 30
      ? 'bg-green-100 text-green-800 ring-green-600/20'
      : score <= 60
      ? 'bg-amber-100 text-amber-800 ring-amber-600/20'
      : 'bg-red-100 text-red-800 ring-red-600/20';
  const label = score <= 30 ? 'Low Risk' : score <= 60 ? 'Medium Risk' : 'High Risk';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-semibold ring-1 ring-inset ${color}`}>
      {score} — {label}
    </span>
  );
}

export default function ReviewScreen() {
  const { presentationId } = useParams<{ presentationId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [modalState, setModalState] = useState<{
    open: boolean;
    action: 'accept' | 'override' | 'escalate';
    findingId: string;
  } | null>(null);

  const [showReport, setShowReport] = useState(false);
  const [activeTab, setActiveTab] = useState<'findings' | 'documents'>('findings');

  const { data: presentation, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['presentation', presentationId],
    queryFn: () => getPresentation(presentationId!),
    enabled: !!presentationId,
    refetchInterval: false,
    refetchOnWindowFocus: true,
  });

  const overrideMutation = useMutation({
    mutationFn: ({ findingId, data }: { findingId: string; data: OverrideData }) =>
      submitOverride(findingId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['presentation', presentationId] });
      queryClient.invalidateQueries({ queryKey: ['queue'] });
    },
  });

  const handleAction = useCallback(
    (action: 'accept' | 'override' | 'escalate', findingId: string) => {
      setModalState({ open: true, action, findingId });
    },
    [],
  );

  const handleModalSubmit = useCallback(
    async (
      findingId: string,
      action: 'accept' | 'override' | 'escalate',
      overrideReason: string,
      justification: string,
    ) => {
      await overrideMutation.mutateAsync({
        findingId,
        data: { action, overrideReason, justification },
      });
    },
    [overrideMutation],
  );

  function handlePrint() {
    setShowReport(true);
    setTimeout(() => window.print(), 300);
  }

  if (isLoading) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
      </div>
    );
  }

  if (isError || !presentation) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <AlertCircle className="mx-auto mb-4 h-12 w-12 text-red-400" />
        <h2 className="text-lg font-semibold text-gray-900">Presentation not found</h2>
        <p className="mt-2 text-sm text-gray-500">
          The requested presentation could not be loaded.
        </p>
        <button onClick={() => navigate('/')} className="btn-primary mt-6">
          Back to Dashboard
        </button>
      </div>
    );
  }

  const critical = presentation.findings.filter((f) => f.severity === 'critical');
  const moderate = presentation.findings.filter((f) => f.severity === 'moderate');
  const informational = presentation.findings.filter((f) => f.severity === 'informational');

  const sortedFindings = SEVERITY_ORDER.flatMap((sev) =>
    presentation.findings.filter((f) => f.severity === sev),
  );

  const isProcessing =
    presentation.status === 'processing' || presentation.status === 'pending';

  useProgressSSE(presentationId, isProcessing);

  return (
    <>
      {/* Print-only report */}
      {showReport && (
        <div className="print-only hidden p-8">
          <DiscrepancyReport presentation={presentation} />
        </div>
      )}

      <div className="no-print mx-auto max-w-screen-2xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Breadcrumb / back */}
        <div className="mb-4 flex items-center gap-2 text-sm text-gray-500">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1 hover:text-blue-700"
          >
            <ArrowLeft className="h-4 w-4" />
            Dashboard
          </button>
          <span>/</span>
          <span className="font-medium text-gray-900">{presentation.lcNumber}</span>
        </div>

        {/* Page header */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-gray-900">
                LC {presentation.lcNumber}
              </h1>
              <RiskBadge score={presentation.overallRiskScore} />
              {presentation.stpCandidate && (
                <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-3 py-1 text-sm font-semibold text-green-700">
                  <CheckCircle2 className="h-4 w-4" />
                  STP Eligible
                </span>
              )}
              {isProcessing && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-700">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Analysing…
                </span>
              )}
              {isProcessing && (
                <span className="flex items-center gap-1 text-xs text-green-600">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                  </span>
                  Live
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-4 text-sm text-gray-500">
              <span className="flex items-center gap-1.5">
                <Building2 className="h-4 w-4" />
                {presentation.clientName}
              </span>
              <span>Applicant: {presentation.applicant}</span>
              <span>Beneficiary: {presentation.beneficiary}</span>
              <span className="flex items-center gap-1.5">
                <CalendarDays className="h-4 w-4" />
                {new Date(presentation.createdAt).toLocaleDateString('en-GB', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                })}
              </span>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="btn-secondary"
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button onClick={handlePrint} className="btn-secondary">
              <Printer className="h-4 w-4" />
              Print Report
            </button>
            <Link to={`/audit/${presentation.id}`} className="btn-secondary">
              <ScrollText className="h-4 w-4" />
              Audit Trail
            </Link>
          </div>
        </div>

        {/* Main content */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Left column — documents + mobile tab nav */}
          <div className="lg:col-span-1">
            {/* Mobile tab switcher */}
            <div className="mb-4 flex rounded-lg border border-gray-200 bg-white p-1 lg:hidden">
              {(['findings', 'documents'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 rounded-md py-2 text-sm font-medium capitalize transition-colors ${
                    activeTab === tab
                      ? 'bg-blue-700 text-white'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Documents panel */}
            <div className={`${activeTab === 'documents' ? 'block' : 'hidden'} lg:block`}>
              <div className="card p-4">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
                  <ClipboardList className="h-4 w-4" />
                  Documents ({presentation.documents.length})
                </h2>
                <div className="space-y-3">
                  {presentation.documents.length === 0 ? (
                    <p className="py-4 text-center text-sm text-gray-400">
                      No documents uploaded.
                    </p>
                  ) : (
                    presentation.documents.map((doc) => (
                      <DocumentCard key={doc.id} document={doc} />
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Right column — findings */}
          <div className={`lg:col-span-2 ${activeTab === 'findings' ? 'block' : 'hidden'} lg:block`}>
            {/* Findings summary bar */}
            <div className="card mb-4 p-4">
              <div className="flex flex-wrap items-center gap-6">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-red-500" />
                  <span className="text-sm font-semibold text-gray-900">
                    {critical.length}
                  </span>
                  <span className="text-sm text-gray-500">Critical</span>
                </div>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                  <span className="text-sm font-semibold text-gray-900">
                    {moderate.length}
                  </span>
                  <span className="text-sm text-gray-500">Moderate</span>
                </div>
                <div className="flex items-center gap-2">
                  <Info className="h-5 w-5 text-blue-500" />
                  <span className="text-sm font-semibold text-gray-900">
                    {informational.length}
                  </span>
                  <span className="text-sm text-gray-500">Informational</span>
                </div>
                <div className="ml-auto text-right text-xs text-gray-400">
                  {presentation.findings.filter((f) => f.status !== 'open').length} of{' '}
                  {presentation.findings.length} actioned
                </div>
              </div>
            </div>

            {/* Findings list */}
            {isProcessing ? (
              <div className="card flex flex-col items-center justify-center py-16 text-gray-400">
                <Loader2 className="mb-3 h-10 w-10 animate-spin text-blue-500" />
                <p className="font-medium text-gray-600">AI analysis in progress…</p>
                <p className="mt-1 text-sm">
                  Findings will appear automatically when analysis completes.
                </p>
              </div>
            ) : sortedFindings.length === 0 ? (
              <div className="card flex flex-col items-center justify-center py-16 text-gray-400">
                <CheckCircle2 className="mb-3 h-10 w-10 text-green-400" />
                <p className="font-medium text-gray-600">No discrepancies found</p>
                <p className="mt-1 text-sm">
                  This presentation is clear for straight-through processing.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {sortedFindings.map((finding) => (
                  <FindingCard
                    key={finding.id}
                    finding={finding}
                    onAction={handleAction}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Override modal */}
      {modalState?.open && (
        <OverrideModal
          findingId={modalState.findingId}
          action={modalState.action}
          onSubmit={handleModalSubmit}
          onClose={() => setModalState(null)}
        />
      )}
    </>
  );
}
