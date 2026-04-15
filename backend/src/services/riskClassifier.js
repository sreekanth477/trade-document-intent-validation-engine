'use strict';

const logger = require('../utils/logger');

// ---------------------------------------------------------------------------
// Risk Classifier
// Rule-based + heuristic severity classification and overall risk scoring.
// ---------------------------------------------------------------------------

// -----------------------------------------------------------------------
// Always-Critical conditions (regardless of model confidence)
// -----------------------------------------------------------------------
const ALWAYS_CRITICAL_FINDING_TYPES = new Set([
  'PARTY_NAME_MISMATCH',
  'AMOUNT_DISCREPANCY',
  'CURRENCY_MISMATCH',
  'LC_EXPIRY_VIOLATION',
  'SHIPMENT_DATE_EXCEEDED',
  'CLAUSED_BL',
  'TRANSHIPMENT_VIOLATION',
  'PARTIAL_SHIPMENT_VIOLATION',
]);

// Pattern-based always-critical titles (normalised to lowercase)
const ALWAYS_CRITICAL_TITLE_PATTERNS = [
  /beneficiary.*mismatch/i,
  /applicant.*mismatch/i,
  /lc.*expir/i,
  /amount.*discrepan/i,
  /forged/i,
  /fabricat/i,
  /inconsistent.*date/i,
  /date.*inconsisten/i,
];

// -----------------------------------------------------------------------
// Field importance weights for scoring
// -----------------------------------------------------------------------
const FIELD_IMPORTANCE = {
  amount:             10,
  totalValue:         10,
  insuredValue:       9,
  beneficiary:        10,
  applicant:          10,
  seller:             9,
  buyer:              9,
  currency:           10,
  expiryDate:         10,
  onBoardDate:        9,
  latestShipmentDate: 9,
  portOfLoading:      8,
  portOfDischarge:    8,
  goodsDescription:   7,
  cargoDescription:   7,
  vesselName:         6,
  incoterms:          6,
  perilsCovered:      7,
  coveragePercentage: 8,
  freightTerms:       5,
  partialShipments:   7,
  transhipment:       7,
};

// Finding type base weights (used in overall risk computation)
const FINDING_TYPE_WEIGHTS = {
  PARTY_NAME_MISMATCH:          20,
  AMOUNT_DISCREPANCY:           18,
  CURRENCY_MISMATCH:            18,
  LC_EXPIRY_VIOLATION:          20,
  SHIPMENT_DATE_EXCEEDED:       18,
  PRESENTATION_PERIOD_EXCEEDED: 16,
  DATE_VIOLATION:               14,
  CLAUSED_BL:                   16,
  PORT_MISMATCH:                14,
  TRANSHIPMENT_VIOLATION:       15,
  PARTIAL_SHIPMENT_VIOLATION:   15,
  INSURANCE_COVERAGE_GAP:       12,
  INSURANCE_VALUE_INSUFFICIENT: 12,
  INSURANCE_ROUTE_MISMATCH:     10,
  INCOTERMS_INCONSISTENCY:      8,
  GOODS_DESCRIPTION_MISMATCH:   12,
  MISSING_REQUIRED_FIELD:       8,
  TRADE_PATTERN_ANOMALY:        10,
  OVER_INVOICING_INDICATOR:     14,
  QUANTITY_WEIGHT_IMPLAUSIBILITY: 10,
};

// STP disqualifying conditions
const STP_DISQUALIFYING_SEVERITIES = new Set(['critical']);
const STP_MAX_MODERATE_FINDINGS = 2;
const STP_MAX_OVERALL_SCORE = 25;

