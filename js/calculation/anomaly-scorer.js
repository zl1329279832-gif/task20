/**
 * anomaly-scorer.js
 * Score anomalies and filter false positives for building energy analysis.
 * All functions are pure -- no DOM access.
 */

/**
 * Map severity labels to base score ranges.
 * @param {string} severity
 * @returns {number} Base score (0-100).
 */
function severityBaseScore(severity) {
  switch (String(severity).toLowerCase()) {
    case 'critical': return 90;
    case 'high':     return 70;
    case 'medium':   return 50;
    case 'low':      return 30;
    case 'info':     return 10;
    default:         return 40;
  }
}

/**
 * Compute deviation factor: how many standard deviations the anomaly value
 * deviates from the historical average.
 * @param {object} anomaly
 * @param {object} context
 * @returns {number} Absolute number of standard deviations, capped at 10.
 */
function computeDeviationFactor(anomaly, context) {
  const value = Number(anomaly.details?.value ?? anomaly.details?.consumption ?? 0);
  const avg = Number(context.historicalAvg ?? 0);
  const stddev = Number(context.historicalStddev ?? 1);

  if (stddev === 0 || !Number.isFinite(stddev)) {
    return value > avg ? 5 : 0;
  }

  const deviation = Math.abs(value - avg) / stddev;
  return Math.min(deviation, 10); // cap at 10 sigma
}

/**
 * Check whether the anomaly matches expected seasonal patterns.
 * For example, higher consumption in summer/winter is expected.
 * @param {object} anomaly
 * @param {object} context
 * @returns {boolean}
 */
function matchesSeasonalPattern(anomaly, context) {
  if (!context.seasonalBaseline) return false;

  const timestamp = anomaly.details?.timestamp ?? anomaly.timestamp;
  if (!timestamp) return false;

  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return false;

  const month = d.getMonth() + 1; // 1-12
  let season;
  if (month >= 6 && month <= 8) season = 'summer';
  else if (month >= 12 || month <= 2) season = 'winter';
  else if (month >= 3 && month <= 5) season = 'spring';
  else season = 'autumn';

  const baseline = context.seasonalBaseline[season];
  if (baseline === undefined || baseline === null) return false;

  // If the anomaly value is within 30% of the seasonal baseline, it matches
  const value = Number(anomaly.details?.value ?? anomaly.details?.consumption ?? 0);
  if (baseline === 0) return value === 0;

  const ratio = Math.abs(value - baseline) / baseline;
  return ratio < 0.3;
}

/**
 * Generate a recommendation string based on anomaly type and score.
 * @param {object} anomaly
 * @param {number} score
 * @param {boolean} isFalsePositive
 * @returns {string}
 */
function generateRecommendation(anomaly, score, isFalsePositive) {
  if (isFalsePositive) {
    return 'Seasonal pattern detected. No immediate action required; continue monitoring.';
  }

  const type = String(anomaly.type).toLowerCase();

  if (score >= 80) {
    if (type.includes('consumption') || type.includes('energy')) {
      return 'Critical energy anomaly detected. Immediate inspection of equipment and wiring recommended.';
    }
    if (type.includes('temperature') || type.includes('temp')) {
      return 'Severe temperature anomaly. Check HVAC system immediately and verify sensor calibration.';
    }
    return 'High-severity anomaly requires immediate investigation and corrective action.';
  }

  if (score >= 50) {
    if (type.includes('consumption') || type.includes('energy')) {
      return 'Elevated energy usage detected. Schedule equipment inspection within one week.';
    }
    if (type.includes('off-hours') || type.includes('schedule')) {
      return 'Off-hours operation detected. Review scheduling policies and timer settings.';
    }
    return 'Moderate anomaly detected. Schedule investigation within the current maintenance cycle.';
  }

  return 'Minor anomaly noted. Include in next routine maintenance review.';
}

/**
 * Score anomalies and identify false positives.
 *
 * @param {Array<{ type: string, severity: string, entityId: string, message: string, details: object }>} anomalies
 * @param {{
 *   seasonalBaseline?: { summer?: number, winter?: number, spring?: number, autumn?: number },
 *   buildingType?: string,
 *   historicalAvg?: number,
 *   historicalStddev?: number
 * }} context
 * @returns {Array<{
 *   type: string, severity: string, entityId: string, message: string, details: object,
 *   score: number, isFalsePositive: boolean, recommendation: string
 * }>}
 */
export function scoreAnomalies(anomalies, context) {
  if (!Array.isArray(anomalies) || anomalies.length === 0) {
    return [];
  }

  const ctx = context || {};
  const stddev = Number(ctx.historicalStddev ?? 1);

  return anomalies.map(anomaly => {
    // 1. Start with severity-based score
    let score = severityBaseScore(anomaly.severity);

    // 2. Adjust based on deviation from historical average
    const deviationFactor = computeDeviationFactor(anomaly, ctx);
    // Add up to 30 points based on deviation (each sigma adds 3 points)
    score += Math.min(deviationFactor * 3, 30);

    // 3. Building type adjustment: certain building types tolerate higher usage
    if (ctx.buildingType) {
      const bt = String(ctx.buildingType).toLowerCase();
      if (bt === 'datacenter' || bt === 'data_center' || bt === 'hospital') {
        // These buildings naturally have higher consumption; reduce score slightly
        score -= 10;
      } else if (bt === 'warehouse' || bt === 'parking') {
        // Low-consumption buildings; anomalies are more significant
        score += 5;
      }
    }

    // 4. Clamp score to 0-100
    score = Math.max(0, Math.min(100, Math.round(score)));

    // 5. False positive detection:
    //    If deviation < 2 * stddev AND seasonal pattern matches, mark as false positive
    const isFalsePositive = (
      deviationFactor < 2 &&
      matchesSeasonalPattern(anomaly, ctx)
    );

    // 6. If false positive, reduce the score
    if (isFalsePositive) {
      score = Math.max(0, Math.min(score, 20));
    }

    // 7. Generate recommendation
    const recommendation = generateRecommendation(anomaly, score, isFalsePositive);

    return {
      ...anomaly,
      score,
      isFalsePositive,
      recommendation
    };
  });
}
