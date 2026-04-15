import React, { useState, useEffect, useRef } from 'react';
import { X, AlertCircle, CheckCircle2, ArrowUpCircle, Loader2 } from 'lucide-react';

type OverrideAction = 'accept' | 'override' | 'escalate';

interface Props {
  findingId: string;
  action: OverrideAction;
  onSubmit: (
    findingId: string,
    action: OverrideAction,
    overrideReason: string,
    justification: string,
  ) => Promise<void>;
  onClose: () => void;
}

const OVERRIDE_REASONS = [
  'Finding not applicable to this transaction',
  'Acceptable commercial variation',
  'Banking practice exception',
  'Client-specific arrangement',
  'Technical/OCR error',
  'Other',
];

const ACTION_CONFIG: Record<
  OverrideAction,
  { title: string; description: string; icon: React.ElementType; colorClass: string; btnClass: string }
> = {
  accept: {
    title: 'Accept Finding',
    description:
      'Accepting this finding confirms it has been reviewed and is acceptable for this presentation.',
    icon: CheckCircle2,
    colorClass: 'text-green-700',
    btnClass: 'bg-green-600 hover:bg-green-700 text-white',
  },
  override: {
    title: 'Override Finding',
    description:
      'Overriding this finding marks it as non-blocking with a documented justification. This action is fully audited.',
    icon: AlertCircle,
    colorClass: 'text-amber-700',
    btnClass: 'bg-amber-500 hover:bg-amber-600 text-white',
  },
  escalate: {
    title: 'Escalate Finding',
    description:
      'Escalating this finding routes it to a supervisor or compliance officer for further review.',
    icon: ArrowUpCircle,
    colorClass: 'text-red-700',
    btnClass: 'bg-red-600 hover:bg-red-700 text-white',
  },
};

const MIN_JUSTIFICATION_CHARS = 20;

export default function OverrideModal({ findingId, action, onSubmit, onClose }: Props) {
  const [overrideReason, setOverrideReason] = useState(OVERRIDE_REASONS[0]);
  const [justification, setJustification] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const justificationRef = useRef<HTMLTextAreaElement>(null);

  const config = ACTION_CONFIG[action];
  const ActionIcon = config.icon;

  // Trap focus on mount
  useEffect(() => {
    justificationRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (justification.trim().length < MIN_JUSTIFICATION_CHARS) {
      setError(
        `Justification must be at least ${MIN_JUSTIFICATION_CHARS} characters. Please provide more detail.`,
      );
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit(findingId, action, overrideReason, justification.trim());
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to submit. Please try again.';
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  }

  const remaining = Math.max(0, MIN_JUSTIFICATION_CHARS - justification.trim().length);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <ActionIcon className={`h-5 w-5 ${config.colorClass}`} />
            <h2 className="text-base font-semibold text-gray-900">{config.title}</h2>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-40"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          <p className="text-sm text-gray-600">{config.description}</p>

          {/* Override reason */}
          <div>
            <label htmlFor="reason" className="label">
              Reason <span className="text-red-500">*</span>
            </label>
            <select
              id="reason"
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              disabled={isSubmitting}
              className="mt-1 input"
            >
              {OVERRIDE_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          {/* Justification */}
          <div>
            <label htmlFor="justification" className="label">
              Justification <span className="text-red-500">*</span>
            </label>
            <textarea
              id="justification"
              ref={justificationRef}
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              rows={5}
              disabled={isSubmitting}
              placeholder="Provide a detailed justification for this action. This will be included in the audit trail."
              className="mt-1 input resize-none leading-relaxed"
            />
            <div className="mt-1 flex items-center justify-between">
              <span className="text-xs text-gray-400">
                This justification will be permanently recorded.
              </span>
              {remaining > 0 && (
                <span className="text-xs text-amber-600">
                  {remaining} more character{remaining !== 1 ? 's' : ''} required
                </span>
              )}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2.5 rounded-md border border-red-200 bg-red-50 px-4 py-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || justification.trim().length < MIN_JUSTIFICATION_CHARS}
              className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${config.btnClass}`}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Submitting…
                </>
              ) : (
                <>
                  <ActionIcon className="h-4 w-4" />
                  Confirm {config.title}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