class RiskClassifier {
  /**
   * Classify each finding and compute finalSeverity.
   * Applies rule-based overrides before heuristic scoring.
   * @param {Array<object>} findings - Raw findings from IntentAnalysisEngine
   * @returns {Array<object>} findings with finalSeverity and finalConfidence added
   */
  classify(findings) {
    if (!Array.isArray(findings)) return [];

    return findings.map(finding => {
      const overrideSeverity = this._checkAlwaysCritical(finding);
      const finalSeverity    = overrideSeverity || this._heuristicSeverity(finding);
      const finalConfidence  = this._adjustConfidence(finding, finalSeverity);

      return {
        ...finding,
        finalSeverity,
        finalConfidence,
        severityOverridden: overrideSeverity !== null,
        originalSeverity:   finding.severity,
      };
    });
  }

  /**
   * Compute overall risk score and STP eligibility.
   * @param {Array<object>} classifiedFindings - output of classify()
   * @returns {{ overallScore: number, stpCandidate: boolean, riskBand: string, riskSummary: string, breakdown: object }}
   */
  computeOverallRisk(classifiedFindings) {
    if (!Array.isArray(classifiedFindings) || classifiedFindings.length === 0) {
      return {
        overallScore: 0,
        stpCandidate: true,
        riskBand: 'LOW',
        riskSummary: 'No findings detected. Presentation appears compliant on automated review.',
        breakdown: { critical: 0, moderate: 0, informational: 0, totalFindings: 0 },
      };
    }

    const counts = { critical: 0, moderate: 0, informational: 0 };
    let weightedScore = 0;
    let maxPossibleScore = 0;

    for (const finding of classifiedFindings) {
      const severity = finding.finalSeverity || finding.severity;
      if (severity === 'critical')      counts.critical++;
      else if (severity === 'moderate') counts.moderate++;
      else                              counts.informational++;

      // Weighted contribution to overall score
      const typeWeight   = FINDING_TYPE_WEIGHTS[finding.findingType] || 8;
      const confidenceFactor = (finding.finalConfidence || finding.confidence || 50) / 100;
      const severityMultiplier = severity === 'critical' ? 1.5 : severity === 'moderate' ? 1.0 : 0.4;

      const contribution = typeWeight * confidenceFactor * severityMultiplier;
      weightedScore      += contribution;
      maxPossibleScore   += typeWeight * 1.5; // max if critical + 100% confidence
    }

    // Normalise to 0–100
    let overallScore;
    if (maxPossibleScore === 0) {
      overallScore = 0;
    } else {
      overallScore = Math.min(100, Math.round((weightedScore / maxPossibleScore) * 100));
    }

    // Ensure critical findings floor the score at 60
    if (counts.critical > 0) {
      overallScore = Math.max(overallScore, 60 + Math.min(counts.critical * 8, 40));
    }

    // Determine STP eligibility
    const hasCritical   = counts.critical > 0;
    const tooManyMod    = counts.moderate > STP_MAX_MODERATE_FINDINGS;
    const scoreTooHigh  = overallScore > STP_MAX_OVERALL_SCORE;
    const stpCandidate  = !hasCritical && !tooManyMod && !scoreTooHigh;

    // Determine risk band
    let riskBand;
    if (overallScore >= 75 || counts.critical >= 2)      riskBand = 'CRITICAL';
    else if (overallScore >= 50 || counts.critical >= 1) riskBand = 'HIGH';
    else if (overallScore >= 25 || counts.moderate >= 2) riskBand = 'MEDIUM';
    else if (overallScore >= 10 || counts.moderate >= 1) riskBand = 'LOW-MEDIUM';
    else                                                 riskBand = 'LOW';

    const riskSummary = this._buildRiskSummary(counts, overallScore, riskBand, stpCandidate);

    logger.info('RiskClassifier: overall risk computed', {
      overallScore, riskBand, stpCandidate, ...counts,
    });

    return {
      overallScore,
      stpCandidate,
      riskBand,
      riskSummary,
      breakdown: {
        critical:      counts.critical,
        moderate:      counts.moderate,
        informational: counts.informational,
        totalFindings: classifiedFindings.length,
      },
    };
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Check if this finding must be Critical regardless of model assignment.
   * @returns {string|null} 'critical' if override applies, null otherwise
   */
  _checkAlwaysCritical(finding) {
    if (ALWAYS_CRITICAL_FINDING_TYPES.has(finding.findingType)) {
      return 'critical';
    }

    for (const pattern of ALWAYS_CRITICAL_TITLE_PATTERNS) {
      if (pattern.test(finding.title || '')) return 'critical';
    }

    // Check description for definitive discrepancy language
    const desc = (finding.description || '').toLowerCase();
    const definitiveTerms = ['must be', 'does not match', 'exceeds the lc', 'post-dates', 'violates'];
    if (definitiveTerms.some(t => desc.includes(t)) && finding.confidence >= 80) {
      if ((finding.severity || '').toLowerCase() !== 'critical') {
        logger.debug('RiskClassifier: escalating to critical based on description language', {
          findingType: finding.findingType,
        });
        return 'critical';
      }
    }

    return null;
  }

  /**
   * Heuristic severity adjustment based on field importance and confidence.
   */
  _heuristicSeverity(finding) {
    const baseSeverity = (finding.severity || 'informational').toLowerCase();

    // If confidence is very low, downgrade from critical to moderate
    if (baseSeverity === 'critical' && (finding.confidence || 0) < 40) {
      logger.debug('RiskClassifier: downgrading critical to moderate due to low confidence', {
        findingType: finding.findingType,
        confidence: finding.confidence,
      });
      return 'moderate';
    }

    // If moderate with high confidence and high-importance fields, consider upgrading
    if (baseSeverity === 'moderate' && (finding.confidence || 0) >= 90) {
      const fields = finding.affectedFields || [];
      const hasHighImportanceField = fields.some(f => (FIELD_IMPORTANCE[f] || 0) >= 9);
      if (hasHighImportanceField) {
        logger.debug('RiskClassifier: upgrading moderate to critical due to high-importance field + high confidence', {
          findingType: finding.findingType,
          fields,
        });
        return 'critical';
      }
    }

    return baseSeverity;
  }

  /**
   * Adjust confidence score based on severity and evidence quality.
   */
  _adjustConfidence(finding, finalSeverity) {
    let conf = finding.confidence || 50;

    // Penalise if verbatim quotes are missing (reduces credibility)
    const quotes = finding.verbatimQuotes || [];
    if (quotes.length === 0) {
      conf = Math.max(0, conf - 20);
    }

    // Penalise if affected documents list is empty
    if ((finding.affectedDocuments || []).length === 0) {
      conf = Math.max(0, conf - 10);
    }

    // Boost if multiple documents agree on the discrepancy
    if ((finding.affectedDocuments || []).length >= 3) {
      conf = Math.min(100, conf + 5);
    }

    return Math.round(conf);
  }

  _buildRiskSummary(counts, overallScore, riskBand, stpCandidate) {
    const parts = [];

    if (counts.critical > 0) {
      parts.push(`${counts.critical} critical finding${counts.critical > 1 ? 's' : ''} detected requiring immediate attention`);
    }
    if (counts.moderate > 0) {
      parts.push(`${counts.moderate} moderate finding${counts.moderate > 1 ? 's' : ''} requiring checker review`);
    }
    if (counts.informational > 0) {
      parts.push(`${counts.informational} informational observation${counts.informational > 1 ? 's' : ''} noted`);
    }

    if (parts.length === 0) {
      return `Risk Band: ${riskBand} (Score: ${overallScore}/100). No findings detected. ${stpCandidate ? 'Eligible for straight-through processing.' : 'Not eligible for STP.'}`;
    }

    const summary = `Risk Band: ${riskBand} (Score: ${overallScore}/100). ${parts.join('. ')}. ${stpCandidate ? 'Eligible for straight-through processing.' : 'Manual checker review required.'}`;
    return summary;
  }
}

module.exports = RiskClassifier;
